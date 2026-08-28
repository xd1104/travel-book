/* flows.mjs — 真瀏覽器的流程體檢（開場 ／ 降級路徑 ／ reduced-motion ／ sheet 開關 ／ 骨架屏）
   ------------------------------------------------------------------
   靜態守衛（tools/check-splash.js）只證得了「程式碼長對了」，
   下面這些**只有真的跑起來才知道**：
     A. 冷啟動：第一幀就是開場（底色 #f7f4ee ＋ 置中符號），開場最後**從 DOM 移除**（不是 hidden）
     B. 熱啟動（同一個分頁 reload）：一幀開場都不播
     C. reduced-motion：開場仍然收得掉、app 完整可用
     D. 降級四條：CSS 遲到 ／ CSS 全 404 ／ splash.js 404 ／ JS 停用
     E. sheet：開 → 有進場動畫；關 → 有離場動畫、240ms 內從 DOM 清空；
        連續開關、開場動畫還沒演完就關 —— 都不可以卡住
     F. 骨架屏：/api/data 慢的時候畫面上是旅程卡形狀的骨架，不是一片空白

   ⚠️ 每一條都印出實測值，不是「看起來對」。
   用法：node tools/probe/flows.mjs [--dev=9872]
   exit 0 ＝ 全過；1 ＝ 有沒過的
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
const DEV = Number(A.dev || 9872);
const PORT = Number(A.port || 8472);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!fs.existsSync(CHROME)) {
  console.log("[未能執行] 找不到 Chrome：" + CHROME);
  process.exit(2);
}

const server = createProbeServer({});
await new Promise(r => server.listen(PORT, "127.0.0.1", r));
const URL_ = "http://127.0.0.1:" + PORT + "/index.html";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log("  " + (ok ? "✓" : "✗") + " " + name + "　" + detail);
}

let runNo = 0;
async function launch(opts = {}) {
  const profile = path.join(os.tmpdir(), "tb-flow-" + DEV + "-" + (++runNo));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
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
  if (opts.reduce) await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  if (opts.nojs) await c.send("Emulation.setScriptExecutionDisabled", { value: true });
  return { c, ch };
}
async function ev(c, expr) {
  const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 200));
  return r.result.value;
}
/* 取畫面正中央那顆像素的顏色（第一幀是不是開場的底色，用量的不是用猜的） */
async function centerPixel(c) {
  const { data } = await c.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const buf = Buffer.from(data, "base64");
  return await pngPixel(buf, 195, 60);   /* 上方 1/14 處：一定落在底色上、避開中央的符號方塊 */
}
/* 極簡 PNG 解碼（只支援 8-bit RGBA / RGB，Chrome 截圖就是這種） */
import zlib from "node:zlib";
async function pngPixel(buf, x, y) {
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === "IDAT") idat.push(data);
    if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!ch || bitDepth !== 8) return null;
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let row = 0; row < h; row++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(row * stride, (row + 1) * stride);
    const prev = row ? out.subarray((row - 1) * stride, row * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], cc = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : cc); }
      cur[i] = v & 255;
    }
  }
  const o = y * stride + x * ch;
  const hex = n => n.toString(16).padStart(2, "0");
  return "#" + hex(out[o]) + hex(out[o + 1]) + hex(out[o + 2]);
}

console.log("\n=== A. 冷啟動 ===");
{
  const { c, ch } = await launch();
  await c.send("Page.navigate", { url: URL_ });
  await sleep(220);                                  /* 開場的第一拍（--sp-hold 220ms）之內 */
  const early = await ev(c, "JSON.stringify({sp:!!document.getElementById('splash'),att:document.documentElement.getAttribute('data-splash'),gate:document.documentElement.hasAttribute('data-cssgate')})");
  const px = await centerPixel(c);
  check("第一幀底色 ＝ #f7f4ee（manifest / theme-color / --bg 同一個值）", px === "#f7f4ee", "實測中央上方像素 " + px);
  check("開場一開始就在畫面上", JSON.parse(early).sp === true, early);
  await sleep(2600);
  const after = await ev(c, "JSON.stringify({sp:!!document.getElementById('splash'),att:document.documentElement.getAttribute('data-splash'),cards:document.querySelectorAll('.trip-card').length,gate:document.documentElement.hasAttribute('data-cssgate')})");
  const a = JSON.parse(after);
  check("開場收掉後 #splash 已從 DOM 移除（不是 hidden）", a.sp === false, after);
  check("閘門 data-cssgate 已開", a.gate === false, "gate=" + a.gate);
  check("資料畫出來了（旅程卡 1 張＝fixture 的進行中旅程）", a.cards === 1, "trip-card=" + a.cards);
  /* .boot 銜接：1400ms 後要自己拿掉，殘留會把 :active 殺掉 */
  const bootGone = await ev(c, "document.getElementById('app').classList.contains('boot')");
  check(".boot 銜接 class 已自己拿掉（殘留會殺掉 :active）", bootGone === false, "app.classList.boot=" + bootGone);
  ch.kill();
}

