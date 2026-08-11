# travel-planner（旅途手帳）— 專案備忘（給接手的 AI／開發者）

手機優先的旅遊行程 PWA。Benson 自用：一趟旅程 = 逐日行程 + 花費 + 打包清單 + 自由備註。
UI/UX 以 `demo/index.html`（UX demo v3.1，Benson 拍板）為準，**勿自行改設計**；設計規格見 `DESIGN.md`。

## 架構（三層，比照 recipe-book — 別打破）
- **電腦本機 Node App＝真本**：`server.js`（零執行期依賴，**port 3618**），服務 `public/` 前端＋`/api` CRUD，資料存本機 md 檔。
- **GitHub repo `xd1104/travel-book`（main）＝同步中樞＋雲端備份**：本機寫入後自動 `git add/commit` → `pull --no-rebase -X ours` → `push`；啟動時也 pull。
- **GitHub Pages（main `/docs`）＝手機 PWA**：`build.js` 從 `public/` 鏡射到 `docs/`。**docs/ 是產物，別手改**。

## 前端 DataStore（依 `location.hostname` 自動切；`?store=github` 可強制測 GitHub 模式）
- **localhost → LocalStore**：打本機 `/api`，全功能。
- **非 localhost（Pages）→ GitHubStore**：**有 PAT** 走認證 Contents API 讀寫（即時；PUT/DELETE 帶 sha、base64、409/422 自動重取 sha 重試一次、樂觀更新）；**無 PAT** 唯讀走 raw＋`?t=<sha>` cache-buster（匿名 API 快取嚴重，別拿無金鑰裝置驗「最新」）。

## 同步（別誤改的決策）
- 同檔衝突：**固定電腦版本勝（`-X ours`）**——刻意選「電腦是真本」。要改成手機勝需 Benson 拍板。
- 同步失敗絕不影響本機存檔（只記 log）。`AUTO_SYNC=0` 可關（測試用）。

## 金鑰（安全）
- 手機用 **fine-grained PAT、只授權 `travel-book` 一個 repo 的 Contents 讀寫**，存 localStorage（key **`travel_gh_pat`**）。設定入口只在非 localhost 顯示（首頁 footer「設定」）。**任何真實金鑰不可寫進程式或 commit。**

## 資料格式（定案；前後端各有一套 mirror parser，改要一起改）
- 每趟旅程一個 `data/trips/<id>.md`，id = `<ts36>-<slug>`（slug 保留中文）。
- 結構：frontmatter（`name/dest/emoji/theme/start/days/budget/createdAt/updatedAt`，字串 JSON-quoted、數字裸寫）＋ 四段 body：
  - `## 行程` → `### Day N` → 每行 `- {一筆行程點的單行 JSON}`（key 順序固定、空值不寫；欄位：id/title/time/cat/place/note/mapUrl/cost/bookingRef/phone/url/hoursOpen/hoursClose/hours24/hours）
  - `## 花費` → 每行 `- {id,amount,cat,desc}`
  - `## 打包` → 每行 `- {id,text,done,zone}`（zone: `carry`｜`checked`）
  - `## 備註` → **永遠最後一段、整段原樣文字**（parser 進入後不再解析 heading，所以備註裡打 `##` 不會壞）
