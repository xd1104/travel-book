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

## 鑰匙圈解鎖（功能 v2.2＋視覺 v3 公版，定案；別誤改）
- **一人一組密碼取代「貼 PAT」**：`public/keyring-unlock.js`（**正本在 `Claude Work/keyring/client/`，要改改那邊**——2026-08-21 起 keyring 的 `.github/workflows/sync-unlock.yml` 會在正本 push 後自動把 `public/` 與 `docs/` 兩份同步過來，**這個 repo 裡的那份手改會被蓋掉**）抓公開的 `xd1104/keyring` repo 的 `keyring.json`（只有密文），使用者選自己＋輸密碼，瀏覽器用 WebCrypto（PBKDF2-SHA256 600000 → AES-GCM 256）解出金鑰。
- **`travel_gh_pat` 這個 key 不動**（跟舊版完全相容，GitHubStore 一行都沒改）。`getToken` v2.0 起會**先讀 sessionStorage**：解鎖時沒勾「記住這台裝置」就存那裡，關掉分頁即失效。
- `requireWrite(reason)` 多了一個理由字串：唯讀被擋時**直接升起解鎖畫面（v3 起是滿版）並帶理由條**（「要『規劃新旅程』得先解鎖」），不再只丟 toast 叫他自己去找設定。沒帶 reason 也能跑（就不顯示理由條）。
- footer 第一行是身分藥丸（`Keyring.chipHtml()`，模組自帶 `kr-` 樣式），第二行才是原本的設定／重新整理／版本。**本機版（LocalStore）不顯示**——本機不用鑰匙。
- **「設定 → 貼金鑰」刻意保留**當救援入口（鑰匙圈壞掉時還能手動貼一把）。`clearSettings` 會一併 `Keyring.forget()`，否則下次載入又把金鑰寫回來。
- 裝置記憶存的是**派生金鑰**不是密碼：所以後台**換 PAT 時各裝置自動換過去、不用重解鎖**；**換密碼／刪人／收回權限則解不開 → 靜默清掉回到「只看看」**並提示一次。抓不到 keyring.json（離線）時維持現狀，不會把人踢回唯讀。
- **顯示用資料也會跟著對帳（v2.2 修）**：解鎖時存的是當下的**快照**（名字／emoji／主題色），所以後台改名之後，已解鎖的裝置原本永遠顯示舊名字。`refreshFromRing()` 現在會在 userId 對得上時把這三個欄位更新成鑰匙圈裡的最新值（金鑰不動、不用重解鎖）。**對帳只在頁面載入時跑**——`Keyring.reload()` 只是重抓鑰匙圈、不做對帳，別拿它當驗證入口。
- 首次進站 0.9 秒主動彈一次解鎖畫面（旗標 `keyring.travel-book.introSeen`），之後永遠不再自動彈。
- 本機測試：`localStorage["keyring.travel-book.src"]` 可指到本機後台的 `http://localhost:4620/keyring.json`。
- **解鎖畫面 v3「公版」（2026-08-20，Benson 拍板；只換視覺與版面，狀態機／加解密／對外 API 一行沒動）**——這一段**推翻 v2.1 的部分決策，不要當 bug 修回去**：
  - **底部 sheet 改成滿版 `#kr-full`**（`.kr-sheet`／`.kr-backdrop`／`.kr-grab` 全部移除），三段式 flex：`.kr-top`（App 名字＋✕）／`.kr-main > .kr-mid`（垂直置中、可捲）／`.kr-foot`（「先看看就好」常駐條）。**已解鎖點藥丸的身分頁與換人確認也是滿版**（Benson 要的是統一介面，不要一個滿版一個 sheet）。
  - **配色是「公版深色」，不吃這個 App 的任何主色**：暖墨咖啡 `rgba(26,21,16,.955)` ＋頂部暖光 ＋ backdrop blur，主鈕是暖白 `#f6efe1` 深字（**刻意不是珊瑚色**）。理由：解鎖是「進 App 之前」的一層，它不屬於任何一個 App 的視覺語言；而且**只要模組還有「一半吃變數、一半寫死」的顏色，接第 N 個 App 就會再壞一次**（食譜本那次就是粉底＋橘字）。**`#kr-full` 子樹內一個宿主變數都不准讀，連 `var(--acc, fallback)` 都不行**；模組自己的常數用 `--krs-*`（定義在 `#kr-full` 上）。App 的身分靠左上角一行文字（預設 `document.title`）不靠顏色。
  - **唯一能碰主色的是身分藥丸 `.kr-chip`**（它住在 App 的畫面裡）：**底色永遠是模組固定的中性色 `#f6f2ea`，主色只准上前景**——只有 `.kr-cta`（「點我解鎖 ›」那幾個字）吃 `var(--acc, #c1553f)`。`.kr-dot` 改回**滿彩度、圓形 22px**。
  - **頭像改回滿彩度漸層＋圓形**（v2.1 的 20% tint 與 `CFG.tints` 已移除）：v2.1 的理由是「滿彩漸層在這個 App 是一趟旅程的語言、會跟旅程封面撞」，但**v3 的解鎖層是獨立的深色滿版，畫面上根本沒有封面可以撞**，深底上也需要彩度才看得見人。另加一道保險：**頭像一律圓形、旅程卡一律圓角矩形**——用形狀分語意，顏色就不必退讓。
  - **「先看看就好」是版面的固定成員**（`.kr-foot` 全寬 62px 常駐條，每一屏都有）＋右上 ✕ ＋標題寫「**誰要編輯？**」而不是「誰在用？」。這三件事是「滿版沒有變成鎖屏」的關鍵，**改文案等於改掉這個設計**。
  - **safe-area 與鍵盤**：`#kr-full` 高度用 `var(--kr-vh,100dvh)`，`fitVH()` 靠 `visualViewport` 維護（**不要用 `100vh`**）；`.kr-foot` 是 flex item **不是 `position:fixed`**，鍵盤彈出時它自然停在鍵盤正上方——**這是刻意的，不要「優化」成 fixed**。`open()` 時鎖 `body.overflow`、`close()` 還原成進來時的值。
  - **矮螢幕密度（QA 退件兩次修，機制別再換回去）**：鍵盤彈出後可視高度只剩 340~440px（iPhone SE 約 407px），原尺寸會讓「解鎖」鈕掉到摺線下面。
    - **⚠️ 不可以用 `@media(max-height:…)`**：媒體查詢吃的是 **CSS 視窗高度**，而 **iOS 鍵盤只縮 `visualViewport`、CSS 視窗高度一動也不動** ⇒ 媒體查詢永遠不觸發。**Android 會過、iPhone 不會**（實證：`--kr-vh`=407 時解鎖鈕可見高度 0px）。這也正是模組本來就有 `--kr-vh`／`fitVH()` 的原因。
    - **正解**：`applyDensity()` 依**實際量到的滿版高度**在 `#kr-full` 上加／移除 `.kr-short`(≤640)／`.kr-tiny`(≤500)／`.kr-micro`(≤460)，緊縮規則全部寫成 `#kr-full.kr-short …`；再掛一個 **ResizeObserver** 在 layer 上，任何原因（鍵盤、轉向、測試直接改 `--kr-vh`）造成的高度變化都會重算。
    - **門檻是用最壞情境定的**（理由條 ＋ 已打錯 2 次＝錯誤條兩行），不是用單純情境——單純情境會給出假的安全感。`.kr-micro` 刻意讓掉三樣次要的東西（理由條、錯誤條第二行、出口第二行）換「密碼欄＋解鎖鈕＋出口」完整可見；**觸控目標 ≥44px 與密碼欄 16px 不准讓**。
    - **已知缺口（QA 建議級，刻意先不修）**：`.kr-micro` 把理由條整條 `display:none`。正常路徑不受影響（他點寫入鍵的當下畫面還是全高、看得到理由，鍵盤才彈出）；但**一開機就矮**（手機橫置／桌機小視窗）時，他從頭到尾看不到「為什麼被擋」。要收的話把理由縮成一行併進副標即可。
    - 實測（最壞情境、不捲動）：`--kr-vh` = 340/380/407/440/500 兩個 App 全過，破線點在 **~318px**（比 QA 要求的最低 340 還低 22px）。
  - **量測方法（前兩輪雙方都在這裡失準過）**：① 量之前 `scrollTop` 一律歸 0；② 不要只看 `getBoundingClientRect`（它不管捲動容器的裁切）；③ 至少兩種方法交叉驗：clip-aware 交集（走 overflow 祖先，但**走到 `#kr-full` 就要停**——它是 `position:fixed`，body/html 的 overflow 裁不到它，多走一層會誤判成被裁掉）／`elementFromPoint` 打按鈕（**用邊中點不要用四角**，圓角 15px 會讓角落落在形狀外）／截圖掃暖白 `rgb(246,239,225)` 像素（**掃描欄要避開置中的「解鎖」字樣**，否則連續段會被文字切斷）。
  - **同名的人靠前端分辨**（`hintOf()`）：後台有填 `hint` 就顯示 hint，沒有但名字重複就顯示 `id`（ASCII slug）。**刻意不改後台、不改資料格式。**