console.log("\n=== B. 熱啟動（同一個分頁 reload，同一個 session）===");
{
  const { c, ch } = await launch();
  await c.send("Page.navigate", { url: URL_ });
  await sleep(2600);
  await c.send("Page.reload");
  await sleep(120);
  const hot = await ev(c, "JSON.stringify({att:document.documentElement.getAttribute('data-splash'),sp:!!document.getElementById('splash')})");
  const h = JSON.parse(hot);
  check("熱啟動不播開場（data-splash=off，body 解析前就掛上）", h.att === "off", hot);
  await sleep(2000);
  const cards = await ev(c, "document.querySelectorAll('.trip-card').length");
  check("熱啟動後資料照樣畫得出來", cards === 1, "trip-card=" + cards);
  ch.kill();
}

console.log("\n=== C. 減少動態（prefers-reduced-motion: reduce）===");
{
  const { c, ch } = await launch({ reduce: true });
  await c.send("Page.navigate", { url: URL_ });
  await sleep(2200);
  const r = await ev(c, "JSON.stringify({sp:!!document.getElementById('splash'),cards:document.querySelectorAll('.trip-card').length,dur:getComputedStyle(document.documentElement).getPropertyValue('--dur-2').trim(),press:getComputedStyle(document.documentElement).getPropertyValue('--press').trim()})");
  const o = JSON.parse(r);
  check("reduce 之下開場仍然收得掉", o.sp === false, r);
  check("reduce 之下 app 完整可用", o.cards === 1, "trip-card=" + o.cards);
  check("reduce 只把 token 歸零（--dur-2=1ms、--press=1）", o.dur === "1ms" && o.press === "1", "--dur-2=" + o.dur + " --press=" + o.press);
  /* sheet 在 reduce 之下也要關得掉 */
  await ev(c, "openTrip('probe-a-明天出發'); 1");
  await sleep(200);
  await ev(c, "openAddPicker(); 1");
  await sleep(150);
  const opened = await ev(c, "!document.getElementById('sheet-layer').hidden");
  await ev(c, "closeSheet(); 1");
  await sleep(400);
  const closed = await ev(c, "JSON.stringify({hidden:document.getElementById('sheet-layer').hidden,kids:document.getElementById('sheet-layer').children.length})");
  check("reduce 之下 sheet 開得起來也關得掉", opened === true && JSON.parse(closed).hidden === true && JSON.parse(closed).kids === 0, "開=" + opened + " 關後=" + closed);
  ch.kill();
}

