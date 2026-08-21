'use strict';

/*
 * 補地址（給 GitHub Actions 用的入口）— v2.5
 *
 * 為什麼需要這支：
 *   行程點的 addr（完整地址）是把 maps.app.goo.gl 短連結「跟著 302 轉址」展開來的，
 *   而瀏覽器不准跨網域讀 Location ⇒ 手機端（GitHub Pages 版）永遠做不到。
 *   Benson 幾乎只用手機，「要回電腦開一次 server 才會生效」對他等於沒做。
 *   所以由 GitHub Actions 這台「不是他電腦」的機器來補。
 *
 * 為什麼是 require server.js 而不是自己寫一份：
 *   展開邏輯（跳數上限／逾時／只打 Google 網域／重讀最新檔再補／updatedAt 不動）
 *   已經在 server.js 過了 QA。這個專案吃過「兩份實作各走各的路」的虧，
 *   所以這裡一行展開邏輯都不重寫，只負責「跑起來 + 印結果」。
 *   server.js 有 `require.main === module` 守衛：被 require 時不開 port、
 *   不 build docs/、不 initSync。
 *
 * 邊界：
 *   - AUTO_SYNC=0 必須在 require 之前設好（server.js 在載入當下就讀這個環境變數）。
 *     否則 server 端的 git 自動同步會跟 workflow 的 commit 打架。
 *   - 這支只會寫 data/trips/*.md，不碰其他任何檔案（workflow 另有斷言把關）。
 *   - 任何例外都不讓 workflow 變紅燈（壞連結／逾時／Google 擋 runner 都算日常），
 *     只留 annotation；沒補到就是沒補到，下次 push 到 data/** 會再試。
 */

process.env.AUTO_SYNC = '0'; // ⚠️ 一定要在 require('../../server.js') 之前

const fs = require('fs');
const path = require('path');

const app = require('../../server.js');
const TRIPS_DIR = app.TRIPS_DIR;

// 統計「有 mapUrl 但沒 addr」還剩幾筆（純文字掃描，不動用 parser，只為了印給人看）
function countPending() {
  let files = [];
  try { files = fs.readdirSync(TRIPS_DIR).filter((f) => f.endsWith('.md')); } catch { return 0; }
  let n = 0;
  for (const f of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(TRIPS_DIR, f), 'utf8'); } catch { continue; }
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('- {')) continue;
      let o;
      try { o = JSON.parse(t.slice(2)); } catch { continue; }
      if (o && o.mapUrl && !o.addr) n++;
    }
  }
  return n;
}

(async () => {
  const before = countPending();
  console.log('[ci-addr] 待補（有 mapUrl 沒 addr）：' + before + ' 筆');
  if (!before) {
    console.log('[ci-addr] 沒有要補的，直接結束（這也是防自我觸發迴圈的最後一道：沒變更就不會有 commit）');
    return;
  }
  try {
    await app.scanAllAddrs();
  } catch (e) {
    console.log('::error::[ci-addr] 展開時發生非預期錯誤（不擋 workflow）：' + ((e && e.message) || e));
  }
  const after = countPending();
  console.log('[ci-addr] 補完後剩：' + after + ' 筆（本輪補上 ' + Math.max(0, before - after) + ' 筆）');
  if (after) console.log('::warning::[ci-addr] 還有 ' + after + ' 筆展不開（壞連結／非 Google 網域／逾時／單輪上限），下次再試');
})().then(
  () => process.exit(0),
  (e) => { console.log('::error::[ci-addr] ' + ((e && e.stack) || e)); process.exit(0); }
);