- 打包模板 `data/templates/<id>.md`：frontmatter `name` ＋ `## 項目` JSON 行（`{text,zone}`）。內建三款種子（intl-basic／local-trip／beach-onsen）：templates 資料夾全空時 server 啟動自動補（在 startup pull 之後，避免蓋掉手機建的）。
- **行程點類別（v1.1 起可自訂）＝單一檔 `data/categories.md`**：`## 類別` 下每行 `- {id,label,emoji,color}`。刻意單檔不一類一檔（清單小、Contents API 一次 PUT 一個 sha 最穩）；寫入＝整份覆蓋。內建六類種子（id：sight/food/transport/stay/shop/other，舊資料 id 不變無痛）；**「其他」（other）是刪類別後的 fallback，前後端 normalize 都強制存在、UI 不給刪**。檔案缺失時 GET 回內建六類（不落地寫檔，種子由啟動流程補）。
- **`bookingRef`（訂位／票券代號）v1.1 起 UI 隱藏但資料保留**：編輯表單與詳細檢視都不顯示、submitStopEdit 刻意不碰它，serializer（cleanStop）照寫、parser 原樣帶回——別把這段當死碼清掉，會造成舊資料無聲丟失。
- **縮天不刪資料**：serializer 會把超出 `days` 的 day-key 照寫（只略過空天），天數改回來資料就回來。
- **`hours` 舊自由文字欄位**是向下相容欄，有結構化時間（hoursOpen/Close/24）時前端存檔會清掉它——別「清理」這段邏輯。
- **`stayMinutes`（v1.2 預計停留，分鐘、選填）**：0/缺值＝未設定（serializer 不寫）。顯示規則（`formatStay`，定案）：<60 分→「45 分」；能被 30 整除→小數小時（60→「1 小時」、90→「1.5 小時」、150→「2.5 小時」）；其餘→「2 小時 20 分」。表單＝快選 chips（30/60/90/120/180/240=半天）＋自訂分鐘 input，同一個 `name=stayMinutes` 為準、再點選中的 chip＝取消。
- **起訖時間顯示（v1.5，`endTime`／`timeHtml`，定案）**：填了 `time`＋`stayMinutes` 就在卡片與詳細 sheet 顯示區間 `08:00–08:40`，**起深訖淡**（`.stop-time .to`，結束是推算的不是他填的）；跨午夜補上標 `+1`（`23:30–00:10⁺¹`）。算不出區間就退回舊寫法（只有時間→`08:00`；只有停留→`停 40 分`；都沒有→`—`）。**時長不在卡片重複顯示**，留在詳細 sheet 的「預計停留」列（卡片看停到幾點、點進去看停多久）。**transit 不套用**（它的 `stayMinutes` 是移動時間、也沒有 `time`）。不做「下一站建議時間」的連鎖推算（Benson 拍板：一改前面全天跳動，是另一個規模的功能）。
- **連鎖平移（v1.6，`shiftAfter`／`minsOf`／`timeOf`，定案）**：編輯行程點的「預計停留」或移動的「移動時間」時，**同一天、這一筆之後、有填時間的行程點各平移相同分鐘數**（transit 沒有 time 欄跳過），跳 toast「後面 N 筆時間已跟著往後移 20 分」。
  - **刻意是「平移」不是「照停留＋移動重算整天」**（Benson 拍板）：重算會把他刻意留的空檔壓掉；平移保留原本的節奏。代價是硬時間（表演開演、火車、訂位）也會被推走，靠 toast 告知、他自己改回來。**要真正釘住硬時間得加 `fixed` 欄位＋改 md 格式與前後端 parser，刻意先不做。**
  - **直接改某一筆的 `time` 不會觸發平移**（那通常是修正單一筆，不是整天順移）。只有「停留／移動時間」這種長度改變才連鎖。
  - 跨午夜用 mod 1440 繞回（23:50 +40 → 00:30），不做跨天搬移。
  - 不確認、不提供復原（Benson 拍板：直接改＋toast 就好）。
- **新增行程點的時間預設值（v1.6，`nextTimeGuess`）**：帶「這一天最後推算得出的時刻」＝從頭走一遍，遇到有填時間的行程點就以它重新對錶，再累加停留與移動。整天都沒時間就留空。
- **`type` 欄位（v1.3）＝時間軸項目型態**：缺值／`"stop"`＝行程點（舊資料無痛，serializer 對 stop **不寫** type，檔案維持原樣）；`"transit"`＝移動。**transit 刻意只用 `note`＋`stayMinutes`（當移動時間），serializer 只輸出 `{id,type,note,stayMinutes}`**——不要幫 transit 補 title/cat/place/費用等站點欄位，「路上」不該佔版面也不該佔資料。UI：transit 是灰色輕薄一條（rail 小空心點＋虛線），點它開精簡表單（不是完整詳細頁）；與 stop 混在同一個 day list 排序／拖曳／刪除。新增走 FAB → 選「行程點／移動」。不做舊「🚗 移動」類別項目的一鍵轉換（Benson 拍板自行手動處理）。
- **`.gitattributes` 強制 md/js/css/html/json 為 LF**；前後端 parser 開頭都先 `replace(/\r\n/g,'\n')`。壞的 JSON 行 parser 會跳過該行（不整檔炸掉）。

