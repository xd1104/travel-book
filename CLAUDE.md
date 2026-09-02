# travel-planner（旅途手帳）— 專案備忘（給接手的 AI／開發者）

手機優先的旅遊行程 PWA。Benson 自用：一趟旅程 = 逐日行程 + 花費 + 打包清單 + 自由備註。
UI/UX 以 `demo/index.html`（UX demo v3.1，Benson 拍板）為準，**勿自行改設計**；設計規格見 `DESIGN.md`。
**打包分頁**另有一版拍板的 demo：`demo/packing.html`（v2.9 改版，規格＝`DESIGN.md` 附錄 D）。

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
  - `## 花費` → 每行 `- {id,amount,cat,desc,note,day,plan}`（key 順序固定、空值不寫）
    - **`desc` ＝標題（短，清單上那一行）、`note`（v3.7）＝說明（長，補充）**。⚠️ **刻意不改 `desc` 的語意也不換 key**：它本來就是清單顯示的那個值，沿用它 ⇒ 舊資料（一句話全塞在 desc）零遷移、該顯示什麼還是顯示什麼，他自己再拆。`note` 空字串／全空白不寫。
    - ⚠️ **說明在清單上必須自己獨立一行、跨整列**（`.exp-note`，左緣 `padding-left:54px` 對齊標題）：塞進 `.exp-mid` 的話那一欄被 emoji／金額／✕ 夾住**只剩約 130px**，一句話會被截掉大半，分標題與說明就失去意義（實測獨立一行有 **211px**，他真實那句「過年期間每間要補 1200」完整放得下）。仍只給一行＋`text-overflow:ellipsis`，完整內容點進去看；沒有說明就整行不出現。
    - 表單順序＝「這是什麼」先講完再講 metadata：金額／類別 → 標題 → 說明 →（已經幫他預設好的）哪一天。說明用 `textarea rows=2` 不用 `input`（他真的會寫一整句）。
    - ⚠️ **`budget` 是 0（還沒設預算）時不可以拿 0 去減**：會顯示「還可以再排 NT$ -1,200」，看起來像超支、其實只是他還沒填。這種時候**進度條整條不出現**，那一列改成一顆「還沒設預算・設一個 ›」的入口（`.budget-row.set-budget`，是 `<button>` 要自己補 `width:100%`／`text-align`／≥44px）。
    - **`plan`（v3.5）＝這筆只是「預計要花」、還沒付**；缺值＝已付。**真值刻意是 `plan` 不是 `paid`**：既有資料全是「已經花掉的」，用「缺值＝已付」才做得到零遷移（跟 `kind`/`bag`/`day` 同一招）。`plan:false` 不寫。
    - **「預計」與「已付」是同一筆的兩個狀態、不是兩份清單**（Benson 拍板）：先記「訂房 3200・預計」，真的付了在編輯裡切成「已經付了」，**不用重打一次**。實測切換後總額不變、金額只是從「還沒付」搬到「已付」。
    - ⚠️ **`spentOf` 的語意在 v3.5 收窄成「只算已付」**（首頁旅程卡也用它——還沒花的錢不叫花費）。新增 `planOf`（還沒付）與 `needOf`＝`spentOf+planOf`（**這趟要準備多少**）。**預算的比較對象是 `needOf` 不是 `spentOf`**，否則規劃期把住宿車票都排進去了，畫面還是說「還可以花 20,000」。
    - **花費卡的主數字＝「這趟要準備」（Benson 拍板）**，下面兩行是「預算／還可以再排」與「已付／還沒付」。進度條做成**兩段**（實心＝已付、`#ffd2cb`＝預計）。⚠️ `.prog` 要改 `display:flex`（原本是 block，兩個 `<i>` 會上下疊），**圓角改由容器裁切**（兩段各自圓角的話接縫會出現兩個對背的半圓）。
    - **新增時的預設：還沒出發＝預計、已經出發＝已付**（規劃期在排錢、旅程中在記帳）。⚠️ `.pay-seg` 的 `.on` 是 render 當下給的，點 radio 不會重畫 sheet ⇒ **一定要 `paySegSync`**，否則按了白片不會移動、看起來像沒反應。
    - 行程分頁的當天條：**這天還有沒付的 ⇒「這天要花」，全部付掉了 ⇒「這天花了」**；`spentOfDay` v3.5 起回傳 `{paid,plan,all}`（不再是單一數字）。
    - ⛔ **行程點的 `cost`（「預估費用」）UI v3.5 移除**：它從來沒有任何地方加總、Benson 真實資料一筆都沒填過，而且蓋不到「車票」（那是 transit，transit 刻意不存費用欄位）。**預估花費統一走花費頁的 `plan`——不要讓兩個地方都能填錢**，否則兩邊加起來不一樣、也沒人說得出哪個算數。
      - ⚠️ **serializer／parser 的 `cost` 刻意留著**（比照 `bookingRef`），而且 `submitStopEdit` **不可以寫 `sp.cost = ...`**：`f.cost` 已不存在（會 TypeError），塞 0 則等於「一存檔就清掉舊值」。實測：塞一個 `cost:999` 進去，開表單→存檔後仍是 999。
      - ⚠️ 連 `.f-row2` 外框一起拿掉：它是 `1fr 1fr` 的 grid，只剩電話一格時會孤零零佔左半邊、右邊開一個洞。
    - **`day`（v3.3）＝這筆算在哪一天**：`"pre"` ＝**行前**（機票／訂房這種出發前就花的錢，不屬於任何一天但通常最大筆，Benson 拍板要有這個選項）；`1..N` ＝ Day N；**缺值＝沒指定，舊資料零遷移**（實測：舊檔 parse→serialize 逐字不變）。
    - **刻意不驗證上限**：`day` 比目前的 `days` 大時照留、選單也照列得出來（`Day 9（超出目前天數）`）——跟 itinerary 的**縮天不刪資料**同一個哲學。少了選單那條，一點開編輯就會被無聲改成「沒指定」。
    - **前後端各一套 `expDayVal`／`cleanExpense`，改要一起改**（已有逐筆對照測試：9 個邊界 case 兩邊輸出必須逐字相同）。
    - **UI（v3.3，定案）**：① 花費頁**按天分組**，順序＝行前 → Day 1..N →（超出天數的）→ 沒指定，**空的組不顯示**（7 天旅程一開頁面就 9 個空標題）；每組右邊是小計。組標題**沿用 `.pack-head`（打包區標題）那套語言，不發明第三種群組標頭**。② 行程分頁顯示「這天花了 X」（`.day-spend`），**0 元不顯示**（不是資訊、只是噪音）、**調整模式不顯示**（跟銜接條同一個理由：會改動 timeline 上方高度、干擾拖曳讓位）。③ 新增時**預設帶「今天是這趟的第幾天」**（出發前＝行前、旅程中＝那一天、結束後不猜）。
    - **一定要同時給「改」的地方**：**新增與編輯共用同一張 sheet**（跟 v2.6 地圖欄、打包 v2.9 同一個決策）。理由：加了歸屬卻沒有地方改＝記錯天只能刪掉重打，**那正是打包 v2.9 診斷出來的病根**，不要再犯一次。
    - ⚠️ **命中區是「整列」不是「說明文字」（v3.4 修）**：v3.3 只把 `.exp-mid` 做成按鈕，實測 375px 下命中區只有 x 84~202＝**整列的 32%**，而**金額那一大塊跟左邊的 emoji 都是死區**——使用者最自然會去點的偏偏就是金額（Benson 回報「需要可以編輯花費的功能，就點一下開啟編輯面板」時，功能其實已經在了，是命中區做太窄）。現在 emoji＋說明＋金額整包是一顆 `.exp-open`（實測 77.3%），**只有 `.x-btn` 留在外面**——刪除必須是獨立目標，不可以被「點一下開編輯」吃掉（實測：點 ✕ 是刪除、不會開面板）。
      - 教訓：**「做了」跟「找得到」是兩件事。做完一個入口要量它佔那一列多少比例，不是確認 onclick 有綁上去。**
    - ⚠️ **`name="id"` 不可以用**：`HTMLFormElement` 本身就有 `.id`（元素的 HTML id），`f.id` 會拿到那個字串而不是 input，編輯整個失效。這裡用 `name="eid"`。
    - ⚠️ **`.exp-head` 一律寫成 `.pack-head.exp-head`（0,2,0）**：元素同時帶兩個 class，而 `.pack-head` 定義在 `.exp-*` 那一段**後面**，同權重後來居上 ⇒ 只寫 `.exp-head{margin:20px…}` 會被 `.pack-head{margin:2px…}` 蓋掉（實測上緣是 2px）。
    - ⚠️ **第一組的上緣留白不可以用 `:first-of-type`**：它比的是「兄弟裡第一個 div」，而 `.cat-sums`／`.sec-title` 都排在前面 ⇒ 永遠不生效。改由 JS 標 `.first`。（`:first-of-type` 在這個專案已經害過三次。）
  - `## 打包` → 每行 `- {id,text,done,zone,kind,bag}`（zone: `carry`｜`checked`；**key 順序固定、空值不寫**）
    - **`kind:"bag"`（v2.9）＝這一筆是一個「包」**（盥洗包／3C 小包）；**缺值＝一般物品，舊資料零遷移**。
    - **`bag:"<父包 id>"`（v2.9）＝這一筆在哪個包裡**；**缺值＝直接放在區裡**。
    - 刻意**維持平的一行一筆、不用巢狀 JSON**（`{...,"items":[...]}` 會讓一行變很長、git diff 讀不了、衝突機率上升，而且前後端 parser 與所有既有的 `t.packing.filter(...)` 都要重寫）；也刻意**不獨立成 `## 包` 一段**（兩段之間的排序要同步，更痛）。
    - **normalize 四條（`normalizePacking`，前後端各一套、必須冪等）**：① `bag` 指向不存在的 id → 降級成頂層（壞掉的參照要有 fallback，跟類別的 `other` 同一個哲學）；② `kind==="bag"` 強制沒有 `bag`（**只允許兩層**）；③ **包內物品的 `zone` 不是真值來源**，序列化前一律同步成父包的 zone（一個數值不可以兼兩份工作，否則會長出「包在行李、內容標隨身」的矛盾狀態）；④ 輸出時**包的小孩緊跟在包後面**（parser 不依賴這個順序，但檔案要人讀得懂）。
  - `## 備註` → **永遠最後一段、整段原樣文字**（parser 進入後不再解析 heading，所以備註裡打 `##` 不會壞）