- **模組 CSS 的權重鐵律（v2.1 訂、v3 強化；QA 退過一次）**：這份 CSS 是注入到「本身就有 CSS 的宿主」裡跑的，單一 class (0,1,0) 會被 `.home-foot button`（0,1,1）壓過 —— v2.0 的珊瑚「解鎖」鈕實際是透明的、footer 藥丸是沒底色的灰色小字。現在：**滿版層內一律 `#kr-full .kr-x{}`（1,1,0，綁模組自己的 id）**；**滿版層外（只有藥丸）用同一個 class 寫兩次 `.kr-chip.kr-chip{}`（0,2,0）**。**絕對不可以**寫成 `.home-foot .kr-chip`（把宿主結構寫死進模組，下一個 App 會再壞一次）。`styles.css` 裡也**不准出現任何 `kr-` 開頭的規則**（原本那條 `.home-foot .kr-chip{text-decoration:none}` v3 已刪，模組自己鎖死了）。
  - 同一個坑的變形：**`#kr-full .kr-id span` 會連頭像那顆 `<span class="kr-av">` 一起選到**（1,1,1 壓過 1,1,0），66px 圓頭像會變成 13.5px 灰字。所以副標寫成 `.kr-id div span`。加新規則時先想「這個 tag 選擇器會不會掃到自家別的元件」。
