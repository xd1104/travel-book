# 旅途手帳（travel-planner）設計規格 v2

> lab-ux 產出，供 lab-dev 正式開發依據。demo 在 `demo/index.html`（單檔、零依賴、雙擊即玩）。
> **狀態：v1 方向已過 Benson，v2 加入他提出的 5 項需求，待二次試玩確認。**

## 1. 產品定位

手機優先的旅遊行程規劃 app。一個旅程 = 逐日行程 + 花費 + 打包清單 + 自由備註。
架構預期沿用 recipe-book 三層：本機 Node App 為真本 + GitHub repo 同步 + GitHub Pages PWA 給手機。

## 2. 畫面清單與導覽結構

```
首頁（旅程列表）
 ├─ 旅程卡片（漸層封面 + emoji + 名稱 + 日期範圍 + 倒數/進行中/已結束 chip）
 ├─ ＋ 規劃新旅程（bottom sheet 表單）
 └─ 點卡片 → 旅程頁
旅程頁（漸層 header + 底部 4 tab）
 ├─ header 右上「✎ 編輯」→ 編輯旅程 sheet（與新增同表單、帶入現值）
 ├─ 行程 tab（預設）：Day 橫向 chips（sticky）→ 當日 timeline
 │   ├─ 行程點卡：時間 + 類別 pill + 名稱 + 地點 + 備註 + 右上 🗺️ 地圖按鈕
 │   ├─ 點卡片 → 行程點詳細 sheet（檢視，只列有值欄位）→「✎ 編輯」→ 完整編輯表單
 │   ├─ 「調整」模式：卡片右上換成 ✕ 刪除 + ☰ 拖曳把手（按住把手拖動排序）
 │   └─ FAB ＋ → 新增行程點 sheet（精簡：時間/類別/名稱*/地點/備註；細節進詳細頁補）
 ├─ 花費 tab：預算卡（已花費大字 + 進度條 + 剩餘/超支）→ 分類小計 chips → 紀錄列表
 │   └─ FAB ＋ → 記一筆 sheet（金額*/類別/說明）
 ├─ 打包 tab：分區 segmented（🧳 行李托運 / 🎒 隨身）+ 快速新增列（加到目前選的區）
 │   └─ 兩個分區各自有標題 + 已打包 x/y + checklist
 └─ 備註 tab：整頁 textarea，自動儲存（debounce 400ms + 「已儲存 ✓」提示）
```

所有新增/編輯一律用 **bottom sheet**（不跳頁），backdrop 點擊關閉。

## 3. 關鍵互動規格

### 3.1 行程點詳細頁（sheet）
- 檢視模式欄位（**空值不顯示**，收乾淨）：地點、預估費用、訂位/票券代號（code 樣式）、電話（`tel:` 連結，href 先去除非數字/+）、官網/參考連結（新分頁開）、營業時間、詳細備註。
- 全空時顯示「還沒有詳細資訊，點『編輯』補上」。
- 底部：🗺️ 開啟 Google 地圖（ghost 按鈕，條件見 3.2）＋ ✎ 編輯（primary）。
- 編輯表單完整欄位：名稱*、時間、類別、地點、Google Maps 連結、預估費用、訂位/票券代號、聯絡電話、營業時間（單行）、官網/參考連結、詳細備註（多行）。
- URL 欄位用 `type=text` + `inputmode=url`（`type=url` 會因沒打 https:// 擋送出，太煩）；讀取時無 scheme 自動補 `https://`。

### 3.2 Google Maps 跳轉（timeline 卡與詳細頁共用邏輯）
```
mapUrl 有填 → 開 mapUrl（自動補 scheme）
否則 place 有填 → 開 https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(place)>
兩者皆無 → 不顯示按鈕
```
一律 `target="_blank" rel="noopener"`；卡片上的按鈕要 `stopPropagation`（避免觸發開詳細頁）。

### 3.3 拖曳排序（調整模式）
- 純 pointer events 自製，零依賴；**只有把手 ☰ 可拖**（把手 `touch-action:none`），卡片其他區域保留給頁面捲動。
- 視覺回饋：被拖卡片浮起（大陰影、把手變主色）、其他卡片用 transform 平移讓出落點（transition .18s）。
- 演算法：記各卡原始中心點；拖曳中被拖卡中心與其他卡原始中心比較算插入位；放開時 splice 重排 + 存檔 + 重繪。
- `pointercancel` 要復原（iOS 來電/手勢中斷）。demo 未做「拖到畫面邊緣自動捲動」，正式版清單長時要補。