- 打包模板 `data/templates/<id>.md`：frontmatter `name` ＋ `## 項目` JSON 行（`{text,zone,kind,bag}`，**kind/bag 是 v2.9 加的選填欄位、舊模板零遷移**）。內建三款種子（intl-basic／local-trip／beach-onsen）：templates 資料夾全空時 server 啟動自動補（在 startup pull 之後，避免蓋掉手機建的）。
  - ⚠️ **模板的 `bag` 存的是「包的名字」不是 id**（`normalizeTplItems`）——模板檔本來就沒有 id、是人可以手打的小清單。normalize 四條跟 `normalizePacking` 一樣，只是父參照換成名字。
  - **帶入的合併規則（v2.9，比舊的「同名跳過」多一層）**：① 模板裡的包，旅程裡**已經有同名的包 → 不新增第二個**，把缺的東西補進他原本那個包；② 一般項目的同名判定**連容器一起比**（`text` 相同**且**在同一個包裡才算重複——「常備藥」放在盥洗包裡跟放在行李箱底層是兩件事）。帶入兩次的第二次必須是「帶入 0 樣，N 個包直接合併」（冪等）。
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
- **地圖連結欄 v2.6（`mapField`／`MF`／`mapf*`，DESIGN.md 附錄 A2 方案 A，Benson 拍板；別退回普通 input）**：編輯／新增行程點的那一欄**顯示的是 `addr`（地址）不是 `mapUrl`（網址）**。理由：Benson 的流程是「Maps App 分享→複製→回來貼」，舊的 input 要先在手機上把一長串短網址刪光才貼得進去，而那串網址人根本看不懂、佔一整欄卻沒有資訊量。
  - 三個狀態：① 沒連結＝虛線「貼上 Google 地圖連結」；② 有 `mapUrl` 有 `addr`＝地址卡（副標只顯示 host）；③ **有 `mapUrl` 但還沒有 `addr`＝「已連結，地址整理中…」**（`.mlink.pending`）。
  - **狀態 ③ 是正常狀態不是壞掉**，一定要留：展開短連結只有 server／CI 做得到，手機端存檔後要等 GitHub Actions 跑完（約一分鐘）才長得出地址；而路線型短連結（`maps/dir/?geocode=`）本來就永遠展不開（見上面「已知」）。**文案刻意中性、不准寫「失敗」**，也不能留白（會看起來像壞掉）。
  - 「貼上新連結」＝`navigator.clipboard.readText()` 直接覆蓋（1 個動作）。**`readText()` 一定要有 fallback**：iOS Safari 會跳系統的貼上確認、使用者可能不點，非安全脈絡直接 reject ⇒ 讀不到就**退回手動輸入子狀態並自動全選**（`setSelectionRange` 不要用 `select()`）。沒有 fallback ＝ 這功能在他手機上有機率整個不能用。
  - **值的載體是隱藏的 `<input name="mapUrl">`**，所以 `submitStopEdit`／`submitStop` 讀法（`f.mapUrl.value`）一行都不用改；**新增與編輯共用同一個元件**，不要複製第二份 UI。
  - **`mapUrl` 一有變動（含 ✕ 清空）就把 `addr` 清掉**，而且清除的時機在**「按下貼上／✕ 的當下」**（畫面立刻反映），不是等到存檔——`addr` 是 `mapUrl` 的衍生值，留著舊地址＝移動那條的路線鈕會用錯的起訖點。落盤那一道（submit 裡的 `if(newMap !== sp.mapUrl) sp.addr=""`）刻意留著當保險。**改到一半關掉 sheet 就是不存檔、資料一個位元組都不動**（跟表單其他欄位一致）。
  - **前端永遠不自己寫 `addr`**（只有 server／CI 展得開短連結），UI 只負責顯示與清空。**`transit` 一個欄位都不准加**，它的表單仍然只有 `note`＋移動時間。