- **第二條滲漏路徑：宿主的「繼承屬性」（QA 退件修）**——跟「權重被壓」是不同的病，**權重擋不住它**，因為模組根本沒宣告那個屬性。實測抓到：travel 有 `-webkit-tap-highlight-color:transparent`、食譜本沒有 ⇒ **同一顆頭像磚在 iPhone 上一個 App 點下去會閃灰、另一個不會**；還有 `text-size-adjust`（auto vs 100%）與隱藏 checkbox 的 `font-size`（13.33px vs 16px）。修法是在 `#kr-full`（以及 `.kr-chip`）**把所有會繼承的屬性一次寫死**（tap-highlight／text-size-adjust／box-sizing／font-weight／font-style／font-variant／text-transform／text-shadow／word-spacing／white-space／direction／cursor／font-smoothing／user-select…），`#kr-full input` 另補 `font-size:16px`。
  - **驗法**：用 `getComputedStyle` 把**全部**屬性（~340 項）攤開逐項比對兩個 App，不是挑幾項看。目前差異 = **0**（唯一剩下的是 `.kr-chip .kr-cta` 的 `color` 與它 16 個 `currentColor` 衍生屬性——那正是唯一被允許吃 `--acc` 的鉤子）。宿主 `:root` 的 `--acc/--ink/…` 會被繼承進 `#kr-full` 的 computed style，那是正常的：**模組不讀它們**就不算滲漏。
