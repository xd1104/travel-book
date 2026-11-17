'use strict';
/*
 * tools/split-test.js — 旅伴分帳（v3.19，DESIGN.md 附錄 G）的零相依測試。
 *   用法：node tools/split-test.js            （全部過 exit 0；有任何一條沒過 exit 1）
 *
 * 測什麼：
 *   A. 真實旅程 round-trip：data/trips/*.md 每一份，前端 parse→serialize、後端 parse→serialize 都要逐字等於原檔，
 *      而且前後端輸出彼此逐字相同。⚠️ 只讀不寫，一個位元組都不碰 data/。
 *   B. 新欄位前後端逐字對照：一組邊界 case（壞參照、split+shares 並存、外幣小數、id 重複…）兩邊 serialize 必須相同，
 *      且 parse→serialize 冪等（第二輪跟第一輪逐字相同）。
 *   C. 分帳計算（純函式）：每筆 Σ各人份＝amount、全員差額 Σ＝0、照轉帳清單轉完全員歸零、
 *      最少轉帳精確解（＋負控組：純貪婪要多一筆，測不出差異＝尺壞了）、小孩份額轉給指定大人、
 *      各填金額不符不能存、預計不算進結算除非試算、已轉紀錄扣得掉也撤得回、可能重複的判斷條件。
 *   D. 隨機壓力：1,000 趟亂數旅程，C 的三條恆等式全部成立。
 *
 * 怎麼拿到前端的函式：app.js 是瀏覽器腳本（碰 DOM），不能直接 require。這裡把兩段「本來就不碰 DOM」的原始碼
 * 原樣切出來丟進 vm：① 「md 序列化」那一段（到 b64EncodeUtf8 之前）② 「分帳核心 BEGIN … END」。
 * 改 app.js 時別把這兩個標記刪掉，不然這支會直接報「找不到標記」。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.AUTO_SYNC = '0';                       // 一定要在 require server.js 之前（它載入當下就讀）
const ROOT = path.join(__dirname, '..');
const SV = require(path.join(ROOT, 'server.js'));

/* ---------- 把前端兩段切出來 ---------- */
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + 1);
  if (i < 0 || j < 0) throw new Error('app.js 找不到標記：' + (i < 0 ? a : b));
  return src.slice(i, j);
}
const serSrc = slice(appSrc, '/* ============ md 序列化', 'function b64EncodeUtf8');
const coreSrc = slice(appSrc, '/* ==== 分帳核心 BEGIN', '/* ==== 分帳核心 END');
const FE = vm.createContext({});
vm.runInContext(serSrc + '\n' + coreSrc, FE, { filename: 'app.js(切片)' });