- **銜接提示與重新排（v2.8，`analyzeDay`／`lateSet`／`replanDay`／`bufferDiff`，定案；規格＝`demo/reschedule.html`＋`DESIGN.md` 附錄 C）＝擴充連鎖平移，不是取代它**：
  - 病根：連鎖平移「後面全部加減同樣的分鐘數」，**保留原本的相對關係、包括原本就錯的**。他真實 Day 1 的飯捲（10:40 停 240 分）＋開車 40 分 ⇒ **15:20** 才到得了，沐楓商旅卻填 14:45 ——**少 35 分**；他改三次開車時間、每次平移都正確，那 35 分卻被原封不動搬著走。缺口是更早「新增／拖曳」造成的，那兩條路徑當時**不會推動後面**。
  - **新算的那一半＝「這一站幾點才到得了」**（`analyzeDay`）：cursor 從頭走，**每站以他填的時間重新對錶**（跟 `nextTimeGuess` 同規則，否則第一個缺口會污染整天）；跨午夜用 `liftTime()` 把鐘面時刻抬到 cursor 那一圈（宵夜 01:45 才不會被誤判成晚 22 小時）。
  - **只標負的差**（`gap>=5` 分才收）。**正的差是他刻意留的緩衝，絕對不標**——demo 裡「連空檔也標」那個開關是對照組，**刻意沒做進正式版**（全標＝提示變常態、失去意義）。
  - **重新排的規則只有一條：`新時間 = max(他填的時間, 走得到的時間)`，只往後推不往前拉**（`replanDay`）。所以**只有來不及的會被挪，撞到他刻意留的空檔就被吸收掉、後面不用再推**（真實 Day 1：沐楓 14:45→15:20、陽光劇場 15:45→16:20、**宵夜不動**、夜市前的空檔 1 小時→25 分）。**不可以簡化成「後面全部 +N」**（那就是連鎖平移，等於沒做）。**壓實模式刻意不做**（v1.6 那條「重算會把刻意留的空檔壓掉」沒有變）。
  - **一定要先預覽（差異清單）、他按「就這樣排」才套用**：`先不要`＝`closeSheet()`，資料一個位元組都不動、`persistTrip` 一次都不呼叫。範圍兩種：**從某一站起** / **整天重排**（同一支 `replanDay`，只差 `startIdx`）。預覽必須講「哪段空檔從多少變成多少」（`bufferDiff`）。
  - **UI 層級（v2.7 的教訓）**：`.gap-note` 銜接條＝「這張卡的狀態」→ 無底色 hairline，**不准借藥丸的底色語言**；rail `.ln.to-late`＝「兩站之間的狀態」→ 只換顏色；`.fix-bar`＝「工具」→ 才給底色與 ≥54px。**配色是琥珀（`--warn-*`），沿用「有新版本」那套語言，刻意不用 `--bad`——語氣是提醒不是報錯。** 調整模式**不顯示銜接條**（會改卡片高度、干擾拖曳讓位），`.fix-bar` 照常顯示（在 timeline 之外）。
  - **`.gap-note::before` 是 `top:-18px` 不是 demo 的 -9px**：demo 註解宣稱 44px，實測只有 35.2px；往下不能擴（會蓋到地圖鈕與時間、把「看詳細」偷成「重新排」）⇒ 往上補，實測 44.2px。連帶**新增 `.stop-card .map-btn{position:relative}`**：銜接條是 positioned、地圖鈕 `margin-top:-10px` 會探進它那一行被疊住，實測命中高被壓成 41.5px；讓地圖鈕自己也 positioned 就贏回堆疊順序（零版面變化，回到 44.0px）。**這兩條別當多餘的修飾刪掉。**
  - **新增之後也要推**：`submitStop`／`submitTransit` 加完呼叫**既有的** `shiftAfter`（推的量＝新的停留／移動時間）。⚠️ 目前新增**一律加在最後**，所以實務上推到的筆數幾乎都是 0——這條是**為未來的「插在中間」先接好**。**拖曳排序後刻意不自動動**（意圖不明確），但排序後變成來不及時銜接條會自己出現。加完若這天接不上，toast 升級成可點的（`toast(msg,isErr,{label,fn})`＝v2.8 給既有 toast 加的**選配第三參數**，不帶就跟舊版一模一樣）。