- **樣式注入時機**：`init()` 就注入 `#kr-style`（不是等第一次 `paint()`）——footer 藥丸每次進站都看得到，不能等使用者開過解鎖畫面才有樣式。
- **改這個模組的驗收線**：同一份模組在旅途手帳與食譜本裡，解鎖畫面的 **computed style 必須逐項相同**（這是「公版」的機器定義，差一項就是半套主題化復發）；`#kr-full` 子樹 grep 不到 `var(--acc`／`--ink`／`--line`…；`.kr-go` 的 `background-color` 必須是 `rgb(246,239,225)`、`.kr-chip` 必須是 `rgb(246,242,234)`；`#kr-pw` 的 `font-size` 必須是 `16px`；觸控目標 ≥44px。

## 資料格式（定案；前後端各有一套 mirror parser，改要一起改）
- 每趟旅程一個 `data/trips/<id>.md`，id = `<ts36>-<slug>`（slug 保留中文）。
- 結構：frontmatter（`name/dest/emoji/theme/start/days/budget/createdAt/updatedAt`，字串 JSON-quoted、數字裸寫）＋ 四段 body：
  - `## 行程` → `### Day N` → 每行 `- {一筆行程點的單行 JSON}`（key 順序固定、空值不寫；欄位：id/title/time/cat/place/note/mapUrl/addr/cost/bookingRef/phone/url/hoursOpen/hoursClose/hours24/hours）
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
- **連鎖平移（v1.6，`shiftAfter`／`minsOf`／`timeOf`／`stopShiftDelta`，定案）**：編輯行程點的「**時間**」或「預計停留」、移動的「移動時間」時，**同一天、這一筆之後、有填時間的行程點各平移相同分鐘數**（transit 沒有 time 欄跳過），跳 toast「後面 N 筆時間已跟著往後移 20 分」（三個入口共用同一句，行為一致）。
  - **刻意是「平移」不是「照停留＋移動重算整天」**（Benson 拍板）：重算會把他刻意留的空檔壓掉；平移保留原本的節奏。代價是硬時間（表演開演、火車、訂位）也會被推走，靠 toast 告知、他自己改回來。**要真正釘住硬時間得加 `fixed` 欄位＋改 md 格式與前後端 parser，刻意先不做。**
  - **改 `time` 也連鎖（2026-08-21 反轉 v1.6 的原始決策，不要當誤改修回去）**：v1.6 當初刻意讓「直接改某一筆的 `time`」**不**觸發平移，理由是「那通常是修正單一筆，不是整天順移」。**Benson 實際用了一陣子後回報「改行程時間，後面的行程時間也不會被推動」** ⇒ 真實情境裡改時間跟改停留一樣是「這站往後挪」，後面該跟著走。當時拍板就講好「要改是一行的事」，他開口＝執行既有共識。現在三個入口（時間／停留／移動時間）行為一致。
  - **平移量的語意＝「這一筆的結束時間」變了多少**（`stopShiftDelta`）：`(新時間+新停留) − (舊時間+舊停留)` ＝ 時間差＋停留差。**同一次同時改時間與停留只推一個總量、不會重複累加**（時間 +10、停留 +20 ⇒ 後面 +30；時間 +30、停留 −30 ⇒ 完全不動）。時間沒動時就退化成純停留差＝v1.6 舊行為。
  - **舊／新時間有一邊是空的（沒時間→有時間、有時間→清空）＝算不出時間差，整筆不平移**（回 0，也不跳 toast）：沒有基準的推算寧可不做。**注意**：兩邊都沒時間、只改停留時仍照舊平移（那是 v1.6 既有行為，別一起關掉）。
  - 跨午夜用 mod 1440 繞回（23:50 +40 → 00:30），不做跨天搬移。時間差本身也用時鐘環算：`23:00→01:00` 直接相減是 −1320，取最短方向（−720, 720]＝ +120，**純粹是為了 toast 講人話**——`shiftAfter` 也是 mod 1440，兩種算法平移出來的時間完全相同。
  - 不確認、不提供復原（Benson 拍板：直接改＋toast 就好）。