### 3.4 編輯旅程
- 與新增共用表單（hidden `editId` 區分），帶入現值；emoji 不在預設清單時動態插入選項。
- **縮短天數不刪資料**：`itinerary` 以 day 為 key，天數改小只是不顯示；表單內固定提示「縮短天數不會刪掉行程點，把天數改回來就會再出現」。`ui.day` 超界時 clamp 到最後一天。

### 3.5 打包分區
- zone：`checked`（🧳 行李/托運）、`carry`（🎒 隨身）。
- segmented 控制「新增到哪區」，記住本次工作階段的選擇（預設隨身）；輸入框 placeholder 隨區變。
- 切區時保留輸入框未送出的文字。

## 4. 視覺語言（已定調，正式版沿用）

- 底色暖米白 `#f7f4ee`、卡片白、主色珊瑚紅 `#ff6b5e`、圓角 14–20px、軟陰影。
- 每個旅程一組漸層封面主題（sunset/ocean/night/forest/sand）+ 封面 emoji；旅程頁 header 沿用同漸層。
- 行程點類別（景點/美食/交通/住宿/購物/其他）固定色 + emoji，timeline 圓點同色。
- 空狀態一律「大 emoji + 一句人話 + CTA」。

## 5. 資料模型草案（比照 recipe-book：md + frontmatter）

```
data/trips/<slug>/
  trip.md            # frontmatter: name, dest, emoji, theme, start, days, budget
                     # body: 自由備註（備註 tab 直接讀寫 body）
  stops/<day>-<seq>-<slug>.md
      # frontmatter: day, order, time, title, cat, place,
      #              mapUrl, cost, bookingRef, phone, url, hours
      # body: 詳細備註
  expenses.md        # frontmatter list: [{amount, cat, desc, date}]（小額高頻，一檔集中）
  packing.md         # frontmatter list: [{text, done, zone}]  zone: carry|checked
```

取捨：stops 拆檔（編輯熱區、欄位多、單檔寫入減衝突）；expenses/packing 整檔覆寫（同 recipe-book `-X ours` 策略）。
demo 對應：同構 JSON 存 localStorage `travel-demo-v2`；**載入時自動遷移 v1**（packing 無 zone → 歸 carry），欄位名即 schema 參考。

## 6. 鐵律（recipe-book 踩過的雷，正式版必守）

1. 所有 input/textarea/select `font-size ≥ 16px`（iOS Safari 自動 zoom 雷）。
2. 所有資源**相對路徑**（Pages 子路徑 `/repo/`）。
3. 觸控目標 ≥ 44px；底部固定列 `padding-bottom: env(safe-area-inset-bottom)`。
4. Enter 送出一律原生 `<form>` + `type=submit`（IME 組字安全）。
5. PWA：SW `skipWaiting` + 清舊快取 + `clients.claim`；資料 network-first。
6. 手機端讀寫走**帶 token 的認證 API**（匿名 contents API 有嚴重快取）；寫入後樂觀更新。
7. 拖曳把手 `touch-action:none`、只把手可拖，不跟捲動手勢打架。

## 7. demo 省略、正式版要做

- 三層架構：本機 Node App、git 同步、Pages PWA + PAT 設定頁。
- 內嵌地圖（目前是 deep link 跳出去，之後再評估要不要 API key 版）。
- 拖曳清單過長時的邊緣自動捲動；長按整卡拖曳（現在只有調整模式 + 把手）。
- 旅程刪除/封存；刪除防呆（undo 或 confirm）。
- 花費：日期欄位、多幣別/匯率、按天檢視；行程點「預估費用」與花費帳的關聯（見 8-B）。
- 打包清單範本（出國常用/溫泉/露營…一鍵套入）。
- AI 功能（接本機 claude，零 API 費）：生行程草稿、貼訂房確認信自動抽欄位。
- 資料匯出。

## 8. 拍板狀態

- ~~A. 行程排序哲學~~ → **已定案：手動排序**（Benson 指定改拖曳，時間只是標籤不影響順序）。
- B. 花費要不要綁到天/行程點：仍開放。備註：行程點現在有「預估費用」欄，正式版可考慮「預估 vs 實際」對照，屬加分項。
- C. AI 功能優先級：仍開放。UX 維持推薦 AI 排 v2。