console.log("\n=== D. 降級路徑 ===");
/* D1：CSS 遲到（媒體 print → onload 才切回 all；這裡直接量閘門有沒有正確開關） */
{
  const { c, ch } = await launch();
  await c.send("Network.setBlockedURLs", { urls: ["*github.io*", "*githubusercontent.com*", "*api.github.com*"] });
  await c.send("Emulation.setCPUThrottlingRate", { rate: 6 });   /* 讓 CSS 相對「遲到」 */
  await c.send("Page.navigate", { url: URL_ });
  await sleep(60);
  const px = await centerPixel(c);
  check("D1 CSS 遲到：第一幀仍然是開場底色，不是白的", px === "#f7f4ee", "實測 " + px);
  await c.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await sleep(3500);
  const ok = await ev(c, "JSON.stringify({sp:!!document.getElementById('splash'),cards:document.querySelectorAll('.trip-card').length})");
  check("D1 CSS 遲到：最後照樣收場、資料照樣出來", JSON.parse(ok).sp === false && JSON.parse(ok).cards === 1, ok);
  ch.kill();
}
/* D2：三支 CSS 全部 404 */
{
  server.__state.kill = new Set(["styles.css", "motion.css", "splash.css"]);
  const { c, ch } = await launch();
  await c.send("Page.navigate", { url: URL_ });
  await sleep(250);
  const px = await centerPixel(c);
  check("D2 CSS 全 404：第一幀仍然是 #f7f4ee（關鍵路徑 CSS 撐住）", px === "#f7f4ee", "實測 " + px);
  await sleep(3000);
  const o = JSON.parse(await ev(c, "JSON.stringify({sp:!!document.getElementById('splash'),gate:document.documentElement.hasAttribute('data-cssgate'),cards:document.querySelectorAll('.trip-card').length,vis:getComputedStyle(document.getElementById('app')).visibility})"));
  check("D2 CSS 全 404：閘門開了、app 沒有被藏死", o.gate === false && o.vis === "visible", JSON.stringify(o));
  check("D2 CSS 全 404：開場收得掉、資料出得來", o.sp === false && o.cards === 1, JSON.stringify(o));
  server.__state.kill = new Set();
  ch.kill();
}
/* D3：splash.js 404（開場模組是加分項，不是相依性） */
{
  server.__state.kill = new Set(["splash.js"]);
  const { c, ch } = await launch();
  await c.send("Page.navigate", { url: URL_ });
  await sleep(1800);
  const o = JSON.parse(await ev(c, "JSON.stringify({sp:!!document.getElementById('splash'),att:document.documentElement.getAttribute('data-splash'),cards:document.querySelectorAll('.trip-card').length,vis:getComputedStyle(document.getElementById('app')).visibility})"));
  check("D3 splash.js 404：app.js 的 splashFallback 把開場收掉了", o.sp === false && o.att === "off", JSON.stringify(o));
  check("D3 splash.js 404：資料照樣出得來、畫面沒有被藏住", o.cards === 1 && o.vis === "visible", JSON.stringify(o));
  server.__state.kill = new Set();
  ch.kill();
}
/* D4：JS 完全停用 */
{
  const { c, ch } = await launch({ nojs: true });
  await c.send("Page.navigate", { url: URL_ });
  await sleep(1500);
  await c.send("Emulation.setScriptExecutionDisabled", { value: false });
  /* 量測要用 JS，所以先關再開；頁面已經在「沒有跑過任何 script」的狀態下畫完了 */
  const o = JSON.parse(await ev(c, "JSON.stringify({spDisp:document.getElementById('splash')?getComputedStyle(document.getElementById('splash')).display:'(removed)',appVis:getComputedStyle(document.getElementById('app')).visibility,gate:document.documentElement.hasAttribute('data-cssgate'),bodyBg:getComputedStyle(document.body).backgroundColor,sheets:document.styleSheets.length})"));
  check("D4 JS 停用：#splash 不顯示（noscript 那條生效）", o.spDisp === "none", JSON.stringify(o));
  check("D4 JS 停用：app 沒有被藏死、閘門沒關起來", o.appVis === "visible" && o.gate === false, JSON.stringify(o));
  check("D4 JS 停用：樣式表有載到（noscript 的 <link> 生效）", o.sheets >= 3, "styleSheets=" + o.sheets);
  ch.kill();
}

