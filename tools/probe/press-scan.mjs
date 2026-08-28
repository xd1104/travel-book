/* press-scan.mjs — 用真 Chrome ＋ 真滑鼠事件，**全掃描**每一個可點元素的按下回饋
   ------------------------------------------------------------------
   為什麼要有它：
     「按下回饋每個可點的東西都要有」這件事，**列白名單一定會漏**
     （好雷嗎那一輪就是列白名單漏了第 5 顆，自測全綠）。
     這支 App 更嚴重：畫面是 app.js 用字串拼出來的，class 名稱有一半是動態組的
     ⇒ 任何靜態清單都不可能完整。
     而且 `animation-fill-mode:both` 把 :active 永久蓋掉那一類 bug，
     **只有在真瀏覽器裡壓下去量 computed transform 才抓得到**。

   量法（四個自證，缺一不可）：
     ① 元素清單是**掃出來的**：button / a / [role=button] / [tabindex]
        ＋ 任何 computed cursor 是 pointer 的元素，取聯集。
        掃到少於 MIN_TARGETS 個就判定「尺壞了」，不是「通過」。
     ② 壓下去之前先做**命中測試**（elementFromPoint）：被面板／遮罩蓋住的
        這一輪不算「沒有回饋」，記成「這個階段測不到」。所有階段都測不到才算未能測，
        而且會被印出來 —— **不可以靜靜當成通過**。
     ③ 用 Input.dispatchMouseEvent 發**真的**滑鼠事件（不是 dispatchEvent 假事件）。
        ⚠️ 放開之前先把游標移到別的地方 ⇒ 不會觸發 click，
           掃描過程不會真的按到「刪除」「重新排」。
     ④ **負控組**：把 motion.css 的按下回饋換成 transform:none 再掃一次，
        這一趟必須抓到一堆「沒有回饋」。沒有負控組的話「全部都有」可能只是判準恆真。

   另外驗一件事：**#app 收到 .boot（開場銜接動畫）之後 :active 仍然有效**
   —— 進場動畫如果用了 both／forwards，殘留的 transform 會把 :active 蓋掉。

   用法：node tools/probe/press-scan.mjs [--port=8471] [--dev=9871]
   exit 0 ＝ 過；1 ＝ 有可點元素沒有回饋／沒測到；2 ＝ 尺壞了
*/
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CDP } from "./cdp.mjs";
import { createProbeServer } from "./server.mjs";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const A = Object.fromEntries(process.argv.slice(2).map(s => {
  const [k, v] = s.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const PORT = Number(A.port || 8471);
const DEV = Number(A.dev || 9871);
const MIN_TARGETS = 60;          /* 掃到比這少 ＝ 尺壞了 */

/* ⭐ 明確的例外清單：可點、但**刻意沒有**按下回饋的元素。
   長度有斷言（防止有人把礙事的元素偷偷加進來矇混過關）。 */
const EXEMPT = [
  { sel: ".backdrop", why: "背景遮罩：點它是關閉，但它不是一顆按鈕，縮放會像整個畫面在抖" },
  { sel: ".pk-grip", why: "打包把手：自己有「充能」回饋（按住 220ms 底色長出來），而且按下去會一直拖" },
  { sel: ".drag-handle", why: "行程把手：自己有「卡片浮起＋把手轉珊瑚」回饋，而且按下去會一直拖" }
];
const EXEMPT_COUNT = 3;

if (!fs.existsSync(CHROME)) {
  console.log("[未能執行] 找不到 Chrome：" + CHROME);
  console.log("           這支沒跑 ＝「每個可點元素都有按下回饋」沒有被真瀏覽器驗過。");
  process.exit(2);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let killPress = false;
const server = createProbeServer({});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));

/* ---- 頁面裡的掃描器 ---- */
const SCAN = String.raw`
(function(){
  window.__desc = function(el){
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.className && typeof el.className === "string") {
      s += "." + el.className.trim().split(/\s+/).filter(Boolean).slice(0,2).join(".");
    }
    var txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12);
    return s + (txt ? " [" + txt + "]" : "");
  };
  function ownTarget(el){
    var t = el.tagName.toLowerCase();
    if (t === "button" || t === "a" || el.getAttribute("role") === "button" || el.hasAttribute("tabindex")) return true;
    /* ⚠️ 這支 App 有兩種「不是 button 也沒有 cursor:pointer」的可點形狀，
       純靠 tag／cursor 掃**掃不到**（第一版就漏了 .stop-card / .transit-bar 兩個，
       而它們正好是唯二整塊可點的 div ⇒ 尺的涵蓋範圍比宣稱的小）：
         · .tappable   —— 行程卡片、移動灰條（div + onclick）
         · label.pick  —— 色票／emoji 選擇（裡面是隱藏的 radio，label 沒有 cursor:pointer）
       這兩種正是 motion.css 第 2 段點名的形狀，一定要掃得到。 */
    if (el.classList && el.classList.contains("tappable")) return true;
    if (t === "label" && el.classList && (el.classList.contains("pick") || el.classList.contains("check-row"))) return true;
    return false;
  }
  function anyTarget(el){
    return ownTarget(el) || getComputedStyle(el).cursor === "pointer";
  }
  window.__targets = function(){
    var all = [].slice.call(document.querySelectorAll("*"));
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest && el.closest("#splash")) continue;
      if (el.closest && el.closest("#kr-full")) continue;   /* 鑰匙圈模組自己帶回饋、不歸我們管 */
      var tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") continue;
      var cs = getComputedStyle(el);
      var own = ownTarget(el);
      if (!own && cs.cursor !== "pointer") continue;
      if (el.disabled) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      /* 只有「靠 cursor:pointer 中選」的才做祖先檢查（cursor 會繼承，
         .trip-card 底下的 span 也是 pointer，但回饋發生在祖先身上）。 */
      if (!own) {
        var p = el.parentElement, anc = false;
        while (p && p !== document.documentElement) {
          if (anyTarget(p)) { anc = true; break; }
          p = p.parentElement;
        }
        if (anc) continue;
      }
      out.push(el);
    }
    window.__T = out;
    return out.map(window.__desc);
  };
  window.__center = function(i){
    var el = window.__T[i];
    el.scrollIntoView({ block: "center", inline: "center" });
    var r = el.getBoundingClientRect();
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    var inView = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    var hit = document.elementFromPoint(x, y);
    var reachable = inView && !!hit && (hit === el || el.contains(hit));
    return { x: x, y: y, reachable: reachable, hit: hit ? window.__desc(hit) : "(none)" };
  };
  window.__tf = function(i){ return getComputedStyle(window.__T[i]).transform; };
})();
`;

let runNo = 0;
async function boot() {
  const profile = path.join(os.tmpdir(), "tb-press-" + DEV + "-" + (++runNo));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  /* ⚠️ --user-data-dir 一定要指到暫存資料夾：不指的話會去搶 Benson 正在用的 profile。 */
  const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=" + DEV,
    "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "about:blank"], { stdio: "ignore", shell: false });
  for (let i = 0; i < 200; i++) {
    try { await fetch("http://127.0.0.1:" + DEV + "/json/version"); break; } catch (e) { await sleep(100); }
  }
  const t = await (await fetch("http://127.0.0.1:" + DEV + "/json/new?about:blank", { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  const c = new CDP(ws);
  await c.send("Page.enable");
  await c.send("Network.enable");
  await c.send("Network.setBlockedURLs", { urls: ["*github.io*", "*githubusercontent.com*", "*api.github.com*"] });
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  c.on("Page.javascriptDialogOpening", () => c.send("Page.handleJavaScriptDialog", { accept: false }));
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: SCAN });
  await c.send("Page.navigate", { url: "http://127.0.0.1:" + PORT + "/index.html" });
  /* 等開場收完（MIN_SHOW 950 ＋ 收場）＋ .boot 銜接動畫（1400ms）跑完 */
  await sleep(3000);
  return { c, ch };
}
async function ev(c, expr) {
  const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error(expr + " -> " + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 200));
  return r.result.value;
}

async function press(c, i) {
  const pos = JSON.parse(await ev(c, "JSON.stringify(window.__center(" + i + "))"));
  if (!pos.reachable) return { skipped: true, hit: pos.hit };
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y, button: "none", buttons: 0 });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(150);                       /* > --dur-press 120ms，讓 transition 走完 */
  const during = await ev(c, "window.__tf(" + i + ")");
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "left", buttons: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 2, y: 2, button: "left", buttons: 0, clickCount: 1 });
  await sleep(20);
  return { during };
}

