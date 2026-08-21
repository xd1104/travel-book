# 旅途手帳（travel-planner）設計規格 v3

> lab-ux 產出，供 lab-dev 正式開發依據。demo 在 `demo/index.html`（單檔、零依賴、雙擊即玩）。
> **狀態：v2 已過 Benson，v3 加入三項新需求（營業時間選擇器／打包模板／首頁分區）；v3.1 依 Benson 回饋重設「已結束」區視覺（旅行回憶歸檔卡），待試玩確認。**

## 1. 產品定位

手機優先的旅遊行程規劃 app。一個旅程 = 逐日行程 + 花費 + 打包清單 + 自由備註。
架構預期沿用 recipe-book 三層：本機 Node App 為真本 + GitHub repo 同步 + GitHub Pages PWA 給手機。

## 2. 畫面清單與導覽結構

```
首頁
 ├─ 主區：進行中＋未出發的旅程卡（依出發日近→遠排序）
 ├─ ＋ 規劃新旅程（sheet；含「打包模板」選擇，預設不使用）
 ├─ 「已結束的旅程（N）」收合區：預設收起，展開後卡片灰階淡化（依日期自動判定，非手動標記）
 └─ 點卡片 → 旅程頁
旅程頁（漸層 header + 底部 4 tab）
 ├─ header 右上「✎ 編輯」→ 編輯旅程 sheet（帶入現值；無模板欄）
 ├─ 行程 tab：Day chips（sticky）→ timeline
 │   ├─ 行程點卡：時間 + 類別 + 名稱 + 地點 + 備註 + 🗺️ 地圖鈕
 │   ├─ 點卡片 → 詳細 sheet（只列有值欄位）→ ✎ 編輯（完整表單）
 │   ├─ 「調整」模式：✕ 刪除 + ☰ 拖曳把手
 │   └─ FAB ＋ → 新增行程點（精簡表單）
 ├─ 花費 tab：預算卡 → 分類小計 → 紀錄；FAB ＋ 記一筆
 ├─ 打包 tab：分區 segmented（🧳 行李托運 / 🎒 隨身）→ 快速新增列
 │   ├─ 「📦 從模板帶入」sheet：模板列表＋帶入（自動跳過同名項目）
 │   ├─ 「管理模板」sheet：列表＋編輯/刪除＋新增模板
 │   │    └─ 模板編輯 sheet：改名、分區新增項目、刪項目、儲存
 │   ├─ 清單全空時額外給大顆「從模板帶入一套」CTA
 │   └─ 兩分區各自標題＋已打包 x/y＋checklist
 └─ 備註 tab：整頁 textarea 自動儲存
```

## 3. 關鍵互動規格

### 3.1 行程點詳細頁（sheet）
- 檢視欄位（空值不顯示）：地點、預估費用、訂位/票券代號、電話（tel:）、官網/參考、營業時間、詳細備註。
- 編輯完整欄位：名稱*、時間、類別、地點、Google Maps 連結、預估費用、訂位/票券代號、聯絡電話、**營業時間（開/關兩個 time picker＋「24 小時營業」勾選）**、官網/參考連結、詳細備註。
- URL 欄 `type=text`+`inputmode=url`，讀取時自動補 https://。

### 3.2 營業時間（v3 改為選擇式）
- 結構化欄位：`hoursOpen`／`hoursClose`（原生 `<input type="time">`，iOS 跳系統轉輪）＋ `hours24`（checkbox，勾了即 disable 兩個 time 欄）。
- 顯示規則：`hours24` → 「24 小時營業」；有 open/close → 「10:00–22:30」（缺一邊補「？」）；都沒有 → 顯示舊自由文字 `hours`（**向下相容**）。
- 儲存規則：只要填了任何結構化值就清空舊 `hours`；表單開啟時若只有舊文字，顯示提示「原本記的文字：…選了時間就會取代它」。

### 3.3 Google Maps 跳轉
mapUrl 優先 → place 文字搜尋 fallback → 皆無不顯示；`target=_blank rel=noopener`；卡上按鈕 stopPropagation。

### 3.4 拖曳排序（調整模式）
純 pointer events、只把手 ☰ 可拖（`touch-action:none`）、被拖卡浮起＋其他卡平移讓位、pointercancel 復原。長清單邊緣自動捲動留正式版。

