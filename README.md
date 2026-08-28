# 旅途手帳（Travel Book）

手機優先的旅遊行程 PWA：一趟旅程 = 逐日行程 + 花費 + 打包清單 + 自由備註。

## 怎麼用
- **電腦**：雙擊 `start.bat` → 瀏覽器開 http://localhost:3618（資料存在本機、自動同步 GitHub）。
- **手機**：開 GitHub Pages 網址（`https://xd1104.github.io/travel-book/`）→ 加入主畫面變 App。
  - 無金鑰＝唯讀瀏覽；到首頁最下面「設定」貼上 GitHub PAT 即可編輯（金鑰只存在手機瀏覽器）。

## 功能
- 旅程卡（漸層封面＋emoji）、進行中/未出發排前、已結束收進「📔 旅行回憶」
- 逐日行程 timeline：行程點 CRUD、拖曳排序、Google 地圖跳轉、營業時間 time picker
- 起訖時間 `08:00–08:40`；改停留或移動時間，後面整串時間自動跟著平移
- 花費記帳＋預算進度條＋分類小計
- 打包清單（🧳 行李托運 / 🎒 隨身）＋打包模板（內建三款、可自建管理）
- 備註頁自動儲存

## 結構
```
server.js     本機伺服器（零依賴，port 3618）＋ git 自動同步
build.js      public/ -> docs/（GitHub Pages 用，docs 勿手改）
public/       前端（PWA）
public/motion/    動效基調「沉穩」＋開場「印記」（motion.css 自寫、splash.* 是範本複製品）
tools/            體檢與探針（零相依，用本機 Chrome）
                  node tools/check-splash.js       靜態體檢（底色四處一致、載入順序、對比度）
                  node tools/probe/press-scan.mjs  按下回饋全掃描（含負控組）
                  node tools/probe/flows.mjs       開場／降級／reduced-motion／sheet／骨架屏／版面紅線
data/trips/       每趟旅程一個 .md（frontmatter＋結構化內容）
data/templates/   打包模板 .md
demo/         UX demo（歷史保留，勿改）
DESIGN.md     設計規格 v3.1
CLAUDE.md     開發者備忘（架構決策、資料格式定案）
```