function scaleOf(tf) {
  if (!tf || tf === "none") return 1;
  const m = /^matrix\(([-\d.eE]+)/.exec(tf);
  return m ? Number(m[1]) : NaN;
}

const TRIP = "probe-a-明天出發";
/* 每個階段：先跑 prep（用 App 自己的全域函式換畫面），等 render 完再全掃描。 */
const PHASES = [
  ["首頁", null],
  ["首頁+旅行回憶", "goHome(); toggleEnded(); 1"],
  ["行程", "goHome(); openTrip('" + TRIP + "'); 1"],
  ["行程・調整模式", "toggleEdit(); 1"],
  ["行程點詳細 sheet", "toggleEdit(); openStopDetail(0); 1"],
  ["新增選單 sheet", "closeSheet(); openAddPicker(); 1"],
  ["行程點表單 sheet", "closeSheet(); openStopSheet(); 1"],
  ["移動表單 sheet", "closeSheet(); openTransitSheet(); 1"],
  ["花費", "closeSheet(); setTab('budget'); 1"],
  ["花費表單 sheet", "openExpenseSheet(); 1"],
  ["打包", "closeSheet(); setTab('pack'); 1"],
  ["打包・包展開", "pkToggleBag('p3'); 1"],
  ["打包・物品選單 sheet", "openPackActions('p2'); 1"],
  ["備註", "closeSheet(); setTab('notes'); 1"],
  ["打包・編輯物品 sheet", "closeSheet(); openPackSheet('p2'); 1"],
  ["打包・模板 sheet", "closeSheet(); openTplPicker(); 1"],
  ["打包・模板管理 sheet", "closeSheet(); openTplManager(); 1"],
  ["打包・編輯模板 sheet", "closeSheet(); openTplEdit('tpl-probe'); 1"],
  ["類別管理 sheet", "closeSheet(); openCatManager(); 1"],
  ["編輯類別 sheet", "closeSheet(); openCatEdit('food'); 1"],
  ["編輯旅程 sheet", "closeSheet(); goHome(); openTripSheet('" + TRIP + "'); 1"],
  ["版本 sheet", "closeSheet(); openVersion(); 1"]
];

async function scanPhase(c, label, prep) {
  if (prep) {
    try { await ev(c, prep); } catch (e) { return [{ label, name: "(prep 失敗)", prepError: String(e.message).slice(0, 160) }]; }
    await sleep(650);
  }
  const list = JSON.parse(await ev(c, "JSON.stringify(window.__targets())"));
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    /* ⚠️⚠️ 例外名單裡的兩個把手**不可以壓**（2026-08-28 實測踩到）：
       它們掛的是 onpointerdown（packGripDown／dragStart），而這支探針
       「按下 → 把游標移到 (2,2) → 放開」的動作，對它們來說就是
       「按住 ＋ 往左上大幅拖曳」＝真的觸發一次拖曳排序 ⇒ 清單重排、整棵樹重繪
       ⇒ window.__T 裡後面所有元素全部變成 detached node，rect 全是 0，
       於是被判成「被蓋住・未能測」——**症狀長得像 App 壞了，其實是探針自己弄壞的**。
       它們本來就在例外名單裡（有自己的專屬回饋），跳過不影響判準。 */
    if (EXEMPT.some(e => list[i].indexOf(e.sel) >= 0)) {
      rows.push({ label, name: list[i], exemptSkip: true });
      continue;
    }
    const r = await press(c, i);
    if (r.skipped) { rows.push({ label, name: list[i], skipped: true, hit: r.hit }); continue; }
    /* 自證：壓完之後那個節點還要在 DOM 上。掉出去了代表這一趟量到的是幽靈，
       要出聲，不可以當成「有量到」。 */
    const alive = await ev(c, "!!(window.__T[" + i + "] && window.__T[" + i + "].isConnected)");
    if (!alive) { rows.push({ label, name: list[i], skipped: true, hit: "(節點在量測中被重繪掉了)" }); continue; }
    rows.push({ label, name: list[i], during: r.during, s: scaleOf(r.during) });
  }
  return rows;
}

