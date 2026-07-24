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
function cleanStop(s) {
  const o = { id: String(s.id || '') };
  o.title = String(s.title || '');
  if (s.time) o.time = String(s.time);
  if (s.cat) o.cat = String(s.cat);
  if (s.place) o.place = String(s.place);
  if (s.note) o.note = String(s.note);
  if (s.mapUrl) o.mapUrl = String(s.mapUrl);
  if (Number(s.cost)) o.cost = Number(s.cost);
  if (Number(s.stayMinutes)) o.stayMinutes = Math.round(Number(s.stayMinutes)); // v1.2 預計停留（分鐘）
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
    let createdAt = body.createdAt || now;
    if (id) {
      try {
        const existing = parseTrip(id, await fsp.readFile(path.join(TRIPS_DIR, id + '.md'), 'utf8'));
        if (existing.createdAt) createdAt = existing.createdAt; // 更新時保留原 createdAt
      } catch { /* 用給的 id 開新檔 */ }
    } else {
      id = Date.now().toString(36) + '-' + slugify(body.name);
    }
    const trip = Object.assign({}, body, { id, createdAt, updatedAt: now });
    if (!String(trip.name || '').trim()) return sendJson(res, 400, { ok: false, message: '旅程名稱不可為空。' });
    await atomicWrite(path.join(TRIPS_DIR, id + '.md'), serializeTrip(trip), 'utf8');
    scheduleSync();
    return sendJson(res, 200, { ok: true, trip: parseTrip(id, await fsp.readFile(path.join(TRIPS_DIR, id + '.md'), 'utf8')) });
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
});
