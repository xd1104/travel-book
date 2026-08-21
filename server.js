'use strict';

/*
 * 旅途手帳（Travel Book）— 本機 Node server（零執行期依賴）
 * - 服務 ./public 的 PWA 前端
 * - 資料存 markdown + frontmatter：
 *     每趟旅程一個 ./data/trips/<id>.md（id = ts36-slug）
 *     每個打包模板一個 ./data/templates/<id>.md
 * - 寫入成功後自動 git add/commit -> pull(-X ours) -> push（GitHub 為同步中樞）
 * 架構比照 recipe-book（port 3517）；本專案 port 3618。
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const TRIPS_DIR = path.join(DATA_DIR, 'trips');
const TEMPLATES_DIR = path.join(DATA_DIR, 'templates');

const PORT = process.env.PORT || 3618;

for (const d of [DATA_DIR, TRIPS_DIR, TEMPLATES_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limitBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

function slugify(str) {
  const base = String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'trip';
}

function safeName(name) {
  // 只留 basename 擋 path traversal；字元集必須與前後端 slugify（\p{L}\p{N}）一致，
  // 否則手機端建的假名/韓文檔名會被 mangle 成另一個 id → 同一趟旅程跨裝置分裂（QA B1）
  return path.basename(String(name || '')).replace(/[^\p{L}\p{N}._\-]+/gu, '_');
}

// 原子寫入：先寫私有 temp 檔再 rename 蓋過目標（同磁碟 rename 是原子的）
async function atomicWrite(file, data, encoding) {
  const tmp = file + '.tmp~' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  try {
    await fsp.writeFile(tmp, data, encoding || 'utf8');
    await fsp.rename(tmp, file);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* 自動同步 GitHub（debounce 的 git add/commit/pull/push）              */
/* ------------------------------------------------------------------ */
const AUTO_SYNC = process.env.AUTO_SYNC !== '0';
let syncEnabled = false; // 啟動時偵測到 origin remote 才開
let syncBranch = 'main';
let syncTimer = null;
let syncing = false;
let syncPending = false;

function gitCmd(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(((stderr || stdout || err.message) + '').slice(0, 400)));
      else resolve((stdout || '') + '');
    });
  });
}

function scheduleSync() {
  if (!AUTO_SYNC || !syncEnabled) return;
  syncPending = true;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 2500); // 連續存檔只同步一次
}

// push 前先 pull，把手機端的變更合併進來；同檔衝突固定「電腦版本勝（-X ours）」
async function pullRemote(tag) {
  try {
    await gitCmd(['pull', '--no-edit', '--no-rebase', '-X', 'ours', 'origin', syncBranch]);
    console.log('[sync] ' + tag + ' pull ok');
  } catch (e) {
    console.error('[sync] ' + tag + ' pull failed (continuing):', e.message);
  }
}

async function runSync() {
  if (syncing) return; // 進行中；syncPending 會補跑
  syncing = true;
  syncPending = false;
  try {
    await gitCmd(['add', '-A']);
    const status = await gitCmd(['status', '--porcelain']);
    if (status.trim()) {
      await gitCmd(['commit', '-m', 'auto: sync travel data ' + new Date().toISOString()]);
    }
    await pullRemote('pre-push');
    await gitCmd(['push', 'origin', 'HEAD']);
    console.log('[sync] pushed to GitHub');
  } catch (e) {
    // 同步失敗絕不影響使用者的存檔，只記 log
    console.error('[sync] failed:', e.message);
  } finally {
    syncing = false;
    if (syncPending) scheduleSync();
  }
}