/* ---------- 小測試框架 ---------- */
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; return true; }
  fail++; console.log('  ✗ ' + name + (detail !== undefined ? '  →  ' + detail : ''));
  return false;
}
function eq(a, b, name) { return ok(a === b, name, JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }
function section(t) { console.log('\n■ ' + t); }
const clone = (x) => JSON.parse(JSON.stringify(x));

/* =====================================================================
   A. 真實旅程 round-trip（只讀）
   ===================================================================== */
section('A. 真實旅程 parse→serialize 逐字不變（前端／後端／兩邊互比）');
const tripDir = path.join(ROOT, 'data', 'trips');
const files = fs.existsSync(tripDir) ? fs.readdirSync(tripDir).filter((f) => f.endsWith('.md')) : [];
ok(files.length > 0, '找得到 data/trips/*.md', files.length);
for (const f of files) {
  const raw = fs.readFileSync(path.join(tripDir, f), 'utf8').replace(/\r\n/g, '\n');
  const id = f.replace(/\.md$/, '');
  const fe = FE.serializeTrip(FE.parseTrip(id, raw));
  const be = SV.serializeTrip(SV.parseTrip(id, raw));
  eq(fe, raw, f + '：前端逐字不變');
  eq(be, raw, f + '：後端逐字不變');
  eq(fe, be, f + '：前後端輸出相同');
  /* 真實資料已經有設過旅伴的旅程（他開始用了），只有原檔沒有 mates 的才驗「不多長行」 */
  if (!/^mates:/m.test(raw)) {
    ok(!/^mates:|^settle:/m.test(fe), f + '：沒有旅伴 ⇒ 不多 mates／settle 行');
    const p = FE.parseTrip(id, raw);
    ok(Array.isArray(p.mates) && !p.mates.length && Array.isArray(p.settle) && !p.settle.length, f + '：parse 出 mates/settle 空陣列');
  }
}
console.log('  （' + files.length + ' 份真實旅程）');

/* =====================================================================
   B. 新欄位：前後端逐字對照＋冪等
   ===================================================================== */
section('B. 新欄位前後端逐字對照（邊界 case）');
const BASE = { name: '測試', dest: '大阪', emoji: '⛩️', theme: 'sunset', start: '2027-11-27', days: 8, budget: 150000,
  createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z', itinerary: {}, packing: [], notes: '' };
const MATES = [{ id: 'ma', name: '黏' }, { id: 'mb', name: '肚' }, { id: 'mc', name: '媽媽' }, { id: 'mk', name: '小寶', kid: true, to: ['ma', 'mb'] }];
const cases = [
  ['沒旅伴的花費（舊格式）', { mates: [], expenses: [{ id: 'e1', amount: 100, cat: 'food', desc: 'a' }] }],
  ['完整四欄', { mates: MATES, settle: [{ from: 'mc', to: 'ma', amount: 11462, at: '2026-11-16' }], expenses: [
    { id: 'e1', amount: 38400, cat: 'transport', desc: '機票', day: 'pre', payer: 'ma' },
    { id: 'e3', amount: 6837, cat: 'ticket', desc: '環球', day: 'pre', fx: 31800, card: true, payer: 'ma', shares: { ma: 8600, mb: 8600, mc: 8600, mk: 6000 } },
    { id: 'e6', amount: 1376, cat: 'food', desc: '黑門', day: 2, fx: 6400, payer: 'mb', split: ['ma', 'mb'] },
    { id: 'e8', amount: 258, cat: 'food', desc: '章魚燒', day: 3, fx: 1200, payer: 'mb', kidTo: { mk: ['mc'] } },
    { id: 'e9', amount: 1806, cat: 'transport', desc: 'JR', day: 4, fx: 8400, plan: true, payer: 'ma' }] }],
  ['split 與 shares 並存 ⇒ 留 shares', { mates: MATES, expenses: [{ id: 'x', amount: 300, cat: 'food', desc: '', payer: 'ma', split: ['ma'], shares: { ma: 100, mb: 200 } }] }],
  ['壞參照：payer 對不到／split 有幽靈 id／shares 全幽靈／kidTo 指向小孩', { mates: MATES, expenses: [
    { id: 'x1', amount: 300, cat: 'food', desc: '', payer: 'ghost', split: ['ghost', 'mb', 'ma'] },
    { id: 'x2', amount: 300, cat: 'food', desc: '', payer: 'mk', shares: { ghost: 300 } },
    { id: 'x3', amount: 300, cat: 'food', desc: '', payer: 'ma', kidTo: { mk: ['mk', 'ghost'], ma: ['mb'] } }] }],
  ['外幣小數 shares（HK$12.5）＋收到 0.01＋負數丟掉', { mates: MATES, expenses: [
    { id: 'h', amount: 104, cat: 'food', desc: '', fx: 25, payer: 'mb', shares: { ma: 12.5, mb: 12.504, mc: -3, mk: 0 } }] }],
  ['旅伴：id 重複、沒名字、小孩 to 指向不存在／小孩、名字前後空白', { mates: [
    { id: 'a', name: ' 黏 ' }, { id: 'a', name: '重複' }, { id: 'b', name: '' }, { id: 'c', name: '肚' },
    { id: 'k', name: '寶', kid: true, to: ['ghost', 'k', 'c', 'c'] }, { id: 'k2', name: '寶2', kid: true, to: ['ghost'] }], expenses: [] }],
  ['settle：金額 0／自己轉自己／幽靈 id 丟掉；金額取整', { mates: MATES, settle: [
    { from: 'ma', to: 'mb', amount: 0, at: '2026-11-16' }, { from: 'ma', to: 'ma', amount: 5, at: '' },
    { from: 'ghost', to: 'mb', amount: 5, at: '' }, { from: 'mc', to: 'mb', amount: 99.6, at: '2026-11-17' }], expenses: [] }],
  ['沒旅伴但花費帶分帳欄位 ⇒ 原樣保留（不無聲丟掉）', { mates: [], settle: [{ from: 'ma', to: 'mb', amount: 5, at: '2026-11-16' }],
    expenses: [{ id: 'z', amount: 50, cat: 'food', desc: '', payer: 'ma', split: ['ma', 'mb'] }] }],
  ['mates 不是陣列（frontmatter 壞掉）', { mates: 'oops', settle: { a: 1 }, expenses: [{ id: 'z', amount: 50, cat: 'food', desc: '' }] }],
  ['名字含引號／反斜線／表情', { mates: [{ id: 'q', name: '阿"Q\\' }, { id: 'r', name: '🐷豬' }], expenses: [{ id: 'z', amount: 1, cat: 'food', desc: '', payer: 'r' }] }],
];
for (const [name, extra] of cases) {
  const t = Object.assign(clone(BASE), clone(extra));
  const fe = FE.serializeTrip(clone(t)), be = SV.serializeTrip(clone(t));
  eq(fe, be, name + '：前後端 serialize 逐字相同');
  const fe2 = FE.serializeTrip(FE.parseTrip('x', fe)), be2 = SV.serializeTrip(SV.parseTrip('x', be));
  eq(fe2, fe, name + '：前端 parse→serialize 冪等');
  eq(be2, be, name + '：後端 parse→serialize 冪等');
  eq(FE.serializeTrip(SV.parseTrip('x', fe)), fe, name + '：後端 parse、前端 serialize 也相同');
}
/* 幾個關鍵的「長相」斷言（不只比兩邊相同，也要是對的） */
{
  const out = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[1][1])));
  ok(/\nmates: \[\{"id":"ma","name":"黏"\},\{"id":"mb","name":"肚"\},\{"id":"mc","name":"媽媽"\},\{"id":"mk","name":"小寶","kid":true,"to":\["ma","mb"\]\}\]\nsettle: \[\{"from":"mc","to":"ma","amount":11462,"at":"2026-11-16"\}\]\ncreatedAt:/.test(out),
    'mates/settle 在 createdAt 前、key 順序 id,name,kid,to／from,to,amount,at');
  ok(out.includes('{"id":"e3","amount":6837,"cat":"ticket","desc":"環球","day":"pre","fx":31800,"card":true,"payer":"ma","shares":{"ma":8600,"mb":8600,"mc":8600,"mk":6000}}'),
    '花費 key 順序 …,fx,card,payer,shares');
  ok(out.includes('{"id":"e8","amount":258,"cat":"food","desc":"章魚燒","day":3,"fx":1200,"payer":"mb","kidTo":{"mk":["mc"]}}'), 'kidTo 接在最後');
  const o2 = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[2][1])));
  ok(o2.includes('"payer":"ma","shares":{"ma":100,"mb":200}}') && !o2.includes('"split"'), 'split＋shares ⇒ 只留 shares');
  const o3 = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[3][1])));
  ok(o3.includes('{"id":"x1","amount":300,"cat":"food","desc":"","split":["ma","mb"]}'), '幽靈 payer 丟掉、split 只留在的人且照旅伴順序');
  ok(o3.includes('{"id":"x2","amount":300,"cat":"food","desc":""}'), 'payer 是小孩 ⇒ 當沒填；shares 全幽靈 ⇒ 大家平分');
  ok(o3.includes('{"id":"x3","amount":300,"cat":"food","desc":"","payer":"ma"}'), 'kidTo 只剩小孩／幽靈 ⇒ 整個拿掉（用預設）');
  const o4 = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[4][1])));
  ok(o4.includes('"shares":{"ma":12.5,"mb":12.5}'), '外幣 shares 收 0.01、≤0 丟掉');
  const o5 = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[5][1])));
  ok(o5.includes('mates: [{"id":"a","name":"黏"},{"id":"c","name":"肚"},{"id":"k","name":"寶","kid":true,"to":["c"]},{"id":"k2","name":"寶2","kid":true}]'),
    '旅伴 normalize：去重 id、丟沒名字、trim、to 只留大人');
  const o6 = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[6][1])));
  ok(o6.includes('settle: [{"from":"mc","to":"mb","amount":100,"at":"2026-11-17"}]'), 'settle 丟壞的、金額取整');
  const o7 = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[7][1])));
  ok(o7.includes('"payer":"ma","split":["ma","mb"]') && o7.includes('settle: '), '沒旅伴 ⇒ 參照原樣保留');
  const o8 = FE.serializeTrip(Object.assign(clone(BASE), clone(cases[8][1])));
  ok(!/^mates:|^settle:/m.test(o8), 'mates 不是陣列 ⇒ 當沒設，不寫');
}