- **打包分頁 v2.9（區 → 包 → 物品；規格＝`DESIGN.md` 附錄 D，視覺與拖拉手感＝`demo/packing.html`，Benson 拍板；別自行改設計）**：
  - **病根只有一個**：「這一筆東西的**歸屬**」從頭到尾沒有地方可以改。舊版每一列只有「勾／文字／✕」，**完全沒有編輯**——改名要刪掉重打、加錯區只能刪掉重加、想要「盥洗包」只能打成一行純文字（他真實資料裡的「盥洗包」「防水包」就是這樣來的＝需求訊號不是滿足）。所以這一版是**把歸屬變成一等公民**（可看、可拖、可選、可改），不是「加一個資料夾功能」。
  - **拍板的六件事（不要再問、也不要自作主張改回去）**：① 包同時是**容器也是一件物品**（有自己的勾，也能展開編輯內容）；② **各勾各的**（勾包 ⇄ 勾包內物品完全不連動）；③ **只允許兩層**；④ 模板也要能有包；⑤ **點方塊＝勾、點文字＝編輯**；⑥ **拿掉上面那排區域 segmented**（兩區同時顯示）＋**拖曳把手 ☰ 常駐**（不用進調整模式）。
  - **兩種進度、分母不同**（數字才對得起來）：區的「已打包 x / y」分母＝**這一區的頂層項目**（包算 1 件、包內物品不計）＝「行李箱裝好沒」；包的「已裝 x / y」分母才是包內物品＝「這個包裝好沒」。
  - **勾包會自動收合，但還是點得開**：收合那一下在 `togglePack` 做（`ui.pk.open[id]=false`）。⚠️ `pkBagHtml` 的 `open` **不可以寫成 `!!ui.pk.open[p.id] && !p.done`** ——那會讓已打包的包**永遠打不開**（demo 有這個瑕疵，dev 實測抓到並修掉）。
  - **⚠️ CSS 掃進子元件是這個專案反覆出現的坑**（跟 `#kr-full .kr-id span` 同一種病）：包是「一張卡的上下兩半」，所以 `.pk-bag .t{}` 會**連包裡面每一列的 `.t` 一起選到** ⇒ 勾了包連裡面都被劃掉，直接跟「各勾各的」矛盾。**包頭專用的規則一律綁 `.pk-bag .pk-head-row .t{}`**；加新規則前先問一次「這個選擇器會不會掃到子層」。另一條同族的：**包裡面的列一定要同時帶 `pk-row`**（所有 `done` 樣式都掛在 `.pk-row.done` 上，少了它包裡面勾起來畫面完全沒反應，**資料是對的所以功能測試抓不到**）。
  - **拖曳是新的一套 `packDrag*`／`pkPaintDrag`，刻意不跟行程分頁的 `dragStart/dragMove/dragEnd` 共用**（那是「index 位移＋讓位動畫」，這裡是 slot 制，混在一起兩邊都會壞）。手感沿用行程：pointer events／只有把手可拖（`touch-action:none`）／`setPointerCapture`／`preventDefault`／邊緣自動捲動 **TH=80、SPEED=9**（上緣多讓 40px 給頂部橫條）。
    - **落點＝slot 制**：每個插入點放一個零高度的錨 `<i class="pk-slot" data-z data-b data-ref>`（**要 `display:block` 才量得到寬度**），每次 pointermove 重算 `getBoundingClientRect`。**`data-ref` 是「插在哪一筆之前」不是 index**（移除來源之後 index 會失準）。紅利：跨區／進包／出包／包內排序／包本身排序**全部同一個機制**。
    - ⚠️ **這裡用 client 座標是對的**（每一幀都重量、沒有「開始時的基準」，自動捲動後 rect 自己就更新了）。**若有人改回 transform 位移法，就必須回到 page 座標**（`clientY+scrollY`，那是行程那一套的規則）——別混用。
    - **進包 vs 排到旁邊**：手指 Y 落在包頭那一列的**中間 60% ＝進包**，上下各 20% 退回一般插入點。拖的是包時整條判定跳過（包不能進包）。
    - **落點提示三個一起上，缺一個都不夠**：① **頂部固定橫條**（`#pk-dragbar`，手指擋不到、不會抖）＝主要訊號；② 進包＝整張包卡珊瑚環＋包頭淡珊瑚底；③ 排序＝3px 插入線＋左端圓點＋**右端目的地藥丸**。插入線是 `position:absolute` 的**零高度疊層**（撐開間隙會讓所有 slot 在手指底下跳動、來回抖）。
    - **⚠️ 兩個實測踩出來的細節，別「優化」掉**：(a) **浮起來的那張卡要浮在手指上方**（寬 `min(卡寬×0.72,250)`、右緣貼手指右邊 22px、**底緣在手指上方 14px**、頂端 clamp 52px）——壓在手指底下時它會**完整蓋住你正要放進去的那個包**，高亮等於沒做（實測：現在只蓋住目標包卡 17.3%）；(b) **被拿起來的那一列用 `visibility:hidden` 不能用 `display:none`**（display:none 實測位移 66px，手指底下的落點當場換人；visibility 實測 **0px**）。拖整個包時才另外把 `.pk-inner` 收掉（否則留一個大洞）。
  - **拖拉不可以是唯一的路**（單手／清單很長／不想拖）：① **點文字 → 編輯 sheet → 「放在哪」**（把所有目的地攤平成可點清單，包本身只列得到區）；② **長按 450ms → 動作選單**（改名字／換位置、打開看裡面、標成已打包、複製、刪掉）。長按是隱藏手勢所以**只當捷徑不當唯一入口**；⚠️ 長按開了選單之後**那一下的 `click` 必須在 capture 階段吞掉**，否則會順便勾起來／開編輯。
  - **新增分兩條、不是二選一**：**就地快速加**（每個容器底部一條虛線「＋ 加東西到…」，**「加到哪」由輸入框長在哪裡決定**、Enter 連續加、focus 不放掉）負責「量」；**彈窗只管結構**（建包、換位置）負責「結構」；模板負責「一整套」。新增與編輯**共用同一張 sheet**（跟 v2.6 地圖欄同一個決策，別複製第二份 UI）。
  - **刪掉一個包＝裡面的東西「倒出來」留在同一區**，不跟著消失（toast 要講清楚幾樣、留在哪一區）。
  - **打包 v3.0 修正版（規格＝`DESIGN.md` 附錄 E，視覺＝`demo/packing-v2.html` 的「v2 新版」，Benson 三項全選 A；別當誤改改回去）＝只動「長相」與「怎麼觸發」，v2.9 的六件事與資料格式一個位元組都沒動**：
    - **病根：打包借了「一張卡＝一個實體」的語言去排 22 筆的清單** ⇒ 19 張浮卡、21 道陰影，「盥洗包」跟「一支牙刷」視覺一樣重，層級整個扁掉。**改成 App 自己處理長清單的語言**（首頁「回憶」的 `.mem-card`＋hairline 分列）：`.pk-list` 變成那張白卡，`.pk-card` 拿掉底／圓角／陰影／margin 改 `border-top`，**包重新變成畫面上唯一的第二層容器**（`#fbf7f0` 淡底盒子）。實測陰影 18→5、頁高 −129px。
    - ⚠️ **`.pk-list > .pk-card:first-of-type` 一定要帶 `:not(.pk-bag)`**（demo 的樣板資料剛好沒有「包排在區的第一筆」，所以沒踩到；實測抓到）：包也帶著 `.pk-card`，排第一筆時自己那圈框的上邊會被消掉，變成三邊的盒子。這條的用意只是「第一列不要有分隔線」。
    - **v3.1（Benson 實機回報「這邊的線跟框框重疊，有點醜」）＝兩條「線跟框打架」，都只動 CSS**：
      - ⚠️ **包旁邊的相鄰選擇器一定要跨過 `.pk-slot`**：每個縫裡都插了一個零高度的落點錨，所以 v3.0 寫的 `.pk-bag + .pk-card{border-top:none}` **實測選到 0 個元素、是死碼**。少了它，包後面那一列照樣長出全寬 hairline（x 16→359），跟包那圈 14px 圓角的框（x 24→351）只差 8px、左右各多伸 8px ⇒ 一條直線貼著一個圓角盒子。正解 `.pk-bag + .pk-slot + .pk-card, .pk-bag + .pk-slot + .pk-add{border-top:none}`（**`.pk-add` 也要**，包排在區最後一筆時下面接的是它）。**包自己的框就是分隔了，不要再補線。**
      - ⚠️ **`.pk-sub-row` 的 `margin-left` 必須剛好等於「直軌右緣 − `.pk-inner` 內容左緣」**（2px 軌 ＋ `left:18px` − `padding-left:14px` ＝ **6px**）：少了它，每一列的 `border-bottom` 會從直軌**左邊** 4px 起跳、**橫穿過那條直軌**，三條橫線各戳一個尾巴。`padding-left` 同步 16→10 把字補回原位（實測勾選框 65.5、字 105，改前改後相同——**動左邊界時一定要回頭量內容有沒有被推走**）。`.pk-inner .pk-add` 也補 `margin-left:6px`，包裡面所有看得見的邊對齊同一條線。
      - 這兩條跟 `:not(.pk-bag)` 是**同一種病的第三、第四次**：`.pk-bag` 同時是「一張卡」又是「一個盒子」，任何以 `.pk-card` 為前提寫的線都會跑到盒子的框旁邊。**在這一區加任何 border 之前，先問「包會不會也吃到，吃到之後會不會跟它自己的框並排」。**
    - **v3.2「包裡面的兩個入口」＝方案 B（規格＝`DESIGN.md` 附錄 F，視覺＝`demo/packing-v3.html` 的 `.v-b`，Benson 拍板；別改回去）**：包展開後盒子裡同時擺著「東西（hairline）」「虛線圓角框（加東西）」「一整行文字鈕（這個包的設定）」＝三種語言兩個矩形。改成兩件事：① **`.pk-inner .pk-add` 虛線框 → hairline 尾列**（跟區層 v3.0 同一種語言）；② **`.pk-bagset` 整行刪掉**，改成**包頭右邊、展開時才出現的一顆 ✎（`.pk-edit`）**，**盒子裡面只剩「東西」**。
      - ⚠️ **「包裡面那條 `.pk-inner .pk-add` 維持虛線」這條 v3.0 的規則，已被 Benson 在 v3.2 親自推翻**（CLAUDE.md／DESIGN.md 附錄 E／`styles.css` 的註解都已改掉，別再照舊註解改回去）。
      - ⚠️ **「包頭那一排不准動」這條 v3.0／v3.1 的禁令，也由 Benson 在 v3.2 親自解除** —— 但**只准加 `.pk-edit` 這一顆**，勾選框／📦／名字／進度條／`.pk-chev`／把手全部原樣。取捨他知情後仍選 B：**包名可用寬度 220→176px（−20%）**，他真實的三個包名（換洗衣物／盥洗包／本色防水包）自然寬 88.66／104.66／120.66px，**都不折行**。
      - ⚠️ **`.pk-edit` 只在 `open` 時輸出 markup**（不是用 CSS 藏）：收合時 0 顆，否則會沿右緣跟把手重複成一條柱（v2.7 `.map-btn` 的同一個病）。
      - ⚠️ **`.pk-inner .pk-add` 一定要 `width:calc(100% - 6px)`，不可以寫 `width:auto`**：`<button>` 就算 `display:flex`，`width:auto` 仍然是 shrink-to-fit ⇒ `border-top` 只畫到 x=229 就斷（`.pk-sub-row` 是 344）。實測改完尾列端點＝45／344，**跟 `.pk-sub-row` 逐字相同**，離包框（351）7px；包內勾選框 x=65.5、文字 x=105（跟 v3.1 同一組，沒被推走）。
      - **量到「值沒變」時先懷疑 CSS 註解與選擇器**（多打一個 `*/` 會把後面整條規則吞掉），不要先懷疑瀏覽器快取。
      - ⚠️ **`.pk-bag + .pk-slot + .pk-card` 也必須帶 `:not(.pk-bag)`（v3.1 漏掉、v3.2 修）＝同一種病的第五次，而且這次是「修 bug 修出來的 bug」**：v3.1 加這條是為了「包後面那一列不要補 hairline」，但包自己也帶著 `.pk-card` ⇒ **「包後面接另一個包」時，第二個包自己那圈框的上邊被吃掉、變成三邊的盒子**。Benson 真實資料正是「換洗衣物」後面接「盥洗包」，**v3.1 上線後他看到的就是這個**（他回報「還是有點醜」）。用 `git archive origin/main` 拉基準版 A/B 比對確認是 v3.1 引入的。
        - **驗收口徑跟著改**：不是「包後第一列 `border-top:0`」，而是「**包後第一列若是一般列才 0；若是另一個包，它自己的四邊框必須都在**」。
        - **量法**：負控組（把 `:not(.pk-bag)` 拿掉）必須量得出第二個包變成 `0px/0.8/0.8/0.8`；量不出來就是尺壞了，不是修好了。
        - 教訓：**這一區每加一條 border 就要問「包會不會也吃到」——`:first-of-type` 問過一次、`+ .pk-slot +` 又漏一次。同一句話已經寫在上面，還是漏了，所以規則升級成：任何 `.pk-card` 選擇器一律先寫 `:not(.pk-bag)`，確定要選到包再拿掉。**
    - **頂部＝進度為主**：`.pk-new`（256×50 的珊瑚實心塊）整條砍掉，換成 `.pk-prog` 進度藥丸＋兩顆白底 `.pk-lite`。**珊瑚只留給進度**（實測整頁最大的飽和色塊 12,820px² → 打勾圈 729px²）。進度條沿用 `.pk-sub .bar` 的 4px 純珊瑚，**不要用花費頁的漸層 `.prog`**。分母＝頂層項目（包算 1），跟區的計數同一套口徑。
    - **誤觸修正＝「先觀察，後接管」（`packGripDown`／`pkPendMove`／`pkClearPend`／`pkArmDrag`／`pkBeginDrag`）**：把手 `touch-action` 從 `none` 改成 **`pan-y`**，`pointerdown` 只進待命；**垂直 >8px 放行給捲動／橫向 >12px 或按住 220ms 才進入拖曳**（常數 `PK_V_ESC`／`PK_H_ARM`／`PK_T_HOLD` 在檔頭）。進入拖曳才 `setPointerCapture`＋`<html>.drag-lock`＋震動；**鎖捲動一定要靠全域 `touchmove` 的 `preventDefault`**（`touch-action` 在手勢一開始就決定了，中途改沒有用）。
      - ⚠️ **待命期間不可以把原點跟著手指移**（「方向不明就重設基準」那種寫法）＝橫向門檻永遠累積不到，「往左帶」直接失效。
      - ⚠️ **`pointermove`／`up`／`cancel` 不可以寫回 inline**：手指滑出把手就收不到，門檻式判斷會半殘。
      - **命中區仍是 44×56，一格都不准縮**（防誤觸靠觸發條件，不是把鈕做小）；`☰` 換成 6 點 SVG 紋理（隔離量測：墨水 84→48px²、加權墨水 −54%），解掉「沿右緣重複成一條柱」——那正是 v2.7 在 `.map-btn` 修過的同一個病。
      - **行程分頁的 `dragStart`／`dragMove`／`dragEnd` 一行都不准動、也不准套門檻**：那邊的把手只在調整模式出現，本來就不會誤觸，套了只會變難拖。
  - **`ZONES` 的順序與字（🧳 行李／🎒 隨身）維持原樣沒有動**——demo 自己寫了一組（隨身在前、字也不同），但那是 demo 的樣板資料，不在拍板的六件事裡，改它會連帶動到模板編輯與新旅程。