async function initSync() {
  if (!AUTO_SYNC) { console.log('[sync] disabled (AUTO_SYNC=0)'); return; }
  try {
    const url = (await gitCmd(['remote', 'get-url', 'origin'])).trim();
    if (!url) throw new Error('no origin');
    try { syncBranch = (await gitCmd(['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'main'; } catch { syncBranch = 'main'; }
    syncEnabled = true;
    console.log('[sync] enabled -> ' + url + ' (' + syncBranch + ')');
    // 啟動先 pull 一次，把手機端新增的資料接回電腦
    await pullRemote('startup');
  } catch {
    console.log('[sync] no git remote "origin"; auto-push disabled');
  }
}

/* ------------------------------------------------------------------ */
/* 旅程 / 模板 <-> markdown（frontmatter + 每列一筆 JSON）序列化        */
/* 格式定案見專案 CLAUDE.md；前端 app.js 有同一套 mirror，改就要一起改   */
/* ------------------------------------------------------------------ */

function fmString(v) { return JSON.stringify(String(v == null ? '' : v)); }
function fmNumber(v) { const n = Number(v); return String(isFinite(n) ? n : 0); }

// 行程點：固定 key 順序、空值不寫，讓 md 檔乾淨且 diff 穩定
function isTransit(s) { return s && s.type === 'transit'; } // 缺 type＝行程點（舊資料無痛）
function cleanStop(s) {
  // v1.3 移動（transit）：刻意只留 note＋stayMinutes（＝移動時間），
  // 不寫 title/cat/place 等站點欄位，讓「路上」不佔版面也不佔資料
  if (isTransit(s)) {
    const m = { id: String(s.id || ''), type: 'transit' };
    if (s.note) m.note = String(s.note);
    if (Number(s.stayMinutes) > 0) m.stayMinutes = Math.round(Number(s.stayMinutes));
    return m;
  }
  const o = { id: String(s.id || '') };
  o.title = String(s.title || '');
  if (s.time) o.time = String(s.time);
  if (s.cat) o.cat = String(s.cat);
  if (s.place) o.place = String(s.place);
  if (s.note) o.note = String(s.note);
  if (s.mapUrl) o.mapUrl = String(s.mapUrl);
  if (s.addr) o.addr = String(s.addr); // v2.4 展開 mapUrl 短連結後的完整地址（server 補；移動的路線連結靠它）
  if (Number(s.cost)) o.cost = Number(s.cost);
  if (Number(s.stayMinutes) > 0) o.stayMinutes = Math.round(Number(s.stayMinutes)); // v1.2 預計停留（分鐘；負值不落檔）
  if (s.bookingRef) o.bookingRef = String(s.bookingRef);
  if (s.phone) o.phone = String(s.phone);
  if (s.url) o.url = String(s.url);
  if (s.hoursOpen) o.hoursOpen = String(s.hoursOpen);
  if (s.hoursClose) o.hoursClose = String(s.hoursClose);
  if (s.hours24) o.hours24 = true;
  if (s.hours) o.hours = String(s.hours); // 舊自由文字（向下相容）
  return o;
}
function cleanExpense(e) {
  return { id: String(e.id || ''), amount: Number(e.amount) || 0, cat: String(e.cat || 'other'), desc: String(e.desc || '') };
}
function cleanPackItem(p) {
  return { id: String(p.id || ''), text: String(p.text || ''), done: !!p.done, zone: p.zone === 'checked' ? 'checked' : 'carry' };
}

function serializeTrip(t) {
  const L = [];
  L.push('---');
  L.push('name: ' + fmString(t.name));
  L.push('dest: ' + fmString(t.dest));
  L.push('emoji: ' + fmString(t.emoji));
  L.push('theme: ' + fmString(t.theme));
  L.push('start: ' + fmString(t.start));
  L.push('days: ' + fmNumber(t.days || 1));
  L.push('budget: ' + fmNumber(t.budget));
  L.push('createdAt: ' + fmString(t.createdAt || new Date().toISOString()));
  L.push('updatedAt: ' + fmString(t.updatedAt || new Date().toISOString()));
  L.push('---');
  L.push('');
  L.push('## 行程');
  L.push('');
  const dayKeys = Object.keys(t.itinerary || {})
    .map(Number).filter((n) => isFinite(n) && n >= 1)
    .sort((a, b) => a - b);
  for (const d of dayKeys) {
    const list = (t.itinerary || {})[String(d)] || [];
    if (!list.length) continue; // 空天不寫；縮天保留的 day-key 只要有內容就會留下
    L.push('### Day ' + d);
    L.push('');
    for (const s of list) L.push('- ' + JSON.stringify(cleanStop(s)));
    L.push('');
  }
  L.push('## 花費');
  L.push('');
  for (const e of t.expenses || []) L.push('- ' + JSON.stringify(cleanExpense(e)));
  L.push('');
  L.push('## 打包');
  L.push('');
  for (const p of t.packing || []) L.push('- ' + JSON.stringify(cleanPackItem(p)));
  L.push('');
  L.push('## 備註');
  L.push('');
  const notes = String(t.notes || '').replace(/\r\n/g, '\n');
  if (notes.trim()) L.push(notes.trimEnd());
  L.push('');
  return L.join('\n');
}

function parseFrontmatterLine(line) {
  const idx = line.indexOf(':');
  if (idx === -1) return null;
  const key = line.slice(0, idx).trim();
  const raw = line.slice(idx + 1).trim();
  let value;
  try { value = JSON.parse(raw); } catch { value = raw.replace(/^["']|["']$/g, ''); }
  return [key, value];
}

function parseTrip(id, text) {
  const t = {
    id, name: '', dest: '', emoji: '🧳', theme: 'sunset', start: '', days: 1, budget: 0,
    createdAt: '', updatedAt: '', itinerary: {}, expenses: [], packing: [], notes: '',
  };
  text = String(text).replace(/\r\n/g, '\n'); // 容忍 CRLF（Windows checkout/pull 後）
  let body = text;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const parsed = parseFrontmatterLine(line);
      if (!parsed) continue;
      const [k, v] = parsed;
      if (k === 'days' || k === 'budget') t[k] = Number(v) || (k === 'days' ? 1 : 0);
      else if (k in t) t[k] = v;
    }
    body = text.slice(fm[0].length);
  }
  let section = null;
  let day = 0;
  let inNotes = false; // 備註永遠是最後一段：進入後整段原樣收，內文的 ## 不再當標題
  const notesBuf = [];
  for (const line of body.split('\n')) {
    if (inNotes) { notesBuf.push(line); continue; }
    const h2 = /^##\s+(.+)$/.exec(line.trim());
    if (h2) {
      const name = h2[1].trim();
      if (name === '行程') { section = 'plan'; day = 0; }
      else if (name === '花費') section = 'exp';
      else if (name === '打包') section = 'pack';
      else if (name === '備註') { inNotes = true; }
      else section = null;
      continue;
    }
    if (section === 'plan') {
      const dm = /^###\s*Day\s*(\d+)/i.exec(line.trim());
      if (dm) { day = Number(dm[1]); continue; }
    }
    const im = /^-\s+(\{.*\})\s*$/.exec(line);
    if (!im) continue;
    let obj;
    try { obj = JSON.parse(im[1]); } catch { continue; } // 壞列跳過，不整檔炸掉
    if (section === 'plan' && day >= 1) {
      const key = String(day);
      if (!t.itinerary[key]) t.itinerary[key] = [];
      t.itinerary[key].push(obj);
    } else if (section === 'exp') {
      t.expenses.push(cleanExpense(obj));
    } else if (section === 'pack') {
      t.packing.push(cleanPackItem(obj));
    }
  }
  t.notes = notesBuf.join('\n').trim();
  if (!(t.days >= 1)) t.days = 1;
  return t;
}

function serializeTemplate(tp) {
  const L = [];
  L.push('---');
  L.push('name: ' + fmString(tp.name));
  L.push('---');
  L.push('');
  L.push('## 項目');
  L.push('');
  for (const it of tp.items || []) {
    L.push('- ' + JSON.stringify({ text: String(it.text || ''), zone: it.zone === 'checked' ? 'checked' : 'carry' }));
  }
  L.push('');
  return L.join('\n');
}

function parseTemplate(id, text) {
  const tp = { id, name: '', items: [] };
  text = String(text).replace(/\r\n/g, '\n');
  let body = text;
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const parsed = parseFrontmatterLine(line);
      if (parsed && parsed[0] === 'name') tp.name = String(parsed[1]);
    }
    body = text.slice(fm[0].length);
  }
  for (const line of body.split('\n')) {
    const im = /^-\s+(\{.*\})\s*$/.exec(line);
    if (!im) continue;
    try {
      const obj = JSON.parse(im[1]);
      tp.items.push({ text: String(obj.text || ''), zone: obj.zone === 'checked' ? 'checked' : 'carry' });
    } catch { /* 壞列跳過 */ }
  }
  return tp;
}

/* 行程點類別（categories）＝可管理的全域資源（v1.1）
 * 刻意用「單一檔 data/categories.md」而非一類一檔：類別清單小、變動少，
 * 手機端 Contents API 一次 PUT 一個 sha，整份覆蓋最不易分岔 */
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.md');

function defaultCategories() {
  return [
    { id: 'sight', label: '景點', emoji: '📍', color: '#0d9488' },
    { id: 'food', label: '美食', emoji: '🍜', color: '#ea8600' },
    { id: 'transport', label: '交通', emoji: '🚃', color: '#2f6fed' },
    { id: 'stay', label: '住宿', emoji: '🏨', color: '#8b5cf6' },
    { id: 'shop', label: '購物', emoji: '🛍️', color: '#e0447f' },
    { id: 'other', label: '其他', emoji: '✨', color: '#7a7265' },
  ];
}
function cleanCategory(c) {
  const o = {
    id: String((c && c.id) || '').trim(),
    label: String((c && c.label) || '').trim() || '未命名',
    emoji: String((c && c.emoji) || '✨'),
    color: String((c && c.color) || ''),
  };
  if (!/^#[0-9a-fA-F]{3,8}$/.test(o.color)) o.color = '#7a7265';
  if (!o.id) o.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  return o;
}
function normalizeCategories(list) {
  const out = [];
  const seen = {};
  for (const c of Array.isArray(list) ? list : []) {
    const o = cleanCategory(c);
    if (seen[o.id]) continue;
    seen[o.id] = true;
    out.push(o);
  }
  // 「其他」是刪除類別後的 fallback，不可少（UI 也不給刪）
  if (!out.some((c) => c.id === 'other')) out.push(defaultCategories()[5]);
  return out;
}
function serializeCategories(list) {
  const L = ['## 類別', ''];
  for (const c of normalizeCategories(list)) {
    L.push('- ' + JSON.stringify({ id: c.id, label: c.label, emoji: c.emoji, color: c.color }));
  }
  L.push('');
  return L.join('\n');
}
function parseCategories(text) {
  const out = [];
  for (const line of String(text).replace(/\r\n/g, '\n').split('\n')) {
    const im = /^-\s+(\{.*\})\s*$/.exec(line);
    if (!im) continue;
    try { out.push(JSON.parse(im[1])); } catch { /* 壞列跳過 */ }
  }
  return normalizeCategories(out);
}
async function readCategories() {
  try {
    return parseCategories(await fsp.readFile(CATEGORIES_FILE, 'utf8'));
  } catch {
    return defaultCategories(); // 檔案還沒建（或壞）：回內建六類，GET 不落地寫檔
  }
}
async function seedCategoriesIfMissing() {
  try { await fsp.access(CATEGORIES_FILE); return false; }
  catch {
    await atomicWrite(CATEGORIES_FILE, serializeCategories(defaultCategories()), 'utf8');
    console.log('[seed] default categories created (6)');
    return true;
  }
}

async function listDir(dir, parseFn) {
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.md'));
  const out = [];
  for (const f of files) {
    try {
      const text = await fsp.readFile(path.join(dir, f), 'utf8');
      out.push(parseFn(f.replace(/\.md$/, ''), text));
    } catch { /* 讀不到的跳過 */ }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 內建打包模板（種子資料：只在 templates 資料夾全空時建立）             */
/* ------------------------------------------------------------------ */

function seedTemplates() {
  return [
    { id: 'intl-basic', name: '出國基本款', items: [
      { text: '護照＋影本', zone: 'carry' },
      { text: '外幣現金＋信用卡', zone: 'carry' },
      { text: 'eSIM／網卡設定好', zone: 'carry' },
      { text: '行動電源＋充電線', zone: 'carry' },
      { text: '原子筆（入境表）', zone: 'carry' },
      { text: '換洗衣物', zone: 'checked' },
      { text: '盥洗包', zone: 'checked' },
      { text: '常備藥', zone: 'checked' },
      { text: '摺疊傘', zone: 'checked' },
      { text: '萬用轉接頭', zone: 'checked' },
      { text: '裝髒衣的袋子', zone: 'checked' },
    ] },
    { id: 'local-trip', name: '國內小旅行', items: [
      { text: '身分證／健保卡', zone: 'carry' },
      { text: '悠遊卡', zone: 'carry' },
      { text: '行動電源', zone: 'carry' },
      { text: '水壺', zone: 'carry' },
      { text: '換洗衣物', zone: 'checked' },
      { text: '盥洗包', zone: 'checked' },
      { text: '摺疊傘', zone: 'checked' },
    ] },
    { id: 'beach-onsen', name: '海邊／溫泉', items: [
      { text: '防曬乳', zone: 'carry' },
      { text: '墨鏡', zone: 'carry' },
      { text: '帽子', zone: 'carry' },
      { text: '泳衣', zone: 'checked' },
      { text: '快乾毛巾', zone: 'checked' },
      { text: '拖鞋', zone: 'checked' },
      { text: '防水袋', zone: 'checked' },
      { text: '溫泉小包（髮圈/髮夾）', zone: 'checked' },
    ] },
  ];
}

async function seedTemplatesIfEmpty() {
  const files = (await fsp.readdir(TEMPLATES_DIR)).filter((f) => f.endsWith('.md'));
  if (files.length) return false;
  for (const tp of seedTemplates()) {
    await atomicWrite(path.join(TEMPLATES_DIR, tp.id + '.md'), serializeTemplate(tp), 'utf8');
  }
  console.log('[seed] built-in packing templates created (3)');
  return true;
}

/* ------------------------------------------------------------------ */
/* v2.4 Google Maps 短連結 → 地址（stop.addr）                          */
/* 為什麼一定要 server 做：他貼的都是 maps.app.goo.gl 短連結，          */
/* 跟著 302 轉址才拿得到完整地址（比店名精確——「秀水湯包」有好幾家）， */
/* 而瀏覽器跨網域讀不到 Location，只有 server 端做得到。                */
/* ⚠️ addr 只加在行程點（stop）上；transit 一個欄位都不加，             */
/*    「路上」的路線連結是前端即時算的、不落資料（見 CLAUDE.md v1.3）。 */
/* ------------------------------------------------------------------ */

const ADDR_TIMEOUT_MS = 5000; // 單次請求逾時（別讓一個壞連結拖住整條佇列）
const ADDR_HOP_MAX = 5;       // 最多跟 5 層轉址
const ADDR_GAP_MS = 700;      // 兩次展開之間隔一下，別對 Google 狂打
const ADDR_MAX_PER_RUN = 40;  // 單次掃描的展開次數上限（剩下的下次再補）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 只對 Google 自家網域發請求（使用者可能貼進任何東西，不替他去打陌生站）
function isMapsHost(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return /(^|\.)google(\.[a-z]{2,3}){1,2}$/.test(h) || /(^|\.)goo\.gl$/.test(h) || /(^|\.)g\.co$/.test(h);
  } catch { return false; }
}

// 從一個 maps 網址抽地址：?q= 優先（那就是他當初挑的那一家），
// 抽不到再退 @lat,lng，最後退 data= 裡的 !3d<lat>!4d<lng>
function addrFromMapsUrl(u) {
  let url;
  try { url = new URL(u); } catch { return ''; }
  const q = (url.searchParams.get('q') || '').trim();
  if (q) return q;
  /* 路線型的分享連結（他從 Google Maps 分享「A 到 B」時會產生）沒有 q=，
   * 但目的地就明明白白在 daddr 裡。少了這一行，那種連結會永遠展不開、
   * 每次 CI 都白試三次。（QA 追出來的：先前判定「這條展不開」是錯的。） */
  const daddr = (url.searchParams.get('daddr') || '').trim();
  if (daddr) return daddr;
  /* ⚠️ 順序很重要：`!3d!4d` 是**店家本身的座標**，`@lat,lng,13z` 是**當時地圖畫面的
   * 中心點**（後面那個 z 是縮放層級）。舊版先讀 `@`，等於拿「螢幕正中央」當店的位置——
   * Benson 實際點開發現起點的圖釘不在店上（那次差 15 公尺，因為他剛好把店擺在畫面中間；
   * 店在畫面邊緣或縮得更遠時會差更多）。`@` 只能當最後的退路。 */
  const dd = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(url.href);
  if (dd) return dd[1] + ',' + dd[2];
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(url.href);
  if (at) return at[1] + ',' + at[2];
  return '';
}

// 只讀 header、不下載內容；任何錯誤都回 null（展開失敗不是致命的）
function fetchRedirect(u) {
  return new Promise((resolve) => {
    let mod;
    try { mod = new URL(u).protocol === 'http:' ? http : https; } catch { return resolve(null); }
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = mod.request(u, {
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; travel-book)', 'Accept-Language': 'zh-TW,zh;q=0.9' },
      }, (res) => {
        const loc = res.headers.location || '';
        res.destroy(); // 只要 header
        finish({ status: res.statusCode || 0, location: String(loc) });
      });
    } catch { return finish(null); }
    req.setTimeout(ADDR_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', () => finish(null));
    req.end();
  });
}

async function expandMapUrl(mapUrl) {
  let cur = /^https?:\/\//i.test(mapUrl) ? String(mapUrl) : 'https://' + String(mapUrl);
  for (let i = 0; i <= ADDR_HOP_MAX; i++) {
    if (!isMapsHost(cur)) return '';
    const hit = addrFromMapsUrl(cur);
    if (hit) return hit;                       // 已經是完整網址就不用連線
    const r = await fetchRedirect(cur);
    if (!r || !r.location) return '';          // 沒有下一跳（或失敗）＝抽不到
    try { cur = new URL(r.location, cur).toString(); } catch { return ''; }
  }
  return '';
}

// 展開工作全部串成一條佇列：慢、失敗都不影響存檔，也不會並發狂打
let addrChain = Promise.resolve();
function queueAddrJob(fn) {
  addrChain = addrChain.then(fn).catch((e) => console.error('[addr] job failed:', e.message));
  return addrChain;
}

// 同一個檔的寫入排隊（POST 與 addr 補寫共用），避免補寫蓋掉剛存進來的資料
const tripWriteChains = new Map();
function queueTripWrite(id, fn) {
  const prev = tripWriteChains.get(id) || Promise.resolve();
  const next = prev.then(fn, fn);
  tripWriteChains.set(id, next.then(() => {}, () => {}));
  return next;
}

function eachStop(trip, fn) {
  for (const key of Object.keys((trip && trip.itinerary) || {})) {
    for (const s of trip.itinerary[key] || []) if (s && !isTransit(s)) fn(s);
  }
}

// 存檔時：mapUrl 沒變就沿用既有 addr（手機端舊版本會把 addr 洗掉，這裡補回來）；
// mapUrl 被清空 → addr 也跟著失效（addr 是 mapUrl 的衍生值）
function inheritAddrs(trip, existing) {
  const prev = new Map();
  eachStop(existing, (s) => { if (s.addr) prev.set(String(s.id || ''), { mapUrl: String(s.mapUrl || ''), addr: String(s.addr) }); });
  eachStop(trip, (s) => {
    if (!s.mapUrl) { delete s.addr; return; }
    if (s.addr) return;
    const p = prev.get(String(s.id || ''));
    if (p && p.mapUrl === String(s.mapUrl)) s.addr = p.addr;
  });
}

// 補齊一趟旅程裡「有 mapUrl 但沒 addr」的行程點。整段包在 try/catch 外由 queueAddrJob 接住：
// 失敗只記 log、下次啟動或下次存檔再試，絕不影響使用者存檔
async function backfillTripAddrs(id, budget) {
  const file = path.join(TRIPS_DIR, id + '.md');
  let trip;
  try { trip = parseTrip(id, await fsp.readFile(file, 'utf8')); } catch { return 0; }
  const todo = [];
  eachStop(trip, (s) => { if (s.mapUrl && !s.addr) todo.push({ sid: String(s.id || ''), mapUrl: String(s.mapUrl) }); });
  if (!todo.length) return 0;
  const cap = Math.min(todo.length, budget == null ? ADDR_MAX_PER_RUN : budget);
  const found = [];
  for (let i = 0; i < cap; i++) {
    const addr = await expandMapUrl(todo[i].mapUrl);
    if (addr) found.push({ sid: todo[i].sid, mapUrl: todo[i].mapUrl, addr });
    else console.log('[addr] no address from ' + todo[i].mapUrl);
    if (i < cap - 1) await sleep(ADDR_GAP_MS);
  }
  if (!found.length) return cap;
  await queueTripWrite(id, async () => {
    let latest; // 重讀最新的檔（展開期間他可能又存過檔），只補「還是同一條 mapUrl 且還沒有 addr」的
    try { latest = parseTrip(id, await fsp.readFile(file, 'utf8')); } catch { return; }
    let n = 0;
    eachStop(latest, (s) => {
      const f = found.find((x) => x.sid === String(s.id || ''));
      if (f && !s.addr && String(s.mapUrl || '') === f.mapUrl) { s.addr = f.addr; n++; }
    });
    if (!n) return;
    await atomicWrite(file, serializeTrip(latest), 'utf8'); // updatedAt 沿用檔案裡原本的值，不算他改過
    console.log('[addr] ' + id + ': 補上 ' + n + ' 筆地址');
    scheduleSync();
  });
  return cap;
}

// 啟動時補掃一次：把手機端新增、電腦還沒展開過的補齊
async function scanAllAddrs() {
  let budget = ADDR_MAX_PER_RUN;
  let files = [];
  try { files = (await fsp.readdir(TRIPS_DIR)).filter((f) => f.endsWith('.md')); } catch { return; }
  for (const f of files) {
    if (budget <= 0) { console.log('[addr] 本次掃描已達上限，其餘下次再補'); return; }
    budget -= await backfillTripAddrs(f.replace(/\.md$/, ''), budget);
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;

  // GET /api/data -> 一次拿全部（trips + templates + categories），前端啟動只打一發
  if (p === '/api/data' && method === 'GET') {
    const trips = await listDir(TRIPS_DIR, parseTrip);
    const templates = await listDir(TEMPLATES_DIR, parseTemplate);
    const categories = await readCategories();
    return sendJson(res, 200, { trips, templates, categories });
  }

  // POST /api/categories（整份清單覆蓋；server 保證「其他」存在＋id 去重）
  if (p === '/api/categories' && method === 'POST') {
    const body = await readJson(req);
    const list = normalizeCategories(body.categories || body);
    await atomicWrite(CATEGORIES_FILE, serializeCategories(list), 'utf8');
    scheduleSync();
    return sendJson(res, 200, { ok: true, categories: await readCategories() });
  }

  // POST /api/trips（新增或整份更新；body = 完整 trip 物件）
  if (p === '/api/trips' && method === 'POST') {
    const body = await readJson(req);
    const now = new Date().toISOString();
    let id = body.id ? safeName(body.id) : '';
    if (!id) id = Date.now().toString(36) + '-' + slugify(body.name);
    if (!String(body.name || '').trim()) return sendJson(res, 400, { ok: false, message: '旅程名稱不可為空。' });
    const file = path.join(TRIPS_DIR, id + '.md');
    const saved = await queueTripWrite(id, async () => {
      let createdAt = body.createdAt || now;
      let existing = null;
      try {
        existing = parseTrip(id, await fsp.readFile(file, 'utf8'));
        if (existing.createdAt) createdAt = existing.createdAt; // 更新時保留原 createdAt
      } catch { /* 用給的 id 開新檔 */ }
      const trip = Object.assign({}, body, { id, createdAt, updatedAt: now });
      inheritAddrs(trip, existing); // v2.4：mapUrl 沒變就沿用已展開的地址
      await atomicWrite(file, serializeTrip(trip), 'utf8');
      return parseTrip(id, await fsp.readFile(file, 'utf8'));
    });
    scheduleSync();
    // v2.4：有 mapUrl 沒 addr 的行程點，背景去展開短連結（非同步；失敗只記 log，不影響這次存檔）
    queueAddrJob(() => backfillTripAddrs(id));
    return sendJson(res, 200, { ok: true, trip: saved });
  }

  // DELETE /api/trips/:id
  const tripSingle = /^\/api\/trips\/([^/]+)$/.exec(p);
  if (tripSingle && method === 'DELETE') {
    const id = safeName(decodeURIComponent(tripSingle[1]));
    try { await fsp.unlink(path.join(TRIPS_DIR, id + '.md')); } catch { /* 已不存在 */ }
    scheduleSync();
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/templates（新增或整份更新）
  if (p === '/api/templates' && method === 'POST') {
    const body = await readJson(req);
    let id = body.id ? safeName(body.id) : '';
    if (!id) id = Date.now().toString(36) + '-' + slugify(body.name);
    const tp = { id, name: String(body.name || '').trim() || '未命名模板', items: Array.isArray(body.items) ? body.items : [] };
    await atomicWrite(path.join(TEMPLATES_DIR, id + '.md'), serializeTemplate(tp), 'utf8');
    scheduleSync();
    return sendJson(res, 200, { ok: true, template: parseTemplate(id, await fsp.readFile(path.join(TEMPLATES_DIR, id + '.md'), 'utf8')) });
  }

  // DELETE /api/templates/:id
  const tplSingle = /^\/api\/templates\/([^/]+)$/.exec(p);
  if (tplSingle && method === 'DELETE') {
    const id = safeName(decodeURIComponent(tplSingle[1]));
    try { await fsp.unlink(path.join(TEMPLATES_DIR, id + '.md')); } catch { /* 已不存在 */ }
    scheduleSync();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'unknown endpoint' });
}

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  return streamFile(res, file);
}

function streamFile(res, file) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 not found');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!res.headersSent) {
      if (/payload too large/i.test(msg)) {
        sendJson(res, 413, { ok: false, code: 'too_large', message: '資料太大，超過伺服器上限。' });
      } else if (e instanceof SyntaxError) {
        sendJson(res, 400, { ok: false, code: 'bad_json', message: '請求格式錯誤。' });
      } else {
        sendJson(res, 500, { ok: false, code: 'server_error', message: '伺服器錯誤：' + msg });
      }
    } else res.end();
  }
});

