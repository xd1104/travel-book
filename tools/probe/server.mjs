/* server.mjs — 探針專用的靜態伺服器（public/ ＋ 假的 /api/data）
   ------------------------------------------------------------
   用法：node tools/probe/server.mjs [port]
   · 綁 127.0.0.1 ⇒ app.js 的 IS_LOCAL 成立 ⇒ 走 LocalStore ⇒ 打 `api/data`
     （不會連 GitHub，也不需要金鑰）。
   · **絕對不碰真的 data/**：/api/data 回 fixture.mjs，其他 /api/* 一律回
     `{ok:false}`，探針就算真的按到存檔也寫不到任何地方。
   · 可用旗標故意弄壞資源，做降級路徑測試：
       --kill=motion.css,splash.css,styles.css,splash.js   → 那幾支回 404
       --nopress                                           → 負控組：把 motion.css 的
                                                             transform:scale(var(--press*)) 換成 none
       --slow=<ms>                                         → /api/data 延遲回應（測骨架屏）
   · index.html 一律把 service worker 註冊拆掉（掃到一半被 SW 接管會讓量測作廢）。
*/
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./fixture.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml"
};

export function createProbeServer(opts = {}) {
  const kill = new Set(opts.kill || []);
  const state = { nopress: !!opts.nopress, slow: Number(opts.slow || 0), kill };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";

    if (p === "/api/data") {
      const send = () => {
        const body = JSON.stringify(fixture());
        res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
        res.end(body);
      };
      if (state.slow) setTimeout(send, state.slow); else send();
      return;
    }
    if (p.startsWith("/api/")) {   /* 寫入類一律擋掉：探針不可以有任何落地效果 */
      res.writeHead(200, { "content-type": MIME[".json"] });
      res.end(JSON.stringify({ ok: false, message: "探針模式：不接受寫入" }));
      return;
    }

    const base = path.basename(p);
    if (state.kill.has(base)) { res.writeHead(404).end("404 (killed by probe)"); return; }

    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("404"); return; }
      let body = buf;
      if (base === "index.html") {
        body = Buffer.from(buf.toString("utf8").replace('"serviceWorker" in navigator', "false"), "utf8");
      }
      if (state.nopress && base === "motion.css") {
        body = Buffer.from(
          buf.toString("utf8").replace(/transform:scale\(var\(--press[^)]*\)\);/g, "transform:none;"), "utf8");
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      res.end(body);
    });
  });
  server.__state = state;
  return server;
}

/* 直接執行時當一般伺服器用 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = Object.fromEntries(process.argv.slice(2).map(s => {
    const [k, v] = s.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }));
  const port = Number(args.port || process.argv[2] || 8471);
  const srv = createProbeServer({
    kill: args.kill ? String(args.kill).split(",") : [],
    nopress: !!args.nopress,
    slow: args.slow
  });
  srv.listen(port, "127.0.0.1", () => console.log("probe server -> http://127.0.0.1:" + port + "/index.html"));
}