/* =====================================================================
   C. 分帳計算
   ===================================================================== */
section('C. 分帳計算（純函式）');
const R = 0.215, J = (n) => Math.round(n * R);
function osaka() {
  return { id: 'osaka', fxCur: 'JPY', fxRate: R, mates: clone(MATES), settle: [], expenses: [
    { id: 'e1', amount: 38400, cat: 'transport', desc: '機票', day: 'pre', payer: 'ma' },
    { id: 'e2', amount: 42000, cat: 'stay', desc: '公寓', day: 'pre', payer: 'mb' },
    { id: 'e3', amount: J(31800), cat: 'ticket', desc: '環球', day: 'pre', fx: 31800, card: true, payer: 'ma', shares: { ma: 8600, mb: 8600, mc: 8600, mk: 6000 } },
    { id: 'e4', amount: J(4680), cat: 'food', desc: '一蘭', day: 1, fx: 4680, payer: 'mc' },
    { id: 'e5', amount: J(860), cat: 'food', desc: '便利商店', day: 1, fx: 860 },
    { id: 'e6', amount: J(6400), cat: 'food', desc: '黑門', day: 2, fx: 6400, payer: 'mb', split: ['ma', 'mb'] },
    { id: 'e7', amount: J(12400), cat: 'shop', desc: '藥妝', day: 2, fx: 12400, payer: 'mc', split: ['mc'] },
    { id: 'e8', amount: J(1200), cat: 'food', desc: '章魚燒', day: 3, fx: 1200, payer: 'mb', kidTo: { mk: ['mc'] } },
    { id: 'e9', amount: J(8400), cat: 'transport', desc: 'JR', day: 4, fx: 8400, plan: true, payer: 'ma' },
    { id: 'e10', amount: J(24000), cat: 'food', desc: '燒肉', day: 7, fx: 24000, plan: true }] };
}
function taitung() {
  return { id: 'tt', fxCur: '', fxRate: 0, settle: [],
    mates: [{ id: 'ta', name: '黏' }, { id: 'tb', name: '肚' }, { id: 'tc', name: '媽媽' }, { id: 'tk', name: '小寶', kid: true, to: ['ta', 'tb'] }],
    expenses: [
      { id: 't1', amount: 4800, cat: 'stay', desc: '', day: 'pre', payer: 'tb' },
      { id: 't2', amount: 3600, cat: 'ticket', desc: '', day: 1, payer: 'ta', split: ['ta', 'tb', 'tc'] },
      { id: 't3', amount: 520, cat: 'food', desc: '', day: 1, payer: 'tc' },
      { id: 't4', amount: 1250, cat: 'transport', desc: '', day: 2, payer: 'ta', split: ['ta', 'tb'] }] };
}
const xs = (t, r) => r.xfers.map((x) => FE.mateOf(t, x.from).name + '給' + FE.mateOf(t, x.to).name + ' ' + x.amount).join('；');
function invariants(t, withPlan, label) {
  let good = true;
  for (const e of t.expenses) {
    if (e.plan && !withPlan) continue;
    if (!e.payer || !FE.isAdult(t, e.payer)) continue;
    const s = FE.shareOf(t, e);
    const tot = Object.values(s.per).reduce((a, b) => a + b, 0);
    const rawTot = Object.values(s.raw).reduce((a, b) => a + b, 0);
    if (tot !== Math.round(e.amount) || rawTot !== Math.round(e.amount)) { good = false; ok(false, label + ' 筆 ' + e.id + ' Σ份＝amount', tot + '/' + e.amount); }
    for (const k of Object.keys(s.per)) if (!FE.isAdult(t, k) || !Number.isInteger(s.per[k])) { good = false; ok(false, label + ' 份額只落在大人且為整數', k); }
  }
  const r = FE.settleOf(t, withPlan);
  const sum = Object.values(r.bal).reduce((a, b) => a + b, 0);
  if (sum !== 0) { good = false; ok(false, label + ' 全員差額 Σ＝0', sum); }
  const b = Object.assign({}, r.bal);
  for (const x of r.xfers) { b[x.from] += x.amount; b[x.to] -= x.amount; if (!(x.amount > 0)) good = false; }
  if (Object.values(b).some((v) => v !== 0)) { good = false; ok(false, label + ' 照清單轉完全員歸零', JSON.stringify(b)); }
  const nz = Object.values(r.bal).filter((v) => v).length;
  if (nz && r.xfers.length > nz - 1) { good = false; ok(false, label + ' 次數 ≤ n−1', r.xfers.length + '/' + nz); }
  return { good, r };
}
{
  const t = osaka();
  const { good, r } = invariants(t, false, '大阪');
  ok(good, '大阪（已付）：每筆 Σ＝amount、Σ差額＝0、轉完歸零');
  eq(xs(t, r), '媽媽給黏 11462；媽媽給肚 9861', '大阪對答案（G9）');
  eq(r.noPayer.map((e) => e.id).join(), 'e5', '大阪：已付沒填付款人 ⇒ noPayer＝便利商店');
  eq(r.planOut.length, 2, '大阪：兩筆預計不算進「只算已付」');
  const rp = FE.settleOf(t, true);
  ok(invariants(t, true, '大阪試算').good, '大阪（含預計試算）：恆等式成立');
  eq(rp.planNoPayer.map((e) => e.id).join(), 'e10', '試算：沒填付款人的預計不算（planNoPayer），也不混進 noPayer');
  eq(rp.noPayer.map((e) => e.id).join(), 'e5', '試算：noPayer 仍只有已付那筆');
  ok(rp.P.ma.paid === r.P.ma.paid + J(8400), '試算把有付款人的預計（JR）算進黏先墊的');
  /* 小孩覆寫：章魚燒 kidTo→媽媽 ⇒ 媽媽「其中幫小孩出」出現那份 */
  const s8 = FE.shareOf(t, t.expenses[7]);
  ok(s8.kidPart.mc > 0 && !s8.kidPart.ma && !s8.kidPart.mb, '小孩覆寫（章魚燒→媽媽）：小孩那份全算給媽媽', JSON.stringify(s8.kidPart));
  eq(s8.raw.mk, s8.kidPart.mc, '小孩那份＝媽媽幫小孩出的');
  const s1 = FE.shareOf(t, t.expenses[0]);
  ok(s1.kidPart.ma > 0 && s1.kidPart.mb > 0 && !s1.kidPart.mc, '沒覆寫 ⇒ 用旅伴設定的預設（黏、肚）');
  /* 選幾個人只選付錢的自己 ⇒ 對結算沒影響 */
  const t2 = osaka(); t2.expenses = t2.expenses.filter((e) => e.id !== 'e7');
  const rr = FE.settleOf(t2, false);
  for (const id of ['ma', 'mb', 'mc']) eq(rr.bal[id], r.bal[id], '藥妝（只算自己）拿掉後 ' + id + ' 差額不變');
  /* 尾數給付錢的人：100 元 3 人分 ⇒ 付錢的 34 */
  const t3 = { mates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], expenses: [] };
  const sp = FE.shareOf(t3, { amount: 100, payer: 'c' });
  ok(sp.per.c === 34 && sp.per.a === 33 && sp.per.b === 33, '除不盡的 1 元給付錢的人', JSON.stringify(sp.per));
  const sp2 = FE.shareOf(t3, { amount: 101, payer: 'b' });
  ok(sp2.per.b === 34 && sp2.per.a === 34 && sp2.per.c === 33, '多出 2 元：付錢的人先、再照旅伴順序', JSON.stringify(sp2.per));
  /* 各填金額當比例：外幣 shares、台幣 amount */
  const sp3 = FE.shareOf(t, t.expenses[2]);
  eq(Object.values(sp3.per).reduce((a, b) => a + b, 0), J(31800), '各填（外幣）：台幣加總＝amount');
}
{
  const t = taitung();
  const { good, r } = invariants(t, false, '台東');
  ok(good, '台東（只有台幣）：恆等式成立');
  eq(xs(t, r), '媽媽給黏 1030；媽媽給肚 980', '台東對答案（G9）');
}
/* 已轉紀錄：記了 ⇒ 差額扣掉、清單變短；全記完 ⇒ 都結清；撤銷 ⇒ 回原狀 */
{
  const t = osaka();
  const r0 = FE.settleOf(t, false);
  t.settle.push({ from: r0.xfers[0].from, to: r0.xfers[0].to, amount: r0.xfers[0].amount, at: '2026-11-16' });
  const r1 = FE.settleOf(t, false);
  eq(r1.xfers.length, 1, '已轉一筆 ⇒ 剩 1 筆');
  eq(xs(t, r1), '媽媽給肚 9861', '剩下的是另一筆');
  ok(Object.values(r1.bal).reduce((a, b) => a + b, 0) === 0, '已轉後 Σ差額仍＝0');
  t.settle.push({ from: r1.xfers[0].from, to: r1.xfers[0].to, amount: r1.xfers[0].amount, at: '2026-11-16' });
  const r2 = FE.settleOf(t, false);
  ok(r2.xfers.length === 0 && Object.values(r2.bal).every((v) => v === 0), '全部已轉 ⇒ 都結清');
  t.expenses.push({ id: 'n1', amount: 900, cat: 'food', desc: '', day: 5, payer: 'mc' });
  const r3 = FE.settleOf(t, false);
  ok(r3.xfers.length > 0 && invariants(t, false, '結清後新帳').good, '結清後再記新帳 ⇒ 差額接著算');
  t.expenses.pop(); t.settle.splice(0, 2);
  eq(xs(t, FE.settleOf(t, false)), xs(t, r0), '撤銷兩筆已轉 ⇒ 回到原狀');
  /* 試算模式也扣已轉 */
  t.settle.push({ from: 'mc', to: 'ma', amount: 100, at: '2026-11-16' });
  eq(FE.settleOf(t, true).P.mc.sent, 100, '試算模式也扣已轉');
}
/* 最少轉帳：+4/+3/+3/−6/−4 必須 3 筆；負控組（純貪婪）4 筆 */
{
  const t = { mates: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id })) };
  const bal = { a: 4, b: 3, c: 3, d: -6, e: -4 };
  const x = FE.minTransfers(t, bal);
  eq(x.length, 3, '精確解：+4/+3/+3/−6/−4 ⇒ 3 筆');
  const g = FE.greedyXfer(['a', 'b', 'c', 'd', 'e'], bal);
  eq(g.length, 4, '負控組：純貪婪 ⇒ 4 筆（量得出差異＝尺沒壞）');
  const b = Object.assign({}, bal); for (const y of x) { b[y.from] += y.amount; b[y.to] -= y.amount; }
  ok(Object.values(b).every((v) => v === 0), '精確解轉完全員歸零');
  /* 兩台一致：同一份輸入輸出逐字相同（純函式＋平手照旅伴順序；這裡重算 20 次比 JSON） */
  const once = JSON.stringify(FE.settleOf(osaka(), false).xfers);
  let same = true; for (let i = 0; i < 20; i++) same = same && JSON.stringify(FE.settleOf(osaka(), false).xfers) === once;
  ok(same, '同一份資料重算 20 次，轉帳清單逐字相同');
}
/* 擋存檔（splitDraftError） */
{
  const t = osaka();
  eq(FE.splitDraftError(t, { amt: 31800, mode: 'custom', pick: [], shares: { ma: 8600, mb: 8600, mc: 8600, mk: 4000 }, kidTo: { mk: ['ma', 'mb'] } }), '各人金額加起來要等於總額', '各填金額≠總額 ⇒ 擋');
  eq(FE.splitDraftError(t, { amt: 31800, mode: 'custom', pick: [], shares: { ma: 8600, mb: 8600, mc: 8600, mk: 6000 }, kidTo: { mk: ['ma', 'mb'] } }), '', '各填金額剛好 ⇒ 可以存');
  eq(FE.splitDraftError(t, { amt: 25, mode: 'custom', pick: [], shares: { ma: 12.5, mb: 12.5 }, kidTo: { mk: ['ma'] } }), '', '外幣小數 12.5＋12.5＝25（0.01 精度）⇒ 可以存');
  eq(FE.splitDraftError(t, { amt: 25, mode: 'custom', pick: [], shares: { ma: 12.5, mb: 12.49 }, kidTo: { mk: ['ma'] } }), '各人金額加起來要等於總額', '差 0.01 ⇒ 擋');
  eq(FE.splitDraftError(t, { amt: 0.3, mode: 'custom', pick: [], shares: { ma: 0.1, mb: 0.2 }, kidTo: { mk: ['ma'] } }), '', '0.1＋0.2＝0.3 浮點不會誤擋');
  eq(FE.splitDraftError(t, { amt: 100, mode: 'pick', pick: [], shares: {}, kidTo: { mk: ['ma'] } }), '至少要選一個人', '選幾個人全沒選 ⇒ 擋');
  eq(FE.splitDraftError(t, { amt: 100, mode: 'all', pick: [], shares: {}, kidTo: { mk: [] } }), '小寶這筆至少要算給一個大人', '小孩沒算給任何人 ⇒ 擋');
  eq(FE.splitDraftError(t, { amt: 100, mode: 'pick', pick: ['ma', 'mb'], shares: {}, kidTo: { mk: [] } }), '', '小孩沒參與這筆 ⇒ 不管他的 kidTo');
  eq(FE.splitDraftError(t, { amt: 100, mode: 'custom', pick: [], shares: { ma: 100, mk: 0 }, kidTo: { mk: [] } }), '', '小孩在各填金額填 0 ⇒ 不算參與');
  eq(FE.splitInvolved(t, { mode: 'custom', shares: { ma: 100, mk: 0 } }).join(), 'ma', 'splitInvolved：各填 0 的人不算');
}
/* 可能重複 */
{
  const t = { mates: clone(MATES), expenses: [
    { id: 'a', amount: 500, day: 2, payer: 'ma' }, { id: 'b', amount: 500, day: 2, payer: 'mb' },        // ✔ 重複
    { id: 'c', amount: 500, day: 2, payer: 'ma' },                                                         // 跟 a 同付款人 ✘；跟 b ✔
    { id: 'd', amount: 500, day: 3, payer: 'mc' },                                                         // 不同天 ✘
    { id: 'e', amount: 501, day: 2, payer: 'mc' },                                                         // 金額不同 ✘
    { id: 'f', amount: 500, payer: 'mc' },                                                                 // 沒指定哪天 ✘
    { id: 'g', amount: 500, day: 2 },                                                                      // 沒付款人 ✘
    { id: 'h', amount: 800, day: 'pre', payer: 'ma' }, { id: 'i', amount: 800, day: 'pre', payer: 'mc', plan: true }, // 行前也算一天；預計／已付不分 ✔
    { id: 'j', amount: 0, day: 5, payer: 'ma' }, { id: 'k', amount: 0, day: 5, payer: 'mb' }] };       // 0 元 ✘
  const P = FE.dupPairs(t, {}).map((p) => p[0].id + p[1].id).join();
  eq(P, 'ab,bc,hi', '可能重複：同一天＋同金額＋不同付款人');
  eq(FE.dupPairs(t, { 'a|b': 1 }).map((p) => p[0].id + p[1].id).join(), 'bc,hi', '按過「不是重複」的配對不再出現');
  eq(FE.dupKey('b', 'a'), 'a|b', 'dupKey 跟順序無關');
}