/* ------------------------------------------------------------------ */
/* 啟動（只有「直接 node server.js」才跑）                              */
/* v2.5 起這支檔也會被 .github/scripts/backfill-addrs.js `require` 進去 */
/* 借用地址展開邏輯（見下方 module.exports）。被 require 時：           */
/* 不 build docs/、不開 port、不 initSync——CI 只准碰 data/。            */
/* ------------------------------------------------------------------ */
if (require.main === module) {
  // 啟動先鏡射 docs/（保證從任何入口啟動——start.bat 或 tool-manager 面板——
  // docs/ 都不落後 public/）；build 失敗只記 log，不擋本機服務
  try {
    require('./build.js').build();
  } catch (e) {
    console.error('[build] failed (continuing):', e.message);
  }

  server.listen(PORT, async () => {
    console.log('Travel Book server running at http://localhost:' + PORT);
    console.log('Data dir: ' + DATA_DIR);
    await initSync(); // 先 pull（若手機端剛建了模板/旅程，避免重複種子）
    try {
      const seededTpl = await seedTemplatesIfEmpty();
      const seededCat = await seedCategoriesIfMissing();
      if (seededTpl || seededCat) scheduleSync();
    } catch (e) {
      console.error('[seed] failed:', e.message);
    }
    // v2.4：補掃一次短連結 → 地址（手機端新增的行程點在這裡補齊）；背景跑，掛了不影響服務
    queueAddrJob(scanAllAddrs);
  });
}

/* ------------------------------------------------------------------ */
/* 對外（給 GitHub Actions 的補地址腳本用）                             */
/* ⚠️ 刻意只匯出地址展開這一組：手機端做不到展開（瀏覽器讀不到跨網域   */
/*    的 Location），所以 Actions 要跑「同一份」邏輯，不可以再寫一份    */
/*    會分岔的實作。這個專案已經有「前後端兩套 parser 要一起改」的債，  */
/*    不要再加第三套。                                                  */
/* ------------------------------------------------------------------ */
module.exports = { scanAllAddrs, backfillTripAddrs, expandMapUrl, TRIPS_DIR, DATA_DIR };