## PWA 鐵律（recipe-book 血淚，全部已做，別退步）
- 所有資源、manifest `start_url`/`scope`、SW scope **一律相對路徑**（Pages 在 `/travel-book/` 子路徑）。
- SW：`skipWaiting()`＋activate 清舊快取＋`clients.claim()`；`/api/data` network-first、寫入 network-only、殼 cache-first。**改前端記得把 sw.js 的 cache 版本號 +1**（`travel-shell-vN`，目前 v7）**並同步 `APP_VER`**（見下方「版本與更新」）。
- input/textarea/select `font-size ≥ 16px`（iOS 防自動放大）；觸控目標 ≥ 44px；Enter 送出全部走原生 `<form>` + `type=submit`。
- 換 icon 後 iOS 已安裝的 PWA 要移除主畫面重加才會換。

## 版本與更新（v1.4，機制沿用 lose-weight-helper）
- **`APP_VER` 是唯一的版本來源**（`public/app.js` 最上面），首頁 footer 那顆鈕與「版本」sheet 都讀它。**改前端時跟 `sw.js` 的 cache 版本號一起 +1。**
- 為什麼需要：PWA 的殼是 cache-first，新 SW 裝好、activate 之後畫面上跑的仍是舊 JS，**要重新載入才會換過去**，使用者看不到這件事、只會覺得「怎麼沒有新功能」。
- 偵測有兩條路，兩條都要留：`registration.updatefound` → `installing.statechange === "installed"` 且**已經有 controller**（第一次安裝不算更新），以及 `controllerchange`（同樣用進站時記的 `hadController` 擋掉首次安裝）。`markUpdate()` 只會觸發一次。
- **刻意不自動 reload（v1.4 起改的）**：舊版是 `controllerchange` 就 `location.reload()`，會在編行程編到一半把頁面彈掉。現在改成偵測到就跳 toast＋footer 那顆變成「🎉 有新版本・點一下更新」（`.ver-btn.hot`），點開「版本」sheet 由使用者自己按「立即更新」（＝`location.reload()`）。
- 沒有新版時 sheet 給「檢查有沒有新版本」＝`checkUpdate()`（`reg.update()` 再等 1.2 秒讓 handler 跑完），沒有就回「已經是最新版了。」
- **版本入口放 footer 不放設定**：設定入口只在非 localhost 顯示，電腦版沒有；footer 兩邊都看得到。

## 其他實作備忘
- 拖曳排序：pointer events、只把手可拖（`touch-action:none`）、座標一律用 page 座標（clientY+scrollY）——這是為了「邊緣自動捲動」正確，別改回 viewport 座標。
- 寫入用 per-檔案 promise chain 排隊（`persistChains`），避免快速連點時並發互蓋。
- 「刪除這趟旅程」在編輯旅程 sheet 內（demo 沒有、依需求範圍補的），有 confirm。
- 唯讀模式（Pages 無 PAT）：所有寫入動作入口都有 `requireWrite()` 守門＋toast 提示。
- icon 產生工具（sharp）在 scratchpad、**不進 repo**；server.js 保持零執行期依賴。
- **id 字元集鐵律（QA B1 教訓）**：server 的 `safeName` 與前後端 `slugify` 必須是同一個字元集（`\p{L}\p{N}` ＋ `._-`）。不一致時，手機端建的假名/韓文 id 會在電腦端被 mangle 成另一個檔名 → 同一趟旅程跨裝置分裂成兩筆。改任何一邊都要三處一起改＋補 round-trip 測試。

## 已審過、刻意不改的行為（PM 拍板，別當 bug 修）
- DELETE 不存在的 id 回 200：**冪等刪除是刻意設計**（重送/重試不炸）。
- payload 超過 5MB 直接斷線（不是優雅 413）：本機自用、正常資料量差三個數量級，接受。
- 模板列表順序跟檔名走、偶有變動：接受。

## 啟動
- 雙擊 `start.bat` 或 tool-manager 面板「作品」分類（都只跑 `node server.js`，port 3618）。
- **server.js 啟動時自己執行 build 鏡射 docs/**（build.js 匯出 `build()`），所以從任何入口啟動 docs/ 都不會落後 public/；build 失敗只記 log 不擋服務。
- AI 功能（生行程草稿等）＝ v2 待辦，本版刻意不做（Benson 拍板）。