console.log("\n=== E. sheet 開關 ===");
{
  const { c, ch } = await launch();
  await c.send("Page.navigate", { url: URL_ });
  await sleep(2600);
  await ev(c, "openTrip('probe-a-明天出發'); 1");
  await sleep(250);
  await ev(c, "openAddPicker(); 1");
  await sleep(60);
  const inAnim = await ev(c, "JSON.stringify(document.querySelector('#sheet-layer .sheet').getAnimations().map(function(a){return a.animationName+':'+a.playState;}))");
  check("E1 開：.sheet 有進場動畫在跑（tb-sheet-in）", /tb-sheet-in/.test(inAnim), inAnim);
  await sleep(400);
  await ev(c, "closeSheet(); 1");
  await sleep(60);
  const outAnim = await ev(c, "JSON.stringify({cls:document.getElementById('sheet-layer').className,anims:(document.querySelector('#sheet-layer .sheet')||{getAnimations:function(){return[];}}).getAnimations().map(function(a){return a.animationName;}),pe:getComputedStyle(document.getElementById('sheet-layer')).pointerEvents})");
  const oo = JSON.parse(outAnim);
  check("E2 關：離場用獨立的 tb-sheet-out，而且整層 pointer-events:none",
    oo.cls.indexOf("closing") >= 0 && oo.anims.indexOf("tb-sheet-out") >= 0 && oo.pe === "none", outAnim);
  await sleep(300);
  const gone = JSON.parse(await ev(c, "JSON.stringify({hidden:document.getElementById('sheet-layer').hidden,kids:document.getElementById('sheet-layer').children.length,cls:document.getElementById('sheet-layer').className})"));
  check("E3 關：240ms 保險絲之後從 DOM 清空、class 也拿掉", gone.hidden === true && gone.kids === 0 && gone.cls === "", JSON.stringify(gone));

  /* E4 連續開關 6 次（每次都不等動畫演完） */
  await ev(c, "for(var i=0;i<6;i++){ openAddPicker(); closeSheet(); } 1");
  await sleep(500);
  const burst = JSON.parse(await ev(c, "JSON.stringify({hidden:document.getElementById('sheet-layer').hidden,kids:document.getElementById('sheet-layer').children.length})"));
  check("E4 連續開關 6 次（都不等動畫）最後一定收乾淨", burst.hidden === true && burst.kids === 0, JSON.stringify(burst));

  /* E5 開場動畫還沒演完就關 */
  await ev(c, "openAddPicker(); 1");
  await sleep(40);
  await ev(c, "closeSheet(); 1");
  await sleep(400);
  const early = JSON.parse(await ev(c, "JSON.stringify({hidden:document.getElementById('sheet-layer').hidden,kids:document.getElementById('sheet-layer').children.length})"));
  check("E5 進場才 40ms 就關：照樣收乾淨、不會卡住", early.hidden === true && early.kids === 0, JSON.stringify(early));

  /* E6 就地換頁（closeSheet(); openXxx() 同一拍）：不可以被舊的計時器清掉 */
  await ev(c, "openAddPicker(); 1");
  await sleep(120);
  await ev(c, "closeSheet(); openStopSheet(); 1");
  await sleep(400);
  const swap = JSON.parse(await ev(c, "JSON.stringify({hidden:document.getElementById('sheet-layer').hidden,kids:document.getElementById('sheet-layer').children.length,title:(document.querySelector('#sheet-layer h3')||{}).textContent||''})"));
  check("E6 就地換一張 sheet：新的那張活著（沒被舊計時器清掉）",
    swap.hidden === false && swap.kids === 2 && swap.title.indexOf("行程點") >= 0, JSON.stringify(swap));
  ch.kill();
}

console.log("\n=== F. 骨架屏（/api/data 故意變慢 1.5 秒）===");
{
  server.__state.slow = 1500;
  const { c, ch } = await launch();
  await c.send("Page.navigate", { url: URL_ });
  await sleep(900);
  const RECT = "function(s){var e=document.querySelector(s); if(!e) return null; var b=e.getBoundingClientRect(); return {x:+b.left.toFixed(1),y:+b.top.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};}";
  const sk = JSON.parse(await ev(c, "(function(){var R=" + RECT + ";return JSON.stringify({cards:document.querySelectorAll('.sk-card').length,cover:document.querySelectorAll('.sk-cover').length,anim:(document.querySelector('.sk-card')||{getAnimations:function(){return[];}}).getAnimations().map(function(a){return a.animationName;}),r:R('.sk-card')});})()"));
  check("F1 載入中畫的是 3 張旅程卡形狀的骨架（不是一顆 emoji）", sk.cards === 3 && sk.cover === 3, JSON.stringify({ cards: sk.cards, cover: sk.cover }));
  check("F2 骨架在呼吸（tb-sk-breathe）", sk.anim.indexOf("tb-sk-breathe") >= 0, JSON.stringify(sk.anim));
  await sleep(2600);
  const real = JSON.parse(await ev(c, "(function(){var R=" + RECT + ";return JSON.stringify({sk:document.querySelectorAll('.sk-card').length,real:document.querySelectorAll('.trip-card').length,r:R('.trip-card')});})()"));
  check("F3 資料到了骨架就消失（innerHTML 換掉，infinite 動畫不會留著吃 GPU）", real.sk === 0 && real.real === 1, JSON.stringify({ sk: real.sk, real: real.real }));
  /* ⚠️ 這一條是「不准用字級推算」的落實：骨架卡與真旅程卡的矩形要對得上，
     不然資料一到畫面會橫向跳／縱向抽動。門檻 ±1px（次像素）。 */
  const dx = Math.abs(sk.r.x - real.r.x), dw = Math.abs(sk.r.w - real.r.w), dh = Math.abs(sk.r.h - real.r.h), dy = Math.abs(sk.r.y - real.r.y);
  check("F4 骨架卡與真旅程卡的矩形對得上（±1px）", dx <= 1 && dy <= 1 && dw <= 1 && dh <= 1,
    "骨架 " + JSON.stringify(sk.r) + " ／ 真卡 " + JSON.stringify(real.r) + " ⇒ Δx=" + dx + " Δy=" + dy + " Δw=" + dw + " Δh=" + dh);
  server.__state.slow = 0;
  ch.kill();
}