### 3.5 編輯旅程
共用新增表單（hidden editId）；縮短天數不刪資料（day-key 保留＋固定提示）；`ui.day` 超界 clamp。編輯模式**不顯示**打包模板欄（避免誤蓋既有清單，既有旅程套模板走打包 tab）。

### 3.6 打包分區與模板
- zone：`checked`（🧳 行李/托運)、`carry`（🎒 隨身）；segmented 決定新增目標區，記住本場選擇。
- **帶入模板**：把模板項目 append 進旅程打包清單，**同名（trim 後相等）項目自動跳過**，不動已勾狀態。
- **模板管理**：改名、分區增刪項目、新增自訂模板、刪除模板（刪除不影響已帶入的項目，會 confirm）。
- **新增旅程時**：表單「打包模板」select（預設「不使用」），建立時自動帶入。

### 3.7 首頁分區（自動、依日期）——v3.1 視覺重設
- 判定：`結束日（start + days - 1）< 今天` → 已結束；其餘（未出發＋進行中）在主區。
- 主區排序：出發日近的在前；已結束區：最近的在前。
- **已結束區＝「📔 旅行回憶」歸檔卡**（設計決策：已結束是回憶不是壞掉的現役卡，捨棄灰階大卡）：
  - 一張白卡容器：標題列（📔 旅行回憶＋數量 badge＋旋轉 chevron，min-height 56px）＋收合列表。
  - 每趟＝**精簡列表列**（min-height 60px）：42px 圓角 emoji 磚（沿用該旅程漸層色、`saturate(.85)` 微降彩度）＋名稱＋`YYYY/M/D・N 天`＋右側總花費＋`›`。跟主區大卡拉開層級，但保留每趟的顏色記憶。
  - 展開/收起動畫：列永遠在 DOM，外層 `grid-template-rows 0fr↔1fr` 過渡（0.28s）；toggle 就地切 class 不整頁重繪，chevron 同步旋轉；下次全頁 render 時 markup 依 `ui.showEnded` 重建、狀態一致。
  - 點列仍進完整旅程頁，內容不變。
- 空狀態：主區空但有已結束 → 「目前沒有進行中或即將出發的旅程」；全空 → 「還沒有任何旅程」。

## 4. 視覺語言（已定調）

暖米白底 `#f7f4ee`、珊瑚紅主色 `#ff6b5e`、圓角 14–20、軟陰影；每旅程一組漸層主題＋emoji；類別固定色；空狀態＝大 emoji＋一句人話＋CTA。

## 5. 資料模型草案（比照 recipe-book：md + frontmatter）

```
data/
  templates/<slug>.md          # 打包模板：frontmatter: name
                               # frontmatter list: items: [{text, zone}]  zone: carry|checked
  trips/<slug>/
    trip.md                    # frontmatter: name, dest, emoji, theme, start, days, budget
                               # body: 自由備註
    stops/<day>-<seq>-<slug>.md
        # frontmatter: day, order, time, title, cat, place,
        #              mapUrl, cost, bookingRef, phone, url,
        #              hoursOpen, hoursClose, hours24, hours(舊文字相容)
        # body: 詳細備註
    expenses.md                # frontmatter list: [{amount, cat, desc, date}]
    packing.md                 # frontmatter list: [{text, done, zone}]
```

- 模板是**全域資源**（跨旅程），一個模板一個 md 檔；「帶入」＝複製項目進該旅程 packing（複製後與模板脫鉤，改模板不回溯）。
- demo 對應：同構 JSON 存 localStorage `travel-demo-v3`；載入時自動遷移 `v2`/`v1`（packing 補 zone → carry；缺 templates → 補三個內建模板），不噴錯。
- 內建模板三款（可被使用者改/刪）：出國基本款（11 項）、國內小旅行（7 項）、海邊／溫泉（8 項），項目皆已分區。

## 6. 鐵律（recipe-book 踩過的雷，正式版必守）