- **新增行程點的時間預設值（v1.6，`nextTimeGuess`）**：帶「這一天最後推算得出的時刻」＝從頭走一遍，遇到有填時間的行程點就以它重新對錶，再累加停留與移動。整天都沒時間就留空。
- **`type` 欄位（v1.3）＝時間軸項目型態**：缺值／`"stop"`＝行程點（舊資料無痛，serializer 對 stop **不寫** type，檔案維持原樣）；`"transit"`＝移動。**transit 刻意只用 `note`＋`stayMinutes`（當移動時間），serializer 只輸出 `{id,type,note,stayMinutes}`**——不要幫 transit 補 title/cat/place/費用等站點欄位，「路上」不該佔版面也不該佔資料。UI：transit 是灰色輕薄一條（rail 小空心點＋虛線），點它開精簡表單（不是完整詳細頁）；與 stop 混在同一個 day list 排序／拖曳／刪除。新增走 FAB → 選「行程點／移動」。不做舊「🚗 移動」類別項目的一鍵轉換（Benson 拍板自行手動處理）。
- **`addr`（v2.4，行程點的完整地址）＋ 移動的路線連結（定案；別誤改）**：Benson 貼的都是 `maps.app.goo.gl` 短連結，短連結**不能直接當路線的起訖點**，但跟著 302 展開會拿到完整地址（`?q=504彰化縣…秀水湯包`）——而且**比店名精確**（「秀水湯包」全台好幾家）。展開只有 server 端做得到（瀏覽器跨網域讀不到 `Location`）。
  - **新欄位只加在 stop 上**（key 順序：`mapUrl` 之後、`cost` 之前，空值不寫，前後端 serializer 都有）。**transit 一個欄位都不准加**——它仍然只輸出 `{id,type,note,stayMinutes}`，**路線連結是前端即時算的、不落資料**（「路上不該佔資料」這條原則沒有變）。
  - server 端 `expandMapUrl`：只對 Google 自家網域發請求、最多跟 5 層轉址、單次逾時 5 秒、每次展開間隔 700ms、單輪上限 40 次；抽取序 `?q=` → `@lat,lng` → `!3d..!4d..`。時機＝**存檔後非同步補**＋**啟動補掃一次**（補手機端新增的）。**展開失敗絕不影響存檔**（POST 實測 9ms 回應，失敗只 log、下次再試）；補寫時重讀最新檔、只補「還是同一條 mapUrl 且還沒有 addr」的那筆，`updatedAt` 不動。
  - `addr` 是 `mapUrl` 的衍生值：POST 時 mapUrl 沒變就沿用既有 addr（手機舊版把 addr 洗掉會自動補回來）、mapUrl 清空則 addr 一起清掉；前端改 mapUrl 也會先清 addr。**同一份檔的寫入（POST 與 addr 補寫）走 `queueTripWrite` 排隊**，避免補寫蓋掉剛存進來的資料。
  - 連結＝`https://www.google.com/maps/dir/?api=1&origin=…&destination=…&travelmode=…`（官方 Maps URLs API，手機點了會開 Google Maps App）。起訖點來源優先序 **`addr` → `place`**，**`title` 刻意不算**（「宵夜？」不是地址，搜出來會是亂的）。**兩端都要有可靠來源才顯示連結**——**上一站算不出地址就不顯示**（Benson 拍板：不要用「目前位置」當起點、不要拿名稱去猜）；一天的頭尾（沒有上一站／下一站）自然也不顯示。
  - **交通方式看 transit 的備註自動判斷**（`travelMode`）：走路／步行→walking；腳踏車／單車／YouBike→bicycling；捷運／地鐵／公車／巴士／電車／火車／高鐵→transit；**「騎車」在台灣多半是機車 → driving**；認不出來→driving。
  - UI：路線鈕沿用卡片的 `.map-btn`（同一個圖示語言），但在灰條裡**視覺縮到 38px＋上下負 margin**，實測灰條高度維持 38px（跟沒有鈕的那條一樣）；命中區用 `::before inset:-3px` 外擴回 44px（跟 v1.3 的工具鈕同一招）。**調整模式不顯示**、點它 `stopPropagation`（不會順便打開編輯移動的表單）。
