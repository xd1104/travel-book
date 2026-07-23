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
