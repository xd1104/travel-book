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

## 鑰匙圈解鎖（v2.0，定案；別誤改）
- **一人一組密碼取代「貼 PAT」**：`public/keyring-unlock.js`（正本在 `Claude Work/keyring/client/`，改那邊再複製過來）抓公開的 `xd1104/keyring` repo 的 `keyring.json`（只有密文），使用者選自己＋輸密碼，瀏覽器用 WebCrypto（PBKDF2-SHA256 600000 → AES-GCM 256）解出金鑰。
- **`travel_gh_pat` 這個 key 不動**（跟舊版完全相容，GitHubStore 一行都沒改）。`getToken` v2.0 起會**先讀 sessionStorage**：解鎖時沒勾「記住這台裝置」就存那裡，關掉分頁即失效。
- `requireWrite(reason)` 多了一個理由字串：唯讀被擋時**直接升起解鎖 sheet 並帶理由條**（「要『規劃新旅程』得先解鎖」），不再只丟 toast 叫他自己去找設定。沒帶 reason 也能跑（就不顯示理由條）。
- footer 第一行是身分藥丸（`Keyring.chipHtml()`，模組自帶 `kr-` 樣式），第二行才是原本的設定／重新整理／版本。**本機版（LocalStore）不顯示**——本機不用鑰匙。
- **「設定 → 貼金鑰」刻意保留**當救援入口（鑰匙圈壞掉時還能手動貼一把）。`clearSettings` 會一併 `Keyring.forget()`，否則下次載入又把金鑰寫回來。
- 裝置記憶存的是**派生金鑰**不是密碼：所以後台**換 PAT 時各裝置自動換過去、不用重解鎖**；**換密碼／刪人／收回權限則解不開 → 靜默清掉回到「只看看」**並提示一次。抓不到 keyring.json（離線）時維持現狀，不會把人踢回唯讀。
- **顯示用資料也會跟著對帳（v2.2 修）**：解鎖時存的是當下的**快照**（名字／emoji／主題色），所以後台改名之後，已解鎖的裝置原本永遠顯示舊名字。`refreshFromRing()` 現在會在 userId 對得上時把這三個欄位更新成鑰匙圈裡的最新值（金鑰不動、不用重解鎖）。**對帳只在頁面載入時跑**——`Keyring.reload()` 只是重抓鑰匙圈、不做對帳，別拿它當驗證入口。
- 首次進站 0.9 秒主動彈一次解鎖 sheet（旗標 `keyring.travel-book.introSeen`），之後永遠不再自動彈。
- 本機測試：`localStorage["keyring.travel-book.src"]` 可指到本機後台的 `http://localhost:4620/keyring.json`。
- **解鎖畫面視覺 v2.1（2026-08-18，lab-ux 方向 B「暖卡列」定案；只動 CSS 與兩處 template，狀態機沒碰）**：頭像從 116px 滿彩度漸層磚縮成 **44px 淡底頭像**（同一組 `THEMES` 壓到 ~20%，存在模組的 `CFG.tints`），選人改**直向橫卡列**（`.kr-grid` 變 flex column、`.kr-tile` 變 64px 高的米白卡），第二步拿掉 74px 大頭像／置中大標，改用 `.kr-id` 橫列。理由：那組漸層在這個 App 是「一趟旅程」的語彙，套在人身上會變成兩張沒名字的旅程卡。**別再把 `grad()` 用回頭像**（`grad()` 現在只剩 footer 藥丸的 24px 小方塊在用）。
- **模組 CSS 的權重鐵律（v2.1 修，QA 退過一次）**：這份 CSS 是注入到「本身就有 CSS 的宿主」裡跑的，單一 class (0,1,0) 會被 `.kr-sheet button`（模組自己的通則）和 `.home-foot button`（travel-book 的）這種 (0,1,1) 壓過 —— v2.0 的珊瑚「解鎖」鈕實際是透明的、footer 身分藥丸是沒有底色的灰色小字。現在**每條規則都用同一個 class 寫兩次提權**（`.kr-chip.kr-chip{}` ＝ 0,2,0），新增規則照做；**不可以**寫成 `.home-foot .kr-chip`（把宿主結構寫死進模組，下一個 App 會再壞一次）。
- **樣式注入時機**：`init()` 就注入 `#kr-style`（不是等第一次 `paint()`）——footer 藥丸每次進站都看得到，不能等使用者開過 sheet 才有樣式。
- `.kr-dot`（footer 藥丸的小方塊）也吃 tint，跟 sheet 裡的頭像同一種語言；`grad()` 已移除，模組不再渲染滿彩度漸層。

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
- **`stayMinutes`（v1.2 預計停留，分鐘、選填）**：0/缺值＝未設定（serializer 不寫）。顯示規則（`formatStay`，定案）：<60 分→「45 分」；能被 30 整除→小數小時（60→「1 小時」、90→「1.5 小時」、150→「2.5 小時」）；其餘→「2 小時 20 分」。表單見下方「停留欄 v1.7」。
- **停留欄 v1.7（`stayField`／`staySync`，定案）＝「停多久（時／分）」與「待到幾點」是同一個值的兩個窗口**：改哪一邊另一邊跟著算。**刻意不做成模式切換**（Benson 拍板：不必先決定用哪種，而且兩個數字要同時看得到）。
  - **真值＝時／分兩格**（`readStay` 讀 `stayH`/`stayM` 相加）。**舊的 `name=stayMinutes` 單一 input 已移除**——`stayUntil` 只是輸入捷徑，不進資料。
  - 起點時間＝同一張表單的 `time` 欄（`stayStart`）。沒填時間 → 「待到」disable ＋ 顯示提示；改 `time` 欄會保留停留長度、重算「待到」（`stayTimeChanged`）。
  - 「待到」比開始早＝跨午夜（23:00 待到 00:30 ＝ 停 90 分）。
  - chips **刻意砍成 4 顆**（停留 30/60/120/240；移動 10/30/60/120）——6 顆在 375px 會擠成兩排，砍到 4 顆剛好一排，1.5 小時這種直接打比點還快。再點選中的 chip＝取消。
  - **transit 不給「待到」**（沒有起點時間），標籤是「移動多久」、用 `MOVE_CHIPS`；`stayField(cur, label, isMove)` 第三參數控制。
  - `stayInit()` 要在 `openSheet` 之後呼叫（openSheet 沒有 onDraw hook），四個入口都有；漏了的話「待到」初值與 chip 選中狀態不會出現。
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
- SW：`skipWaiting()`＋activate 清舊快取＋`clients.claim()`；`/api/data` network-first、寫入 network-only、殼 cache-first。**改前端記得把 sw.js 的 cache 版本號 +1**（`travel-shell-vN`，目前 v11）**並同步 `APP_VER`**（見下方「版本與更新」）。
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