- **`addr` 的 GitHub Actions 補寫（v2.5，定案；別誤改）**：Benson **幾乎只用手機**，而展開短連結手機做不到 ⇒「要回電腦開一次 server 才長出路線連結」等於沒做。所以加了一台不是他電腦的機器：`.github/workflows/backfill-addrs.yml`（push 到 main 且 `data/**` 有變動時觸發，`permissions: contents: write`＋內建 `GITHUB_TOKEN`，**不用任何 PAT**、零依賴只用 Node 內建模組）。
  - **邏輯不分岔**：workflow 不自己寫展開邏輯，跑的是 `.github/scripts/backfill-addrs.js`，那支 `require('../../server.js')` 直接呼叫**同一個** `scanAllAddrs()`。為此 server.js 的啟動段包進了 **`if (require.main === module)`**（被 require 時不 build `docs/`、不開 port、不 `initSync`），並在檔尾 `module.exports` 出 `{ scanAllAddrs, backfillTripAddrs, expandMapUrl, TRIPS_DIR, DATA_DIR }`。**要改展開邏輯只改 server.js 那一份**；別在 `.github/` 底下複製一套（這個專案已經有「前後端兩套 parser」的債了）。
  - **`AUTO_SYNC=0` 必須在 require server.js 之前設**（server.js 載入當下就讀那個環境變數），否則 server 的 git 自動同步會跟 workflow 的 commit 打架。
  - **防自我觸發迴圈三道**：①**沒變更就不 commit**（根本那道——第二輪 addr 都補齊了、腳本一個位元組都不寫）；② GitHub 內建「GITHUB_TOKEN 推的 commit 不再觸發 workflow」；③ commit 訊息帶 `[skip ci]` ＋ job 的 `if: !contains(head_commit.message,'[skip ci]')`。
  - **三方同時寫同一個 repo**（手機 Contents API／電腦 server.js／Actions）：push 前 `git pull --rebase --autostash`，失敗就 `git rebase --abort` 再重試，最多 3 次；三次都撞就**放棄並 exit 0**（不硬幹、不留半套 rebase 狀態），下次有人動 `data/**` 會再補。
  - **只准碰 `data/`**：commit 前有一道 `git status --porcelain | grep -v '^data/'` 斷言（用 `-c core.quotepath=false`，因為旅程檔名有中文）。
  - **壞連結／逾時／Google 擋 runner 都不讓 workflow 變紅燈**（只留 annotation）——這是加值功能，紅燈只會變成他手機上的噪音。
  - **已知**：像 `maps/dir/?geocode=A;B` 這種**路線型**短連結展不開（沒有 `?q=` 也沒有 `@lat,lng`），且**沒有負向快取** ⇒ 每一輪都會再花 3 次請求重試它。無害（不寫檔＝不 commit），要根治得加欄位改資料格式，刻意先不做。
- **`.gitattributes` 強制 md/js/css/html/json/yml 為 LF**；前後端 parser 開頭都先 `replace(/\r\n/g,'\n')`。壞的 JSON 行 parser 會跳過該行（不整檔炸掉）。（`.yml` 是 v2.5 補的：workflow 的 `run:` 區塊在 ubuntu bash 跑，CRLF 會變成 `$'\r': command not found`。）

## PWA 鐵律（recipe-book 血淚，全部已做，別退步）
- 所有資源、manifest `start_url`/`scope`、SW scope **一律相對路徑**（Pages 在 `/travel-book/` 子路徑）。
- SW：`skipWaiting()`＋activate 清舊快取＋`clients.claim()`；`/api/data` network-first、寫入 network-only、殼 cache-first。**改前端記得把 sw.js 的 cache 版本號 +1**（`travel-shell-vN`，目前 v14）**並同步 `APP_VER`**（見下方「版本與更新」）。
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