/* =====================================================================
   D. 隨機壓力（固定種子 ⇒ 每次跑都一樣）
   ===================================================================== */
section('D. 隨機 1,000 趟：每筆 Σ＝amount、Σ差額＝0、轉完歸零、次數 ≤ n−1、精確解 ≤ 貪婪');
{
  let seed = 20261116;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const ri = (n) => Math.floor(rnd() * n);
  let bad = 0, better = 0;
  for (let k = 0; k < 1000; k++) {
    const nA = 2 + ri(7), nK = ri(3), mates = [];
    for (let i = 0; i < nA; i++) mates.push({ id: 'a' + i, name: 'A' + i });
    for (let i = 0; i < nK; i++) mates.push({ id: 'k' + i, name: 'K' + i, kid: true, to: rnd() < .3 ? [] : ['a' + ri(nA)] });
    const ids = mates.map((m) => m.id), ex = [];
    for (let i = 0, n = 1 + ri(25); i < n; i++) {
      const e = { id: 'e' + i, amount: ri(30000) + 1, payer: rnd() < .9 ? 'a' + ri(nA) : undefined, plan: rnd() < .15 };
      const m = ri(3);
      if (m === 1) e.split = ids.filter(() => rnd() < .5);
      if (m === 2) { e.shares = {}; ids.forEach((id) => { if (rnd() < .6) e.shares[id] = Math.round(rnd() * 5000) / (rnd() < .3 ? 10 : 1); }); }
      if (nK && rnd() < .3) { e.kidTo = {}; e.kidTo['k' + ri(nK)] = ['a' + ri(nA)]; }
      ex.push(e);
    }
    const t = { mates, expenses: ex, settle: [] };
    if (!invariants(t, false, '#' + k).good || !invariants(t, true, '#' + k + '試算').good) bad++;
    const r = FE.settleOf(t, false);
    const order = mates.map((m) => m.id).filter((id) => r.bal[id]);
    const g = FE.greedyXfer(order, r.bal);
    if (r.xfers.length > g.length) { bad++; ok(false, '#' + k + ' 精確解不可以比貪婪多', r.xfers.length + '>' + g.length); }
    if (r.xfers.length < g.length) better++;
  }
  eq(bad, 0, '1,000 趟全部成立');
  console.log('  （其中 ' + better + ' 趟精確解比貪婪少轉至少一筆）');
}