- **`.gitattributes` 強制 md/js/css/html/json/yml 為 LF**；前後端 parser 開頭都先 `replace(/\r\n/g,'\n')`。壞的 JSON 行 parser 會跳過該行（不整檔炸掉）。（`.yml` 是 v2.5 補的：workflow 的 `run:` 區塊在 ubuntu bash 跑，CRLF 會變成 `$'\r': command not found`。）

## 圖示語言（v2.7，Benson 拍板；**這條界線別誤讀成「把 emoji 都換掉」**）
- **只有「系統給的功能鈕」用 inline SVG**（`app.js` 最上面的 `ICO`，吃 `currentColor`、每台裝置長得一樣）：
  - 行程點卡片右上的 `.map-btn`＝**折頁地圖 `ICO.pin`**（「這個地方在哪」），詳細 sheet 的 `.btn-ghost`「開啟 Google 地圖」與地址卡的 `.mp` 同一顆；
  - 移動灰條右邊的路線鈕＝**起點圓 → S 曲線 → 終點圓的一條彎路 `ICO.route`**（「從這裡到那裡怎麼走」）。
  - **兩顆的輪廓刻意差很多**（一張攤開的地圖／一條路），縮到 18px 也分得出來——**改圖前先確認這件事還成立**，做成兩顆很像的圖等於白做。