async function fullScan() {
  const { c, ch } = await boot();
  try {
    const rows = [];
    for (const [label, prep] of PHASES) rows.push(...await scanPhase(c, label, prep));
    return rows;
  } finally { ch.kill(); }
}

function analyse(rows) {
  const byName = new Map();
  const prepErrors = [];
  rows.forEach(r => {
    if (r.prepError) { prepErrors.push(r.label + "：" + r.prepError); return; }
    const cur = byName.get(r.name) || { name: r.name, best: -1, phases: [], tested: 0, skipped: 0, hits: [] };
    if (r.exemptSkip) { /* 例外：不壓、也不算未能測 */ }
    else if (r.skipped) { cur.skipped++; if (r.hit) cur.hits.push(r.label + "→" + r.hit); }
    else {
      cur.tested++;
      const s = Number.isNaN(r.s) ? -1 : r.s;
      if (cur.best < 0 || s < cur.best) { cur.best = s; cur.bestPhase = r.label; }
      cur.phases.push(r.label + "=" + (Number.isNaN(r.s) ? "?" : r.s.toFixed(3)));
    }
    byName.set(r.name, cur);
  });
  const uniq = [...byName.values()];
  const bad = [], untested = [], exempted = [];
  uniq.forEach(r => {
    if (EXEMPT.some(e => r.name.indexOf(e.sel) >= 0)) { exempted.push(r); return; }
    if (!r.tested) { untested.push(r); return; }
    if (!(r.best < 0.9995)) bad.push(r.name + "：按下去沒有縮放（" + r.phases.slice(0, 4).join(", ") + "）");
  });
  return { uniq, bad, untested, exempted, prepErrors };
}