console.log("\n=== G. 紅線：動效不可以改到版面，也不可以關掉既有的過渡 ===");
{
  /* G1 A/B 量版面：同一組畫面，載入 motion.css 與不載入 motion.css，
     每一個元素的矩形都必須一模一樣。
     ⚠️ 這是「不准用字級推算」的落實 —— 高度是量出來的，不是看程式碼推的。 */
  const SNAP = `(function(){
    var out = {};
    var els = document.querySelectorAll("#app *");
    for (var i=0;i<els.length;i++){
      var e = els[i];
      var b = e.getBoundingClientRect();
      var key = (e.tagName + "." + (typeof e.className==="string"?e.className:"")).trim() + "#" + i;
      out[key] = [+b.left.toFixed(2), +b.top.toFixed(2), +b.width.toFixed(2), +b.height.toFixed(2)];
    }
    return JSON.stringify(out);
  })()`;
  const walk = "openTrip('probe-a-明天出發'); 1";
  async function snapshot(killMotion, phase) {
    if (killMotion) server.__state.kill = new Set(["motion.css"]);
    const { c, ch } = await launch();
    await c.send("Page.navigate", { url: URL_ });
    await sleep(2600);
    await ev(c, walk); await sleep(300);
    if (phase) { await ev(c, phase); await sleep(300); }
    const s = JSON.parse(await ev(c, SNAP));
    ch.kill();
    if (killMotion) server.__state.kill = new Set();
    return s;
  }
  for (const [name, phase] of [["行程", null], ["行程・調整模式", "toggleEdit(); 1"], ["打包", "setTab('pack'); 1"], ["花費", "setTab('budget'); 1"]]) {
    const withM = await snapshot(false, phase);
    const noM = await snapshot(true, phase);
    const keys = Object.keys(withM);
    let worst = 0, worstKey = "";
    let missing = 0;
    keys.forEach(k => {
      if (!noM[k]) { missing++; return; }
      for (let i = 0; i < 4; i++) {
        const d = Math.abs(withM[k][i] - noM[k][i]);
        if (d > worst) { worst = d; worstKey = k + "[" + i + "]"; }
      }
    });
    check("G1 " + name + "：載 motion.css 前後，" + keys.length + " 個元素的矩形完全相同",
      keys.length > 20 && missing === 0 && worst <= 0.5,
      "元素 " + keys.length + " 個、對不到 " + missing + " 個、最大差 " + worst.toFixed(2) + "px" + (worstKey ? "（" + worstKey + "）" : ""));
  }
}
{
  const { c, ch } = await launch();
  await c.send("Page.navigate", { url: URL_ });
  await sleep(2600);
  await ev(c, "openTrip('probe-a-明天出發'); toggleEdit(); 1");
  await sleep(400);
  /* G2 紅線：既有的過渡不可以被關掉 */
  const g2 = JSON.parse(await ev(c, `(function(){
    var stop = document.querySelector('.stop');
    stop.classList.add('drag-anim');
    var cs = getComputedStyle(stop);
    var grip=null;
    return JSON.stringify({dragAnim:cs.transitionProperty+" / "+cs.transitionDuration});
  })()`));
  check("G2a .drag-anim（timeline 讓位過渡）沒有被關掉：transform 0.18s",
    /transform/.test(g2.dragAnim) && /0\.18s/.test(g2.dragAnim), g2.dragAnim);
  await ev(c, "toggleEdit(); setTab('pack'); 1");
  await sleep(400);
  const g2b = JSON.parse(await ev(c, `(function(){
    var gv = document.querySelector('.pk-grip .gv');
    var cs = getComputedStyle(gv);
    var card = document.querySelector('.pk-card');
    card.classList.add('is-dragging');
    /* ⚠️ getComputedStyle 回傳的是**活的**物件：一定要在拿掉 class 之前先把值讀成字串，
       不然量到的是「已經還原之後」的狀態（第一版就是這樣得到假紅燈的）。 */
    var cd = getComputedStyle(card);
    var vis = String(cd.visibility), disp = String(cd.display);
    var r = card.getBoundingClientRect();
    var h = +r.height.toFixed(1);
    card.classList.remove('is-dragging');
    return JSON.stringify({gv:cs.transitionProperty+" / "+cs.transitionDuration+" / "+cs.transitionTimingFunction,
                           dragVis:vis, dragDisp:disp, dragH:h});
  })()`));
  check("G2b .pk-grip .gv 的 background transition 仍是 0.2s linear（220ms 門檻對齊，紅線）",
    /background/.test(g2b.gv) && /0\.2s/.test(g2b.gv) && /linear/.test(g2b.gv), g2b.gv);
  check("G2c .pk-card.is-dragging 仍是 visibility:hidden 且仍佔位（不是 display:none）",
    g2b.dragVis === "hidden" && g2b.dragDisp !== "none" && g2b.dragH > 10,
    "visibility=" + g2b.dragVis + " display=" + g2b.dragDisp + " 高度=" + g2b.dragH + "px");
  /* G3 觸控目標全掃描（不是列白名單） */
  const g3 = JSON.parse(await ev(c, `(function(){
    var small = [], n = 0;
    ["setTab('plan')","setTab('budget')","setTab('pack')","setTab('notes')"].forEach(function(){});
    var els = document.querySelectorAll("#app button, #app a, #app .tappable, #app label.pick, #app label.check-row");
    for (var i=0;i<els.length;i++){
      var e = els[i], cs = getComputedStyle(e);
      if (cs.display==="none"||cs.visibility==="hidden") continue;
      var b = e.getBoundingClientRect();
      if (!b.width||!b.height) continue;
      n++;
      /* 有些鈕靠 ::before inset 外擴命中區，量本體會低估 —— 一律先量本體，
         低於 44 的再看有沒有外擴（44 是 CLAUDE.md 的鐵律）。 */
      var extra = 0;
      try { var bs = getComputedStyle(e,"::before"); if (bs.content !== "none" && bs.position === "absolute") {
        extra = Math.max(0, -parseFloat(bs.inset||bs.top||"0")||0) * 2; } } catch(err){}
      if (b.width+extra < 43.5 || b.height+extra < 43.5) {
        small.push((e.className||e.tagName)+" "+b.width.toFixed(1)+"x"+b.height.toFixed(1)+(extra?"(+"+extra+")":""));
      }
    }
    return JSON.stringify({n:n, small:small});
  })()`));
  check("G3 觸控目標全掃描（打包頁）：" + g3.n + " 個目標都 ≥44px",
    g3.n > 10 && g3.small.length === 0, g3.small.length ? g3.small.join(" ; ") : "全部通過");

  /* G4 鑰匙圈藥丸：模組自己鎖死外觀，宿主的 motion.css 不准蓋過去。
     本機版（LocalStore）不會畫出藥丸，所以這裡**合成一顆**：把模組真正用的那條規則
     （.kr-chip.kr-chip:active{transform:scale(.97)}）也一起注進去，看誰贏。
     ⚠️ 這是「權重會不會被 #app 壓過」的問題，不是「有沒有寫到 .kr-chip」的問題。 */
  await ev(c, "goHome(); 1"); await sleep(300);
  const g4 = JSON.parse(await ev(c, `(function(){
    var st = document.createElement("style");
    st.textContent = ".kr-chip.kr-chip:active{transform:scale(.97);}.kr-chip.kr-chip{animation:none !important;transition:none !important;}";
    document.head.appendChild(st);
    var foot = document.querySelector(".home-foot");
    var b = document.createElement("button");
    b.className = "kr-chip"; b.textContent = "測試藥丸"; b.id = "__probe_chip";
    foot.insertBefore(b, foot.firstChild);
    var r = b.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), ok:!!foot});
  })()`));
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: g4.x, y: g4.y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(160);
  const chipTf = await ev(c, "getComputedStyle(document.getElementById('__probe_chip')).transform");
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, button: "left", buttons: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 2, y: 2, button: "left", buttons: 0, clickCount: 1 });
  const chipScale = /^matrix\(([-\d.]+)/.exec(chipTf || "");
  check("G4 .kr-chip 仍由鑰匙圈模組自己決定按下回饋（.97，不是 motion.css 的 .96）",
    !!chipScale && Math.abs(Number(chipScale[1]) - 0.97) < 0.001, "實測 " + chipTf);
  ch.kill();
}

server.close();
const bad = results.filter(r => !r.ok);
console.log("\n共 " + results.length + " 條，未過 " + bad.length + " 條。");
bad.forEach(r => console.log("  [未過] " + r.name + "　" + r.detail));
process.exit(bad.length ? 1 : 0);