- **⛔ 內容型 emoji 一律不准動**：類別 emoji（`CATS[].emoji`）、旅程封面 emoji、tab bar、`.ao-ico`、詳細列前的 📍⏱️💰📞🔗🕘📝、`.empty .big`、**灰條左邊那顆 🚶（`.tr-ico`，Benson 拍板留 emoji）**。單色符號字元（`✕`／`☰`／`✎`／FAB 的 ＋）也保留（本來就跨裝置一致，換 SVG 零收益）。
  - 一句話規則：**使用者選的＝內容，留著；系統給的功能鈕＝介面，用 SVG。** 動了內容那排，整個 App 的個性就沒了。
- **樣式＝A 留白（v2.7 推翻 v2.6 的「B 淡珊瑚底」，Benson 看實機後拍板：「有點突兀」；別當誤改修回去）**：**底色整個拿掉**（`background:none`）、筆畫 1.8→1.6、顏色壓淡成中性灰（卡片 `#a89d8d`、灰條 `#9a9082`）、圖形 22→21px（灰條 19→18px）；只在 `:active` 給一層極淡的中性底（卡片 `#f4efe5`、灰條 `#e6dfd1`）當回饋。
  - **根因不是「有底色」**（`.cat-pill` 也有底色），而是**它借了藥丸的底色語言，把一個「工具」提到跟「內容」同一階**：44px 實心色塊是整張卡最大的元素、12px 圓角方塊塞進 16px 圓角的卡角像貼紙、38px 那顆等於整條灰條的高度、而且它是內容區唯一的珊瑚色沿右邊重複出現＝一條色點柱。**要改這裡先想「它是工具、不是內容」這條**，不是換一顆更好看的按鈕。（完整診斷見 `DESIGN.md` 附錄 B。）
  - 卡片那顆右緣 margin 改 `-11px`（原 -10px），讓圖形右緣落在卡片 14px 的 padding 線上、不再貼著圓角。