1. 所有 input/textarea/select `font-size ≥ 16px`。
2. 所有資源相對路徑（Pages 子路徑）。
3. 觸控目標 ≥ 44px；底部固定列 safe-area padding。
4. Enter 送出用原生 `<form>` + `type=submit`。
5. PWA：SW skipWaiting＋清舊快取＋clients.claim；資料 network-first。
6. 手機端讀寫走帶 token 認證 API；寫入後樂觀更新。
7. 拖曳把手 `touch-action:none`、只把手可拖。
8. 資料 schema 演進一律「新 key＋讀舊 key 遷移」，遷移函式冪等。

## 7. demo 省略、正式版要做

- 三層架構：本機 Node App、git 同步、Pages PWA + PAT 設定頁。
- 內嵌地圖（現為 deep link）。
- 拖曳長清單邊緣自動捲動。
- 旅程刪除/封存；刪除防呆（undo/confirm）。
- 花費：日期、多幣別、按天檢視；行程點預估費用 vs 實際花費對照（加分項）。
- 模板進階：套用時預覽勾選要哪幾項、模板排序。
- AI 功能（接本機 claude）：生行程草稿、貼訂房信抽欄位。
- 資料匯出。

## 8. 拍板狀態

- A. 行程排序哲學 → **已定案：手動（拖曳）**。
- B. 花費綁天/行程點：仍開放。
- C. AI 功能優先級：仍開放（UX 推薦排 v2 之後）。
- 首頁已結束分區 → **已定案：依日期自動判定**（PM 已與 Benson 確認）。

---

# 附錄 A（v2.6 提案）— 地圖／路線圖示 ＋ 手機端地圖連結欄

> lab-ux 產出，供 lab-dev 照做。可試玩 demo：**`demo/icons-and-maplink.html`**（單檔、零依賴、雙擊開；`demo/index.html` 不動）。
> 狀態：**待 Benson 試玩拍板**。拍板前 dev 先不要動 `public/`。

## A1. 題目一：把 🗺️ emoji 換成 inline SVG

### A1.1 為什麼

`.map-btn` 目前是一顆 🗺️ emoji。這個 App 的視覺語言是暖米白＋珊瑚紅＋圓角＋軟陰影，emoji 是彩色點陣、風格不受控、**每支手機長得還不一樣**（iOS／Android／Windows 三套），而且同一顆圖示同時被用在「開這個地點的地圖」與「看這一段路線」兩個**不同的動作**上。

改用 **inline SVG**：吃 `currentColor`（顏色由 CSS 決定、跟色票一致）、每台裝置長得一樣、線條粗細可以跟 UI 的圓角軟調對齊、兩個動作可以用不同輪廓分開。

### A1.2 圖示界線（**這條寫給下一個接手的人，別把整個 App 的 emoji 都拔掉**）

| 類型 | 例子 | 處置 |
|---|---|---|
| **功能鈕上的 emoji**（可點、會觸發動作、有 `aria-label`） | `.map-btn` 的 🗺️、詳細 sheet `.btn-ghost` 的「🗺️ 開啟 Google 地圖」 | **換成 inline SVG** |
| **內容型 emoji**（是資料、是使用者自己選的、有語意） | 類別 emoji（`CATS[].emoji` 🍜📸🚗…）、旅程封面 emoji、tab bar、`.ao-ico`、詳細列前的 📍⏱️💰📞🔗🕘📝、`.empty .big` | **一律保留，不准動** |
| **單色符號字元**（不是彩色 emoji） | `.tool-btn` 的 ✕、`.drag-handle` 的 ☰、`✎`、FAB 的 ＋ | **保留**（本來就單色、跨裝置一致，換 SVG 沒有收益） |

一句話規則：**「使用者選的＝內容，留著；系統給的功能鈕＝介面，用 SVG。」**

### A1.3 兩顆圖示（最終 path，直接抄）

共同屬性：`viewBox="0 0 24 24"`、`fill:none`、`stroke:currentColor`、`stroke-linecap/linejoin:round`、`aria-hidden="true" focusable="false"`。

**① 地點 pin —「這個地方在哪」**（行程點卡片右上、詳細 sheet 的 `.btn-ghost`）

```html
<svg viewBox="0 0 24 24" class="ico" aria-hidden="true" focusable="false">
  <path d="M12 21.2c4.2-4.5 6.3-8 6.3-10.6a6.3 6.3 0 1 0-12.6 0c0 2.6 2.1 6.1 6.3 10.6Z"/>
  <circle cx="12" cy="10.4" r="2.4"/>
</svg>
```