/* =====================================================================
   E. QA 退件補測（Y2 小孩預設、N3 剩下平分、R1 版本與 docs 一致）
   ===================================================================== */
section('E. 小孩沒設 to＝全部大人（Y2）／剩下平分整數分配（N3）／public 與 docs 一致（R1）');
{
  const t = { mates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'k', name: 'K', kid: true }], expenses: [] };
  eq(FE.kidDefault(t, t.mates[2]).join(), 'a,b', 'Y2：小孩沒有 to ⇒ 預設全部大人');
  eq(FE.kidTargets(t, { amount: 90 }, t.mates[2]).join(), FE.kidDefault(t, t.mates[2]).join(), 'Y2：kidDefault 跟計算用的 kidTargets 一致');
  eq(FE.splitDraftError(t, { amt: 90, mode: 'all', pick: [], shares: {}, kidTo: { k: FE.kidDefault(t, t.mates[2]) } }), '', 'Y2：用預設帶入小孩卡 ⇒ 可以存');
  const t2 = { mates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'k', name: 'K', kid: true, to: ['ghost'] }] };
  eq(FE.kidDefault(t2, t2.mates[2]).join(), 'a,b', 'Y2：to 裡的大人都不在了 ⇒ 全部大人');
  const t3 = { mates: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'k', name: 'K', kid: true, to: ['b'] }] };
  eq(FE.kidDefault(t3, t3.mates[2]).join(), 'b', '有 to ⇒ 照 to');
  eq(JSON.stringify(FE.fillEven(0.2, 0, 2, 100)), '[0.1,0.1]', 'N3：US$0.2 分 2 人 ⇒ 0.1／0.1');
  eq(JSON.stringify(FE.fillEven(25, 22.5, 2, 100)), '[1.25,1.25]', 'N3：HK$25 已填 22.5 ⇒ 1.25／1.25');
  eq(JSON.stringify(FE.fillEven(10, 0, 3, 100)), '[3.34,3.33,3.33]', 'N3：除不盡的 0.01 給第一個');
  eq(JSON.stringify(FE.fillEven(1000, 1, 3, 1)), '[333,333,333]', 'N3：台幣以 1 元為單位');
  let okSum = true;
  for (let i = 1; i <= 500; i++) {
    const A = i / 100 * 7, filled = Math.round(A * 30) / 100, n = 1 + (i % 5);
    const p = FE.fillEven(A, filled, n, 100);
    const s = p.reduce((x, y) => x + Math.round(y * 100), 0) + Math.round(filled * 100);
    if (s !== Math.round(A * 100) || p.some((v) => Math.abs(v * 100 - Math.round(v * 100)) > 1e-6)) okSum = false;
  }
  ok(okSum, 'N3：500 組外幣金額，平分後加總剛好＝總額、每份都是 0.01 的整數倍');
}
{
  const pub = path.join(ROOT, 'public'), doc = path.join(ROOT, 'docs');
  const walk = (d, b = '') => fs.readdirSync(path.join(d, b), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(d, path.join(b, e.name)) : [path.join(b, e.name)]);
  const pf = walk(pub).sort(), df = walk(doc).filter((f) => f !== '.nojekyll').sort();
  eq(df.join('|'), pf.join('|'), 'R1：docs/ 跟 public/ 檔案清單相同');
  const diffs = pf.filter((f) => fs.existsSync(path.join(doc, f)) && !fs.readFileSync(path.join(pub, f)).equals(fs.readFileSync(path.join(doc, f))));
  eq(diffs.join(), '', 'R1：docs/ 跟 public/ 逐檔相同（改完 public 要跑 build.js）');
  const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8'), sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8'), css = fs.readFileSync(path.join(pub, 'styles.css'), 'utf8');
  const ver = (/var APP_VER="3\.(\d+)";/.exec(app) || [])[1], sh = (/travel-shell-v(\d+)'/.exec(sw) || [])[1], da = (/travel-data-v(\d+)'/.exec(sw) || [])[1];
  ok(sh && sh === da, 'R1：SHELL_CACHE 與 DATA_CACHE 同一個版本', sh + '/' + da);
  ok(ver && Number(sh) === Number(ver) + 20, 'R1：APP_VER 3.N 對 cache vN+20（3.16↔36、3.18↔38 那套）', '3.' + ver + ' / v' + sh);
  ok(Number(ver) >= 19, 'R1：APP_VER ≥ 3.19（線上已是 3.18，不可倒退或撞號）', '3.' + ver);
  ok(/function fixFixedBars\(/.test(app) && /function fixDayChips\(/.test(app) && /scrollbar-width:thin/.test(css), 'R1：線上的 v3.17 fixFixedBars／v3.18 fixDayChips＋scrollbar-width:thin 都還在 public/');
}

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 過、' + fail + ' 沒過');
process.exit(fail ? 1 : 0);