- **圖形＝「圓潤」這一組（v2.7）**：pin 是三折的折頁地圖、route 是**沒有箭頭**的彎路。箭頭是全站唯一的尖角（其他都是藥丸／圓角／圓點）所以拿掉；方向感靠兩端的起訖圓與 S 形補。順手解掉「同一張卡上兩顆針」（地點行本來就有內容型 📍）。
- **`.map-btn` 本體的尺寸一行都沒改**：卡片 44px、灰條視覺 38px＋`::before inset:-3px` 外擴回 44px、灰條總高仍是 38px（v2.4 決策照舊）。⚠️ **底色拿掉之後 `::before` 那條更不能刪**——看不見但要點得到。調整模式（`ui.edit`）一樣不顯示這兩顆鈕。

## 動效基調「沉穩」＋開場「印記」（v3.5，2026-08-28；接的是 `app-template/motion` 這一層，別誤改）
這一輪**只做四樣**：開場／按下回饋／sheet 離場／載入骨架屏。刻意不做的另外寫在最後。

- **檔案落點**（跟前兩支 App 不一樣，因為這支有 `public/` → `docs/` 鏡射）：
  - 會被瀏覽器載入的三支放 `public/motion/`：`motion.css`（**這支 App 自己寫的**）、`splash.css`、`splash.js`（後兩支是 `app-template/motion` 的**逐字複製品**）。
  - `tools/splash-boot.js` 是**唯一正本**、**不放 public/**：它已經逐字 inline 進 `index.html` 的柵欄，沒有人會 fetch 它，放進 `public/` 只會被鏡射到 Pages 變成死檔。改它要跑 `node tools/inline-boot.js public/index.html tools/splash-boot.js` 重貼，`tools/check-splash.js` 會用 SHA-256 比對，忘了重貼一定紅。
  - `sw.js` 的 `SHELL` 加了那三支（**`splash-boot.js` 刻意不加**）。
- **⚠️⚠️ `motion.css` 是「接」不是「抄」：一個顏色都不准有。** 範本那份自帶色票，而它的 `--bg / --card / --ink / --muted / --line / --acc / --shadow` 跟 `styles.css` **七個全部撞名**，整包抄進來會把米白配色蓋掉。骨架屏要底色時一律 `var(--line)`／`var(--card)`／`var(--muted)`（**引用**不是宣告）。`check-splash.js` 有一條「motion.css 零色碼」的斷言在守。
- **不用「白起」變體**（`data-splash-intro="light"`）：這支 App `--bg` / `theme-color` / `manifest.background_color` / `status-bar-style` **四處本來就一致而且都是淺色**（`#f7f4ee`），也沒有深色模式 ⇒ 前兩支深色 App 的「iOS 交接白閃」在這裡先天不存在。**`manifest`、`status-bar-style`、icon 一個字都沒動**（那三樣是加到主畫面當下抄走的，改了要 Benson 移除重加）。
- **開場外觀**：`glyph:"旅"`／`name:"旅途手帳"`／`bg #f7f4ee`(=`--bg`)／`accent #ff6b5e`(=`--acc`)／`ink #2b2620`(=`--ink`)，**沒有開任何新顏色**。`tagline` 有給值但**印記變體不顯示**（`.sp-tag{display:none}`）。符號字色由 `onColor()` 自動算（不是設定項）。鑰匙圈 appId＝`travel-book`。
- **⚠️⚠️ 載入中／載入失敗那張畫面的 class 已從 `.boot` 改名成 `.bootmsg`（`styles.css` ＋ `app.js` 的 `renderBootError`）。別改回去**：`splash.js` 收場時會把 class **`boot`** 掛到 `SPLASH_CONFIG.bootSelector`（＝`#app`）上、1.4 秒後才拿掉 ⇒ 舊名字會讓 `#app.boot` 命中 `.boot{display:flex;…}`，整個首頁在那 1.4 秒塌成一個置中的直排。
- **按下回饋寫成「結構式的全掃描」，不是白名單**（`motion.css` 第 2 段）：這支 App 的 HTML 是 `app.js` 用字串拼的、class 有一半是動態組的，任何靜態清單都會漏。所以判準是**形狀**：`#app`/`#sheet-layer` 底下的 `button`／`a`／`.tappable`／`label.pick`／`label.check-row` ＋ `#toast .t-act`。**新增可點元素不用回來改 CSS。** 例外三個（有理由，`tools/probe/press-scan.mjs` 有長度斷言）：`.backdrop`（遮罩不是按鈕）、`.pk-grip`／`.drag-handle`（自己有專屬回饋，而且按下去會一直拖，殘留縮放會跟著整段拖曳）。
  - 卡片裡的 `.map-btn`／`.tool-btn` 刻意用 `--press` 不用 `--press-lg`：`:active` 會傳到祖先，`.stop-card.tappable` 也在縮，兩層都 `.985` ＝ `.970`（幾乎看不出來），改成 `.96` 會變 `.946`＝像整張卡被捏了一把。
  - `styles.css` 原本那條 `.stop-card.tappable:active{transform:scale(.985)}` **已刪**：按下回饋現在只有 `motion.css` 一個來源，留兩份會在改 token 時分岔。
- **sheet 離場**（`closeSheet()`）：`.closing` 掛在 `#sheet-layer` 上跑 `tb-sheet-out`／`tb-fade-out`（**獨立的 `*-out` keyframes**），240ms 後由計時器硬關。**流程不准掛 `animationend`**。四層保險：① 離場動畫 `fill-mode:both`，終態＝關閉後的靜態值 ⇒ 計時器沒跑到也只是「留在 DOM 裡但看不見」；② `.closing` 期間整層 `pointer-events:none`；③ `openSheet()` 一開頭先 `sheetHardClose()`（連按與 `closeSheet();openXxx()` 這種就地換頁都不會被舊計時器清掉）；④ `setTimeout` 不依賴任何事件。
- **載入骨架屏**取代原本那顆 🧳（`renderBoot()`）：三張旅程卡形狀的骨架，**矩形與真 `.trip-card` 逐像素相同**（實測 x/y/w/h Δ=0），不然資料一到畫面會抽動。「網路好像有點慢」那句用 `animation-delay:8s` 帶出來，**不用 JS 計時器**（`render()` 換掉 `innerHTML` 時它自己消失，沒有要清的東西）。理由：GitHub 模式的 `loadAll` 是 **N+2 個請求**。
- **`prefers-reduced-motion` 是這支 App 的第一條**（`styles.css` 完全沒有），只把 token 歸零（1ms），元件規則一行不改；持續型的骨架呼吸另外關掉；「8 秒才說有點慢」是**時程不是動效**，刻意不歸零。
- **⛔ 這一輪刻意沒做（有理由，別當漏掉補上）**：**清單進場動畫**（`render()` 是整頁 `innerHTML` 重建、沒有 diff ⇒ 勾一個打包項就全部重播，比沒有更糟）、**「剛剛新增／刪除」的進退場**、**勾選劃線的過渡**（依賴節點存活，這個架構下跑不起來）。要做得先動 `render`，Benson 說之後單獨處理。
- **驗收工具**（都在 `tools/`，零相依、用本機 Chrome）：
  - `node tools/check-splash.js` — 靜態體檢（底色四處一致、載入順序、關鍵路徑 CSS、SHA 鎖鏈、onColor 全色域窮舉）。三個落地補丁寫在檔案裡（模組路徑／SHA 上游／色票那一節換成「motion.css 零顏色」）。
  - `node tools/probe/press-scan.mjs` — 真滑鼠壓 16 個畫面的**每一個**可點元素，量 computed transform；**有負控組**（把 `--press` 換成 none 必須翻紅）。⚠️ 例外名單裡的兩個把手**不可以壓**：它們掛 `onpointerdown`，探針「按下→游標移開→放開」對它們＝真的拖一次，會把整棵樹重繪、後面全部量成幽靈。
  - `node tools/probe/flows.mjs` — 冷／熱啟動、reduced-motion、四條降級路徑（CSS 遲到／CSS 全 404／splash.js 404／JS 停用）、sheet 開關（含連按與進場 40ms 就關）、骨架屏，**以及 G 段紅線**：載 `motion.css` 前後四個畫面 380 個元素的矩形必須逐一相同（實測 Δ=0.00px），`.drag-anim`／`.pk-grip .gv` 的既有 transition 沒被關掉、`.pk-card.is-dragging` 仍是 `visibility:hidden`。
  - ⚠️ 探針一律用 `tools/probe/fixture.mjs` 的假資料（自己起 server 假裝 `/api/data`），**一個位元組都不會碰 `data/`**；日期全部相對於今天算（寫死日期會讓「進行中／回憶」狀態跨日自己跑掉）。
  - ⚠️ 第一版 `motion.css` 寫過 `.stop.drag-anim{transition-property:none}`，那會把 timeline 讓位的過渡整條關掉（拖曳變瞬間跳位）。**現在只釘 `#pk-ghost` 一個**，別再加回去。

## PWA 鐵律（recipe-book 血淚，全部已做，別退步）
- 所有資源、manifest `start_url`/`scope`、SW scope **一律相對路徑**（Pages 在 `/travel-book/` 子路徑）。
- SW：`skipWaiting()`＋activate 清舊快取＋`clients.claim()`；`/api/data` network-first、寫入 network-only、殼 cache-first。
- ⚠️ **`keyring-unlock.js` 走 network-first，刻意不跟 app shell 一起 cache-first**（2026-08-21 加）：它的正本在 keyring repo、由 CI 自動同步過來，**更新時不會跳這裡的 cache 版本號**；若走 cache-first，手機會永遠停在第一次快取到的那一版，模組的修正永遠到不了使用者手上。它仍在 `SHELL` 預先快取，所以離線時一定拿得到快取、不會落到 `offlineJson()`。**別為了「統一策略」把它併回 app shell。****改前端記得把 sw.js 的 cache 版本號 +1**（`travel-shell-vN`，目前 **v25**；**版本號是「比已經上線的那個大」不是「比我開工時看到的大」**——v2.7 這輪就撞到：開工時檔案是 v15，做到一半另一條線先用掉 v16 並推上線了，只好跳 v17；**`SHELL_CACHE` 與 `DATA_CACHE` 兩個都要跳，別只跳一個**）**並同步 `APP_VER`**（見下方「版本與更新」）。
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