**② 路線 —「從這裡到那裡怎麼走」**（移動灰條右邊）＝起點空心圓 ＋ 圓角轉彎 ＋ 箭頭

```html
<svg viewBox="0 0 24 24" class="ico" aria-hidden="true" focusable="false">
  <circle cx="6.2" cy="18.4" r="2.6"/>
  <path d="M6.2 15.8V11.4A3.4 3.4 0 0 1 9.6 8h7.3"/>
  <path d="M14.4 5.5 17.3 8l-2.9 2.5"/>
</svg>
```

輪廓刻意差很多（一顆水滴 vs 一條帶箭頭的折線），縮到 19px 也分得出來。

`aria-label` 一起改精準：
- 卡片那顆：`aria-label="在地圖上看這個地點"`（原本是「開啟地圖」）
- 灰條那顆：`aria-label="看這一段路線"`

### A1.4 CSS（加在 `styles.css` 的 `.map-btn` 那一段旁邊）

```css
/* v2.6：功能鈕圖示改 inline SVG（吃 currentColor，跨裝置一致） */
.map-btn .ico{width:22px; height:22px; display:block; fill:none; stroke:currentColor;
  stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round;}
.transit-bar .map-btn .ico{width:19px; height:19px; stroke-width:1.9;}
.btn-ghost .ico{width:19px; height:19px; fill:none; stroke:currentColor;
  stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round;}
```

`.map-btn` 本體的 `width/height/margin/border-radius` **一行都不改**（44px、灰條上 38px ＋ `::before inset:-3px` 外擴回 44px 的既有決策照舊）。`font-size:20px`／`17px` 已經沒有作用，可留可刪。

**顏色＝三個候選，等 Benson 拍板選一個**（demo 上可即時切）：

| | 卡片上的地點鈕 | 灰條上的路線鈕 | 個性 |
|---|---|---|---|
| **A 純線條** | `background:none; color:#a1968a`（`:active` `#f3eee4`） | `background:none; color:#9a9082` | 最安靜，不搶卡片 |
| **B 淡珊瑚底**（UX 推薦） | `background:#fff1ef; color:var(--acc-deep)`（`:active` `#ffe3df`） | `background:#fbeae7; color:var(--acc-deep)`（`:active` `#f6ddd8`） | 跟 `.count-chip`／`.cat-pill` 同一套 tinted pill 語言，最像「這裡可以點」 |
| **C 中性淺底** | `background:#f3eee4; color:#6b6154`（`:active` `#e9e1d2`） | `background:#e4ddcf; color:#6f6558`（`:active` `#d8cfbd`） | 跟 `.tool-btn`／`.drag-handle` 同家族 |

正式版只留選中那一組，**不要把 demo 的 `data-sty` 切換死碼帶進去**。

### A1.5 灰條左邊那顆 🚶（**選配，要 Benson 拍板**）

`.tr-ico` 現在寫死 `🚶`。換掉右邊的鈕之後，灰條上會變成「彩色 emoji ＋ 單色 SVG」並排，有點不搭。提案：`.tr-ico` 也改成**依 `travelMode(sp.note)` 自動選的線條圖示**（walking→人形／transit→列車／driving→車／bicycling→單車），沿用同一組 stroke 參數（15px、stroke-width 1.8、`color:#9c9284`、`opacity:1`）。demo 有開關可以直接比。

**這是加分項，不做也不影響題目一。** 不做就維持 🚶（它算內容型，不違反 A1.2）。

### A1.6 dev 檢查點

- [ ] `public/app.js` 三處 `🗺️` 全換（`grep -n "🗺️" public/app.js` 要回 0 行）
- [ ] 卡片鈕仍是 44×44、灰條鈕視覺 38px、命中區 `::before inset:-3px` 仍在 → **灰條總高度必須還是 38px**
- [ ] 調整模式（`ui.edit`）一樣不顯示這兩顆鈕
- [ ] 灰條那顆的 `onclick="event.stopPropagation()"` 保留（不能順手打開編輯移動表單）
- [ ] `sw.js` cache 版本號 ＋1、`APP_VER` 同步（PWA 鐵律）