console.log("量測條件：390x844、真滑鼠事件、每顆壓 150ms 後讀 computed transform、放開前把游標移開（不觸發 click）");
console.log("階段（" + PHASES.length + "）：" + PHASES.map(p => p[0]).join("／") + "\n");

const real = analyse(await fullScan());
console.log("=== 現行版：全掃描到 " + real.uniq.length + " 個可點目標 ===");
real.uniq.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(r => {
  const ex = EXEMPT.some(e => r.name.indexOf(e.sel) >= 0);
  const mark = ex ? "（例外）" : (!r.tested ? "未能測" : (r.best < 0.9995 ? "  ✓ " : "  ✗ "));
  const val = r.tested ? ("scale=" + r.best.toFixed(3) + " @" + r.bestPhase) : ("（每個階段都被蓋住 " + r.skipped + " 次）");
  console.log("  " + mark + " " + val.padEnd(30) + " " + r.name);
});
real.prepErrors.forEach(m => console.log("  [階段沒跑起來] " + m));
real.bad.forEach(m => console.log("  [錯誤] " + m));
real.untested.forEach(r => console.log("  [未能測] " + r.name + "  ← " + (r.hits.slice(0,3).join(" ; ") || "(沒有命中資訊)")));

server.__state.nopress = true;
const neg = analyse(await fullScan());
server.__state.nopress = false;
console.log("\n=== 負控組：把 motion.css 的 transform:scale(var(--press*)) 換成 none ===");
console.log("  抓到 " + neg.bad.length + " 個沒有回饋（現行版 " + real.bad.length + " 個）");

server.close();
let code = 0;
if (real.uniq.length < MIN_TARGETS) { console.log("\n[尺壞了] 只掃到 " + real.uniq.length + " 個目標（門檻 " + MIN_TARGETS + "）。"); code = 2; }
if (EXEMPT.length !== EXEMPT_COUNT) { console.log("\n[尺壞了] 例外清單長度是 " + EXEMPT.length + "，斷言是 " + EXEMPT_COUNT + "。"); code = 2; }
if (neg.bad.length <= real.bad.length) { console.log("\n[尺壞了] 負控組抓到的數量沒有比現行版多 ⇒ 這支量的東西是恆綠的。"); code = 2; }
if (real.prepErrors.length) { console.log("\n[尺壞了] 有 " + real.prepErrors.length + " 個階段沒跑起來，那些畫面等於沒測。"); code = 2; }
if (real.bad.length) { console.log("\n[未過] 有 " + real.bad.length + " 個可點元素沒有按下回饋。"); code = code || 1; }
if (real.untested.length) { console.log("\n[未過] 有 " + real.untested.length + " 個目標從頭到尾沒被測到，不算通過。"); code = code || 1; }
if (!code) {
  console.log("\n[通過] " + (real.uniq.length - real.exempted.length) + " 個可點目標全部有按下回饋；" +
    "例外 " + real.exempted.length + " 個（" + EXEMPT.map(e => e.sel).join("、") + "）；" +
    "負控組被抓到 " + neg.bad.length + " 個 ⇒ 這把尺會紅。");
}
process.exit(code);
