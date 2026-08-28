/* fixture.mjs — 探針專用的假資料（GET /api/data 的回應）
   ------------------------------------------------------------
   ⚠️⚠️ 為什麼不用 Benson 的真資料：探針會在頁面上到處按，
      指到真的 server.js（port 3618）等於拿他每天在用的旅程當測試場。
      這裡自建一份，**一個位元組都不會碰 data/**。

   ⚠️ 日期一律**相對於現在**算（手冊：「測試資料裡的『現在』是定時炸彈」）：
      寫死日期的話跨過那天以後「進行中／未出發／回憶」三種狀態會自己跑掉，
      症狀長得像 App 壞了。這裡固定產出「一趟明天出發的（進行中區）
      ＋ 一趟去年結束的（旅行回憶區）」，任何一天跑都一樣。

   涵蓋到的畫面：首頁（旅程卡／回憶列／footer）、行程（站點／移動／調整模式）、
   花費（分組／整列開編輯／✕）、打包（區／包／包內物品／就地新增）、備註。
*/
function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function shift(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return iso(d);
}

export function fixture() {
  return {
    categories: [
      { id: "sight", label: "景點", emoji: "📍", color: "#0d9488" },
      { id: "food", label: "美食", emoji: "🍜", color: "#ea8600" },
      { id: "transport", label: "交通", emoji: "🚃", color: "#2f6fed" },
      { id: "stay", label: "住宿", emoji: "🏨", color: "#8b5cf6" },
      { id: "shop", label: "購物", emoji: "🛍️", color: "#e0447f" },
      { id: "other", label: "其他", emoji: "✨", color: "#7a7265" }
    ],
    templates: [
      { id: "tpl-probe", name: "測試模板", items: [
        { text: "護照", zone: "carry" },
        { text: "盥洗包", zone: "checked", kind: "bag" },
        { text: "牙刷", zone: "checked", bag: "盥洗包" }
      ] }
    ],
    trips: [
      {
        id: "probe-a-明天出發", name: "北海道賞雪", dest: "札幌・小樽", emoji: "🗻",
        theme: "sunset", start: shift(1), days: 3, budget: 60000,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        itinerary: {
          "1": [
            { id: "s1", title: "新千歲機場", time: "09:20", cat: "transport", place: "北海道千歲市",
              note: "領行李、換錢", stayMinutes: 60,
              mapUrl: "https://maps.app.goo.gl/probe1", addr: "北海道千歳市美々987-22" },
            { id: "t1", type: "transit", note: "JR 快速 Airport 到札幌", stayMinutes: 40 },
            { id: "s2", title: "湯咖哩 GARAKU", time: "12:00", cat: "food", place: "札幌市中央區",
              note: "排隊名店", cost: 1800, stayMinutes: 90,
              mapUrl: "https://maps.app.goo.gl/probe2", addr: "札幌市中央区南3条西2丁目" },
            { id: "s3", title: "狸小路", time: "14:30", cat: "shop", place: "札幌", stayMinutes: 120 }
          ],
          "2": [
            { id: "s4", title: "小樽運河", time: "10:00", cat: "sight", place: "小樽市", stayMinutes: 120 }
          ],
          "3": []
        },
        expenses: [
          { id: "e1", amount: 18500, cat: "transport", desc: "來回機票", day: "pre" },
          { id: "e2", amount: 1800, cat: "food", desc: "湯咖哩", day: 1 },
          { id: "e3", amount: 620, cat: "shop", desc: "藥妝", day: 1 },
          { id: "e4", amount: 300, cat: "other", desc: "投幣置物櫃" }
        ],
        packing: [
          { id: "p1", text: "護照", done: true, zone: "carry" },
          { id: "p2", text: "行動電源", done: false, zone: "carry" },
          { id: "p3", text: "盥洗包", done: false, zone: "checked", kind: "bag" },
          { id: "p4", text: "牙刷", done: true, zone: "checked", bag: "p3" },
          { id: "p5", text: "洗面乳", done: false, zone: "checked", bag: "p3" },
          { id: "p6", text: "發熱衣", done: false, zone: "checked" }
        ],
        notes: "雪季記得帶防滑鞋套。\n租車要國際駕照正本。"
      },
      {
        id: "probe-b-去年", name: "沖繩跳島", dest: "那霸", emoji: "🏝️",
        theme: "ocean", start: shift(-400), days: 4, budget: 40000,
        createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
        itinerary: { "1": [{ id: "s9", title: "國際通", time: "16:00", cat: "shop" }] },
        expenses: [{ id: "e9", amount: 12000, cat: "stay", desc: "民宿", day: "pre" }],
        packing: [{ id: "p9", text: "泳褲", done: true, zone: "checked" }],
        notes: ""
      }
    ]
  };
}