---

## A2. 題目二：手機上換 Google 地圖連結

### A2.1 為什麼

現況是一顆普通 `<input>`，裡面躺著 `https://maps.app.goo.gl/9Yh2Kq7Tf1vRz8xA?g_st=ic`。Benson 的實際流程是**「Google Maps App 分享 → 複製連結 → 回 App 貼上」**，但他得先在手機上把那串長網址一個字一個字刪掉才貼得進去。而且那串網址**人根本看不懂**，佔了一整欄卻沒有資訊量。

v2.4 之後，server／CI 會把這條短連結展開成**地址**存進 `addr`。所以更根本的解法不是「讓網址好刪」，而是**畫面上根本不要顯示網址，顯示地址**——網址退成技術細節。

### A2.2 三個方案（demo 可即時切，等拍板）

| | 做法 | 換連結要幾個動作 | 成本 |
|---|---|---|---|
| **A 已連結卡 ＋ 一鍵貼上**（UX 推薦） | 欄位改成「顯示地址的卡片」＋「貼上新連結／✕ 清除」；貼上直接讀剪貼簿覆蓋 | **1 下**（剪貼簿已有連結時） | 中 |
| **B 欄內 ✕ 清空** | 維持 input，右側加 44px ✕；聚焦自動全選 | 2 下（✕ → 長按貼上） | 小 |
| **C 只做聚焦全選** | 只加 `onfocus` 全選，貼上直接覆蓋 | 2 下（點欄位 → 長按貼上），而且還是看得到醜網址 | 極小 |

**推薦 A**：同時解掉「難刪」與「看不懂」，而且把 v2.4 已經算出來的 `addr` 拿出來用（現在 `addr` 只有路線鈕在吃，使用者從來沒看過它）。B/C 的行為（全選、一鍵清）在 A 的「手動編輯」子狀態裡也保留著，不是丟掉。

### A2.3 方案 A 規格

欄位標題從「Google Maps 連結」改成 **「Google 地圖」**（顯示的是地址不是連結了）。三個狀態：

**狀態 1｜未連結（`!mapUrl`）**

```
Google 地圖
┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
   [貼上圖示] 貼上 Google 地圖連結      ← .m-empty，虛線框，min-height 52
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
沒有連結也沒關係，會用上面的「地點」文字去搜尋。   ← .hint
```

**狀態 2｜已連結且有 `addr`**

```
Google 地圖
┌────────────────────────────────┐
│ [pin] 504彰化縣秀水鄉義興街1號 秀水湯包 │  ← .maddr 15px/700，可換行
│       maps.app.goo.gl 連結           │  ← .msub 12px muted（只顯示 host）
└────────────────────────────────┘
[ 貼上新連結 ]            [ ✕ ]         ← .m-paste（flex:1, 46px）/ .m-clear（46×46）
手動編輯連結                             ← .m-manual，12.5px 底線小字，命中 44px
```

**狀態 3｜已連結但 `addr` 還沒補上**（剛貼上、或 server／CI 展不開的路線型連結）

- `.maddr` 顯示「**地址整理中…**」（`#8a8070`、weight 600）
- `.msub` 顯示「**存檔後由伺服器把連結換成地址**」
- 容器加 class `.pending`
- **文案刻意中性、不寫「失敗」**：Benson 幾乎只用手機，展開是 GitHub Actions 非同步做的，正常就是會有一段時間停在這；而且路線型短連結（`maps/dir/?geocode=`）本來就展不開（CLAUDE.md 已知缺口），不能讓它看起來像壞掉。

**「貼上新連結」的行為（核心）**

```
1. navigator.clipboard.readText()
2. 讀到且是 Google 地圖連結 → 直接覆蓋 mapUrl、清空 addr、回狀態 3、toast「已換成剛剛複製的連結」
3. 讀到但不是地圖連結／剪貼簿空／readText 被拒或不支援
   → 展開手動輸入子狀態（input 帶現值、focus 並整串選取），toast 說明原因
```

