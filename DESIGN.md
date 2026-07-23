# 旅途手帳（travel-planner）設計規格 v1

> lab-ux 產出，供 lab-dev 正式開發依據。demo 在 `demo/index.html`（單檔、零依賴、雙擊即玩）。
> **狀態：待 Benson 試玩拍板**。拍板後由 PM 更新「定案」段落再開工。

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
 ├─ 行程 tab（預設）：Day 橫向 chips（sticky）→ 當日 timeline
 │   ├─ 行程點卡：時間 + 類別 pill + 名稱 + 地點 + 備註
 │   ├─ 「調整」模式切換：顯示 上移/下移/刪除（預設隱藏保持乾淨）
 │   └─ FAB ＋ → 新增行程點 sheet（時間/類別/名稱*/地點/備註）
 ├─ 花費 tab：預算卡（已花費大字 + 進度條 + 剩餘/超支）→ 分類小計 chips → 紀錄列表
 │   └─ FAB ＋ → 記一筆 sheet（金額*/類別/說明）
 ├─ 打包 tab：進度（x/y）+ 頂部快速新增列（原生 form，Enter 可送）+ checklist
 └─ 備註 tab：整頁 textarea，自動儲存（debounce 400ms + 「已儲存 ✓」提示）
```

所有新增/編輯一律用 **bottom sheet**（不跳頁），backdrop 點擊關閉。

## 3. 視覺語言（demo 已定調，正式版沿用）

- 底色暖米白 `#f7f4ee`、卡片白、主色珊瑚紅 `#ff6b5e`、圓角 14–20px、軟陰影。
- 每個旅程一組**漸層封面主題**（sunset/ocean/night/forest/sand）+ 封面 emoji，旅程頁 header 沿用同漸層 → 每趟旅行有自己的顏色記憶。
- 行程點類別（景點/美食/交通/住宿/購物/其他）各有固定色 + emoji，timeline 圓點同色。
- 空狀態一律「大 emoji + 一句人話 + CTA 按鈕」，不留白頁。

## 4. 資料模型草案（比照 recipe-book：md + frontmatter）

一個旅程一個資料夾；**行程點一筆一檔**（方便手機端走 GitHub Contents API 單檔寫入、減少衝突）：

```
data/trips/<slug>/
  trip.md            # frontmatter: name, dest, emoji, theme, start, days, budget
                     # body: 自由備註（備註 tab 直接讀寫 body）
  stops/<day>-<seq>-<slug>.md   # frontmatter: day, order, time, title, cat, place
                                # body: 備註
  expenses.md        # frontmatter list: [{amount, cat, desc, date}]（小額高頻，一檔集中）
  packing.md         # frontmatter list: [{text, done}]
```

取捨說明：stops 拆檔是因為它是編輯熱區、單筆內容多；expenses/packing 單筆極小、整檔覆寫衝突風險低（同 recipe-book `-X ours` 策略）。dev 若覺得 expenses 也要拆檔可提回 PM。

demo 對應：以上結構在 demo 中是一個 JSON（localStorage key `travel-demo-v1`），欄位名已對齊，可直接當 schema 參考。

## 5. 鐵律（recipe-book 踩過的雷，正式版必守）

1. 所有 input/textarea/select `font-size ≥ 16px`（iOS Safari 自動 zoom 雷）。
2. 所有資源**相對路徑**（Pages 子路徑 `/repo/`）。
3. 觸控目標 ≥ 44px；底部固定列 `padding-bottom: env(safe-area-inset-bottom)`。
4. Enter 送出一律原生 `<form>` + `type=submit`（IME 組字安全）。
5. PWA：SW `skipWaiting` + 清舊快取 + `clients.claim`；資料 network-first。
6. 手機端讀寫走**帶 token 的認證 API**（匿名 contents API 有嚴重快取）；寫入後樂觀更新。

## 6. demo 省略、正式版要做

- **地圖**：demo 只有「地點」文字欄。正式版可在行程點加「在 Google Maps 開啟」deep link（`https://www.google.com/maps/search/?api=1&query=...`，免 API key），之後再評估內嵌地圖。
- 三層架構：本機 Node App、git 同步、Pages PWA + PAT 設定頁。
- 行程點**編輯**（demo 只能新增/排序/刪除）、拖曳排序（demo 用上移/下移，正式版可加 long-press 拖曳）。
- 旅程本身的編輯/刪除/封存。
- 花費：日期欄位、多幣別/匯率、按天檢視。
- 打包清單範本（出國常用/溫泉/露營…一鍵套入）。
- AI 功能（接本機 claude 當大腦，零 API 費）：丟「我要去大阪 4 天」自動長出行程草稿、備註貼上訂房確認信自動抽欄位。優先級待 Benson 排。
- 刪除防呆（undo 或 confirm）、資料匯出。

## 7. 待 Benson 拍板的方向題

A. **行程排序哲學**：維持「手動排序」（現況，時間只是標籤）vs「照時間自動排序」。UX 推薦手動——旅行常有「還沒決定幾點」的點。
B. **花費要不要綁到天/行程點**：現況整趟一鍋記（最省力）。若 Benson 想看「每天花多少」再加 day 欄位。UX 推薦先一鍋，玩過再說。
C. **AI 功能的優先級**：v1 就上「AI 生行程草稿」，或先把三層架構做穩、AI 排 v2。UX 推薦 AI 排 v2。