- 連結判定：`/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)/i`
- 貼到跟現值一模一樣 → 不動資料、toast「跟現在這條一樣，沒有換」（避免白白清掉 addr 再重展開一次）
- **`readText()` 一定要有 fallback**：iOS Safari 會跳系統的「貼上」確認、使用者可能不點；非安全脈絡直接 reject。**沒有 fallback ＝ 這個功能在他手機上有機率整個不能用。**

**手動輸入子狀態**

```
[ https://maps.app.goo.gl/9Yh2…  ] [ 完成 ]   ← input 16px + .m-done 46px
整串已經幫你選起來了，直接長按貼上就會蓋掉舊的。
```

- 進來時 `el.focus(); el.setSelectionRange(0, el.value.length);`
- **iOS 用 `setSelectionRange` 不要用 `select()`**，而且要在 user gesture（按鈕點擊）的同一個 tick 內做，包 `try/catch`
- 按「完成」收回顯示態；值有變就清 `addr`

### A2.4 資料規則（**dev 必守，這幾條錯了會沉默壞掉**）

1. **`mapUrl` 一有變動（含清空）就把 `addr` 設成 `""`**。`addr` 是 `mapUrl` 的衍生值，留著舊地址＝路線鈕會用錯的起訖點。
   現有 `submitStopEdit` 已經有這行（`if(newMap !== String(sp.mapUrl||"")) sp.addr = "";`）——改成即時操作後，**清 addr 的時機要往前移到「按下貼上／✕ 的當下」**，不能只留在 submit。
2. **✕ 清除 ＝ `mapUrl=""` ＋ `addr=""` 兩個都清。**
3. **前端永遠不自己寫 `addr`**（展開只有 server／CI 做得到）。UI 只負責顯示與清空。
4. `transit`（移動）**一個欄位都不准加**——路線連結仍是前端即時算的、不落資料（CLAUDE.md 決策沒變）。這一節只動 stop 的編輯表單。
5. 「新增行程點」表單（`app.js` 約 L1625）用**同一個元件**，開場就是狀態 1。**不要複製第二份 UI。**

### A2.5 CSS 新 class（照 demo 抄；全部用既有色票）

`.mapf` `.mlink`（`.mp`／`.mb`／`.maddr`／`.msub`／`.pending`）`.mlink-acts` `.m-paste` `.m-clear` `.m-manual` `.m-empty` `.m-edit` `.m-done`

要點：

- `.mlink` 用 `.field input` 同一套外觀（`#fbfaf6` 底、`1.5px solid var(--line)`、`border-radius:13px`），看起來還是同一張表單裡的東西
- `.m-paste` ＝ `#fff1ef` 底 ＋ `var(--acc-deep)` 字（跟 A1.4 樣式 B 同一套 tinted 語言）
- **所有按鈕 ≥ 44px**（`.m-paste`／`.m-clear` 用 46px、`.m-manual` 靠 `min-height:44px` 撐開）
- **`.m-edit input` `font-size:16px`**（iOS 鐵律，不准降）
- 貼上圖示（`.m-paste`／`.m-empty` 內）用同一組 stroke 參數的 SVG，path 見 demo 的 `ICO.paste`

### A2.6 dev 檢查點

- [ ] 換連結（剪貼簿有連結時）**1 下**完成
- [ ] `readText` 被拒／不支援 → 自動退回手動輸入，**不會卡死**
- [ ] ✕ 之後 `mapUrl` 與 `addr` 都是空的（存檔後看 md 檔驗證）
- [ ] 貼上新連結後畫面立刻進「地址整理中…」，存檔 → CI 跑完 → 重整後顯示新地址
- [ ] `transit` 的 md 輸出仍然只有 `{id,type,note,stayMinutes}`
- [ ] 新增／編輯兩個入口共用同一個元件
- [ ] `sw.js` cache 版本號 ＋1、`APP_VER` 同步

---

## A3. 要 Benson 拍板的

1. **圖示配色**：A 純線條／**B 淡珊瑚底（UX 推薦）**／C 中性淺底。
2. **灰條左邊那顆 🚶 要不要一起換成線條圖示（依交通方式自動）**：UX 建議換，一致性較好；不換也可以，它算內容。
3. **連結欄方案**：**A 已連結卡＋一鍵貼上（UX 推薦）**／B 欄內 ✕／C 只做聚焦全選。
