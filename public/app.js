"use strict";
/*
 * 旅途手帳 — 前端（視覺與互動照 UX demo v3.2，勿自行改設計）
 * 資料層：DataStore 依 location.hostname 自動切
 *   localhost -> LocalStore：打本機 Node /api（全功能）
 *   其他(GitHub Pages) -> GitHubStore：直接讀寫 GitHub repo
 *     有 PAT -> 認證 Contents API 讀寫（即時）；無 PAT -> 唯讀走 raw + sha cache-buster
 * md 序列化與 server.js 是同一套 mirror，改格式要兩邊一起改（見 CLAUDE.md）
 */

/* ============ 開場畫面（motion/splash.js）============
 * ⚠️ 一定要寫成 window.Splash && …，**不可以裸寫 Splash.hold()**。
 * 那支模組載不到的時候（離線、SW 沒預快取、部署漏檔）裸寫會丟 ReferenceError
 * ⇒ 這支檔案當場中止 ⇒ 一趟旅程都畫不出來、沒套樣式的 #splash 永遠卡在畫面上，
 * 而且**保險絲就住在那支沒載到的檔案裡**，不會有人來救。 */
var hasSplash = !!(window.Splash && window.Splash.hold && window.Splash.ready);
if(hasSplash){ try{ Splash.hold(); }catch(e){ hasSplash = false; } }
if(!hasSplash) splashFallback();

function splashFallback(){
  /* 自己把開場收掉。全螢幕的東西卡住＝App 打不開，比白畫面嚴重一個等級。 */
  try{
    var sp = document.getElementById("splash");
    if(sp && sp.parentNode) sp.parentNode.removeChild(sp);
    document.documentElement.setAttribute("data-splash","off");
  }catch(e){}
  /* splash.js 平常會掛這一行；沒有它的話 iOS Safari 的 :active 不會觸發
     ＝ 手機上所有按下回饋都是死的。 */
  try{ document.addEventListener("touchstart", function(){}, {passive:true}); }
  catch(e){ try{ document.addEventListener("touchstart", function(){}, false); }catch(e2){} }
}
/* 資料畫好了就叫一次，開場才會收。**成功或失敗都要叫**，
 * 不然開場會變成當機畫面、要停到 6 秒保險絲才走。
 * 只認第一次：之後的「重新整理」不該再影響開場。 */
var splashDone = false;
function splashReady(){
  if(splashDone) return;
  splashDone = true;
  try{ if(window.Splash && window.Splash.ready) Splash.ready(); }catch(e){}
}

/* ============ 常數 ============ */
/* 版本號的唯一來源：首頁 footer 與「版本」sheet 都讀它。
 * 改前端時跟 sw.js 的 cache 版本號一起 +1（見「版本與更新」段）。 */
var APP_VER="3.6";

/* 打包把手的三個門檻（v3.0，DESIGN.md 附錄 E2）——「先觀察，後接管」：
 * pointerdown 只進入「待命」，垂直帶開＝你在捲動就放行，橫向帶開或按住夠久才真的開始拖。
 * 要調手感就改這三個數字，別去改判斷式。 */
var PK_V_ESC = 8;      /* 垂直位移 > 8px  → 放棄（在捲動） */
var PK_H_ARM = 12;     /* 橫向位移 > 12px → 進入拖曳（橫向不可能是捲動＝意圖明確） */
var PK_T_HOLD = 220;   /* 原地按住 220ms → 進入拖曳 */

/* ---- 功能鈕的 inline SVG 圖示（吃 currentColor、每台裝置長得一樣）----
 * ⚠️ 界線（別擴大解釋）：只有「系統給的功能鈕」用 SVG。
 *    類別 emoji、旅程封面 emoji、tab bar、灰條左邊那顆 🚶、詳細列前的 📍⏱️💰📞🔗🕘📝
 *    通通是「內容」，一律保留 emoji，不准換成 SVG（Benson 拍板）。
 * v2.7 換成「圓潤」這一組（DESIGN.md 附錄 B、Benson 看實機後拍板）：
 *    pin＝**折頁地圖**（三折）＝「這個地方在哪」；
 *    route＝**一條蜿蜒的路**（起點圓 → S 曲線 → 終點圓，**刻意沒有箭頭**）＝「從這裡到那裡怎麼走」。
 *    箭頭是全站唯一的尖角（其他都是藥丸／圓角／圓點），拿掉才不吵；方向感靠兩端的起訖圓與 S 形補。
 * 兩顆的輪廓刻意差很多（一張攤開的地圖／一條路），縮到 18px 也分得出來——改圖前先確認這件事還成立。 */
var ICO = {
  pin:'<svg viewBox="0 0 24 24" class="ico" aria-hidden="true" focusable="false">'
    + '<path d="M3.4 7.6 9 5.2 15 7.8 20.6 5.4V16.4L15 18.8 9 16.2 3.4 18.6Z"/>'
    + '<path d="M9 5.2v11M15 7.8v11"/></svg>',
  route:'<svg viewBox="0 0 24 24" class="ico" aria-hidden="true" focusable="false">'
    + '<circle cx="5.9" cy="18.5" r="2.3"/>'
    + '<circle cx="18.1" cy="5.5" r="2.3"/>'
    + '<path d="M5.9 16.2c0-3.4 3.1-3.9 6.1-4.6s6.1-1.4 6.1-3.8"/></svg>',
  paste:'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M9 4.5h6M8.2 5.6H6.6A1.6 1.6 0 0 0 5 7.2v12.2A1.6 1.6 0 0 0 6.6 21h10.8a1.6 1.6 0 0 0 1.6-1.6V7.2a1.6 1.6 0 0 0-1.6-1.6h-1.6"/>'
    + '<rect x="9" y="2.9" width="6" height="3.4" rx="1.2"/>'
    + '<path d="M8.6 12h6.8M8.6 15.6h4.6"/></svg>'
};

/* 行程點類別（v1.1 起）＝可管理的全域資源：清單存 db.categories（同步 data/categories.md），
 * CATS 是 id->物件 的索引（rebuildCats 重建）。「其他」永遠存在＝刪類別後的 fallback。 */
function defaultCategories(){
  return [
    {id:"sight",     label:"景點", emoji:"📍", color:"#0d9488"},
    {id:"food",      label:"美食", emoji:"🍜", color:"#ea8600"},
    {id:"transport", label:"交通", emoji:"🚃", color:"#2f6fed"},
    {id:"stay",      label:"住宿", emoji:"🏨", color:"#8b5cf6"},
    {id:"shop",      label:"購物", emoji:"🛍️", color:"#e0447f"},
    {id:"other",     label:"其他", emoji:"✨", color:"#7a7265"}
  ];
}
var CATS = {};
function rebuildCats(){
  CATS = {};
  (db.categories||[]).forEach(function(c){ CATS[c.id]=c; });
  if(!CATS.other) CATS.other = {id:"other", label:"其他", emoji:"✨", color:"#7a7265"};
}
/* 自訂類別可選的顏色盤（含內建六色） */
var CAT_COLORS = ["#0d9488","#ea8600","#2f6fed","#8b5cf6","#e0447f","#7a7265",
                  "#d64545","#2fa87a","#b8860b","#0e7490","#6d28d9","#475569"];
var ECATS = {
  food:{label:"餐飲", emoji:"🍽️"}, transport:{label:"交通", emoji:"🚃"},
  stay:{label:"住宿", emoji:"🏨"}, ticket:{label:"門票", emoji:"🎫"},
  shop:{label:"購物", emoji:"🛍️"}, other:{label:"其他", emoji:"💸"}
};
var THEMES = {
  sunset:"linear-gradient(135deg,#ff8a80,#ff5f7e 55%,#c94b9d)",
  ocean: "linear-gradient(135deg,#38c3a7,#2f8fd6)",
  night: "linear-gradient(135deg,#6a7bf0,#8e54c9)",
  forest:"linear-gradient(135deg,#7ec96f,#3f9d8a)",
  sand:  "linear-gradient(135deg,#f5c65d,#f0855c)"
};
var ZONES = [
  {key:"checked", emoji:"🧳", label:"行李", sub:"托運"},
  {key:"carry",   emoji:"🎒", label:"隨身", sub:"隨身包"}
];
var WD = ["日","一","二","三","四","五","六"];

/* ============ 小工具 ============ */
function esc(s){
  return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function uid(){ return "x"+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
/* 取第一個 grapheme（emoji 可能是多 code point，如 👨‍👩‍👧；Segmenter 不支援時退回 code point） */
function firstGrapheme(s){
  s = String(s==null?"":s).trim();
  if(!s) return "";
  try{
    if(typeof Intl!=="undefined" && Intl.Segmenter){
      var seg = new Intl.Segmenter("zh-Hant",{granularity:"grapheme"}).segment(s);
      var it = seg[Symbol.iterator]().next();
      if(!it.done) return it.value.segment;
    }
  }catch(e){}
  return Array.from(s)[0] || "";
}
function slugify(str){
  var base = String(str||"").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-+|-+$/g,"").slice(0,40);
  return base || "trip";
}
function parseDate(s){ return new Date(s+"T00:00:00"); }
function addDays(d,n){ var x=new Date(d); x.setDate(x.getDate()+n); return x; }
function fmtMD(d){ return (d.getMonth()+1)+"/"+d.getDate(); }
function money(n){ return "NT$ "+Number(n||0).toLocaleString("zh-TW"); }
function extUrl(u){ return /^https?:\/\//i.test(u) ? u : "https://"+u; }
function mapLink(sp){
  if(sp.mapUrl) return extUrl(sp.mapUrl);
  if(sp.place) return "https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(sp.place);
  return "";
}
/* ---- v2.4 移動（transit）的路線連結：上一站 → 下一站，即時算、不存資料 ----
 * 起訖點來源優先序：addr（server 展開短連結拿到的完整地址）→ place（他自己填的地點文字）。
 * title 刻意不算（「宵夜？」不是地址，搜出來會是亂的）。
 * 兩端都要有可靠來源才給連結；算不出來就不顯示（Benson 拍板：不要用「目前位置」也不要用名稱猜）。 */
function routePoint(sp){
  if(!sp || isTransit(sp)) return "";
  return String(sp.addr||"").trim() || String(sp.place||"").trim();
}
function prevStopOf(list, idx){ for(var i=idx-1;i>=0;i--){ if(!isTransit(list[i])) return list[i]; } return null; }
function nextStopOf(list, idx){ for(var i=idx+1;i<list.length;i++){ if(!isTransit(list[i])) return list[i]; } return null; }
/* 交通方式看移動的備註自動判斷（Benson 拍板）：
 * 走路→walking；腳踏車→bicycling；大眾運輸→transit；
 * 開車／自駕／計程車／「騎車」（台灣多半是機車）與認不出來的一律 driving */
function travelMode(note){
  var n = String(note||"");
  if(/走路|步行|徒步|走過去/.test(n)) return "walking";
  if(/腳踏車|自行車|單車|ubike|youbike|微笑單車/i.test(n)) return "bicycling";
  if(/捷運|地鐵|公車|巴士|電車|火車|台鐵|高鐵|客運|輕軌|大眾運輸|新幹線|地下鐵/.test(n)) return "transit";
  return "driving";
}
function routeLink(list, idx){
  var from = routePoint(prevStopOf(list, idx));
  var to = routePoint(nextStopOf(list, idx));
  if(!from || !to) return "";
  return "https://www.google.com/maps/dir/?api=1&origin="+encodeURIComponent(from)
    + "&destination="+encodeURIComponent(to)
    + "&travelmode="+travelMode(list[idx] && list[idx].note);
}
function hoursText(sp){
  if(sp.hours24) return "24 小時營業";
  if(sp.hoursOpen || sp.hoursClose) return (sp.hoursOpen||"？")+"–"+(sp.hoursClose||"？");
  return sp.hours || ""; /* 舊版自由文字相容 */
}
/* 預計停留時間顯示規則（v1.2，定案見 CLAUDE.md）：
 * <60 分 →「45 分」；整點 →「2 小時」；.5 →「1.5 小時」；其餘 →「2 小時 20 分」 */
function formatStay(min){
  min = Math.round(Number(min)||0);
  if(min<=0) return "";
  if(min<60) return min+" 分";
  if(min%30===0) return (min/60)+" 小時"; /* 60→1、90→1.5、120→2、150→2.5 */
  return Math.floor(min/60)+" 小時 "+(min%60)+" 分";
}
/* v1.5 起訖時間：填了時間＋預計停留就算得出「停到幾點」。
 * 回 null＝算不出來（沒時間、沒停留、或時間格式怪），呼叫端自己退回舊寫法。
 * plus＝跨到隔天幾天（23:30 停 40 分 → 00:10 的 +1）。 */
function pad2(n){ return (n<10?"0":"")+n; }
function endTime(time, min){
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(time||""));
  if(!m) return null;
  min = Math.round(Number(min)||0);
  if(min<=0) return null;
  var tot = (+m[1])*60 + (+m[2]) + min;
  var plus = Math.floor(tot/1440);
  tot = ((tot%1440)+1440)%1440;
  return { txt: pad2(Math.floor(tot/60))+":"+pad2(tot%60), plus: plus };
}
/* 時間區塊（卡片與詳細 sheet 共用）。起深訖淡＝開始是他填的、結束是推算的。
 * 算不出區間時退回舊寫法（只有時間 → 08:00；只有停留 → 停 40 分）。 */
function timeHtml(sp){
  var e = endTime(sp.time, sp.stayMinutes);
  if(e){
    return '<span class="stop-time">'+esc(sp.time)
      + '<span class="to">–'+e.txt+'</span>'
      + (e.plus ? '<span class="plus1">+'+e.plus+'</span>' : '')
      + '</span>';
  }
  return '<span class="stop-time">'+(sp.time?esc(sp.time):"—")+'</span>'
    + (sp.stayMinutes ? '<span class="stop-stay">'+(sp.time?"・":"")+'停 '+formatStay(sp.stayMinutes)+'</span>' : '');
}
/* ---- v1.6 連鎖平移 ----
 * 改了某一筆的「停留」或「移動時間」，後面整串行程點的時間各加減同樣的分鐘。
 * 刻意用「平移」而不是「照停留＋移動重算整天」：原本刻意留的空檔要保留下來，
 * 重算會把空檔壓掉。代價是硬時間（表演開演、火車）也會被推走——用 toast 告知，
 * 他自己改回來。要真正釘住硬時間得加 fixed 欄位＋改 md 格式，Benson 拍板先不做。 */
function minsOf(time){
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(time||""));
  return m ? (+m[1])*60 + (+m[2]) : null;
}
function timeOf(mins){
  mins = ((Math.round(mins)%1440)+1440)%1440;
  return pad2(Math.floor(mins/60))+":"+pad2(mins%60);
}
/* 把 idx 之後、同一天、有填時間的行程點各平移 delta 分鐘；回傳實際移動幾筆。
 * transit 沒有 time 欄，跳過；沒填時間的本來就沒東西可移。 */
function shiftAfter(list, idx, delta){
  if(!delta) return 0;
  var n = 0;
  for(var i=idx+1;i<list.length;i++){
    var s = list[i];
    if(isTransit(s) || !s.time) continue;
    var m = minsOf(s.time);
    if(m===null) continue;
    s.time = timeOf(m+delta);
    n++;
  }
  return n;
}
/* 這一筆改完之後，後面那些站要平移幾分鐘（v1.6 原本只算停留；2026-08-21 起「時間」也算）。
 * 語意＝「這一筆的結束時間」變了多少：(新時間+新停留) − (舊時間+舊停留)＝時間差＋停留差。
 * 所以同一次同時改「時間」和「停留」時，兩個差是加起來成一個總量、只推一次，
 * 不會各推一次重複累加（例：時間 +10 分、停留 +20 分 ⇒ 後面全部 +30 分）。
 * 時間沒動時就退化成純停留差＝v1.6 的舊行為，一行都沒變。
 * 舊／新時間有一邊是空的（沒時間→有時間、有時間→清空）＝算不出時間差，
 * 此時整筆都不平移（回 0）：沒有基準的推算寧可不做，也不要把後面整天亂移。 */
function stopShiftDelta(oldTime, newTime, oldStay, newStay){
  var dStay = Math.round(Number(newStay)||0) - Math.round(Number(oldStay)||0);
  if(String(oldTime||"") === String(newTime||"")) return dStay;
  var a = minsOf(oldTime), b = minsOf(newTime);
  if(a===null || b===null) return 0;
  var dTime = b - a;
  /* 時鐘是 mod 1440 的環：23:00→01:00 直接相減是 −1320，真正的意思是 +120。
   * 取最短方向（−720, 720] 只是為了讓 toast 講人話——平移出來的時間兩種算法完全一樣
   * （shiftAfter 也是 mod 1440）。 */
  if(dTime > 720) dTime -= 1440;
  else if(dTime <= -720) dTime += 1440;
  return dTime + dStay;
}
function shiftToast(n, delta){
  if(!n) return;
  var sign = delta>0 ? "往後" : "往前";
  toast("後面 "+n+" 筆時間已跟著"+sign+"移 "+formatStay(Math.abs(delta)));
}
/* 新增行程點時的預設時間＝這一天最後推算得出的時刻（上一站結束＋中間的移動）。
 * 從頭走一遍，遇到有填時間的行程點就以它為準重新對錶（手填的最大）。 */
function nextTimeGuess(list){
  var cur = null;
  for(var i=0;i<list.length;i++){
    var s = list[i];
    if(isTransit(s)){
      if(cur!==null) cur += Math.round(Number(s.stayMinutes)||0);
      continue;
    }
    var m = minsOf(s.time);
    if(m!==null) cur = m;
    if(cur!==null) cur += Math.round(Number(s.stayMinutes)||0);
  }
  return cur===null ? "" : timeOf(cur);
}

/* ============ v2.8 銜接檢查與重新排（規格＝demo/reschedule.html，見 DESIGN.md 附錄 C） ============
 * 為什麼要有這一段：v1.6/v2.5 的連鎖平移是「後面全部加減同樣的分鐘數」，
 * 它保留原本的相對關係——包括原本就錯的那一段。缺口是更早「新增／拖曳」時造成的，
 * 平移只會把缺口原封不動搬著走，怎麼改都修不好。這一段補的是 App 從來沒算過的另一半：
 * 「照他填的停留＋移動走，這一站其實幾點才到得了」。 */
function num(v){ return Math.round(Number(v)||0); }
/* 小於 5 分的差落在真實移動誤差裡＝噪音，標出來會讓提示變常態、失去提醒的意義 */
var GAP_MIN = 5;
/* 他填的時間是 00:00–23:59 的鐘面，走出來的 cursor 可能超過 1440（跨午夜）。
 * lift 把鐘面時刻抬到 cursor 所在的那一圈，01:45 才不會被當成「昨天凌晨」。 */
function liftTime(m, cursor){ return m + 1440*Math.round((cursor-m)/1440); }
/* 走一遍這一天：每個行程點各算出 planned（他填的）與 arrive（走得到的）。
 * gap>0＝來不及（晚幾分）、gap<0＝空檔（早到幾分）、null＝算不出來（沒時間／前面沒有基準）。
 * 走完一站之後 cursor 以「他填的時間」重新對錶（跟 nextTimeGuess 同一個規則：手填的最大）。 */
function analyzeDay(list){
  var out=[], cursor=null;
  for(var i=0;i<list.length;i++){
    var s=list[i];
    if(isTransit(s)){
      out.push({transit:true});
      if(cursor!==null) cursor += num(s.stayMinutes);
      continue;
    }
    var m=minsOf(s.time);
    var arrive=cursor;
    var planned=(m===null) ? null : ((cursor===null) ? m : liftTime(m, cursor));
    var gap=(planned!==null && arrive!==null) ? (arrive-planned) : null;
    out.push({transit:false, planned:planned, arrive:arrive, gap:gap});
    if(planned!==null) cursor = planned + num(s.stayMinutes);
    else if(cursor!==null) cursor += num(s.stayMinutes);
  }
  return out;
}
/* 只收「負的差」（來不及）。正的差是他刻意留的緩衝，**絕對不標**——
 * 標出來等於每一天都在報錯，提醒就沒有意義了（demo 那個「連空檔也標」的開關是對照組，不做進正式版）。 */
function lateSet(list){
  var a=analyzeDay(list), set={};
  for(var i=0;i<a.length;i++) if(a[i].gap!==null && a[i].gap>=GAP_MIN) set[i]=a[i];
  return set;
}
function firstLateIdx(list){
  var a=analyzeDay(list);
  for(var i=0;i<a.length;i++) if(a[i].gap!==null && a[i].gap>=GAP_MIN) return i;
  return -1;
}
/* 重新排：規則只有一條——**新時間 = max(他填的時間, 走得到的時間)，只往後推、不往前拉**。
 * 所以「來不及的」被挪到真的到得了的時刻，而他刻意留的空檔會**吸收**掉這段延誤：
 * 一旦某一站原本就晚於走得到的時間（空檔夠大），它就維持原時間，後面整串都不用再推。
 * 這是跟連鎖平移最大的差別，也是不能簡化成「後面全部 +N」的原因。
 * startIdx 之前的行程點一律不動（只當作對錶的基準），這樣「從某一站起」與「整天重排」共用同一支。 */
function replanDay(list, startIdx){
  var cursor=null, newT={}, changes=[];
  for(var i=0;i<list.length;i++){
    var s=list[i];
    if(isTransit(s)){ if(cursor!==null) cursor += num(s.stayMinutes); continue; }
    var m=minsOf(s.time);
    var planned=(m===null) ? null : ((cursor===null) ? m : liftTime(m, cursor));
    var val=planned;
    if(i>=startIdx && planned!==null && cursor!==null && cursor>planned) val=cursor;
    if(val!==null){
      var t=timeOf(val);
      if(t!==s.time) changes.push({idx:i, title:s.title, from:s.time, to:t, delta:val-planned});
      newT[i]=t; cursor = val + num(s.stayMinutes);
    }else if(cursor!==null){ cursor += num(s.stayMinutes); }
  }
  return { newT:newT, changes:changes };
}
/* 套用之後他刻意留的空檔各被吃掉多少——這是最容易讓他不爽的副作用，預覽一定要先講。
 * 作法：拿同一支 analyzeDay 跑「換過時間的副本」，比對原本 gap<0（有空檔）的那幾筆。 */
function bufferDiff(list, newT){
  var before=analyzeDay(list);
  var after=analyzeDay(list.map(function(s,i){
    if(isTransit(s)) return s;
    var c={}; for(var k in s) c[k]=s[k];
    if(newT[i]) c.time=newT[i];
    return c;
  }));
  var out=[];
  for(var i=0;i<list.length;i++){
    var b=before[i], a=after[i];
    if(!b || b.transit || b.gap===null || !a || a.gap===null) continue;
    if(b.gap<0 && a.gap>b.gap) out.push({ title:list[i].title, from:-b.gap, to:Math.max(0,-a.gap) });
  }
  return out;
}
function tripEnd(t){ return addDays(parseDate(t.start), t.days-1); }
function tripRange(t){
  var s=parseDate(t.start), e=tripEnd(t);
  return fmtMD(s)+"（"+WD[s.getDay()]+"）– "+fmtMD(e)+"（"+WD[e.getDay()]+"）";
}
function tripStatus(t){
  var today=new Date(); today.setHours(0,0,0,0);
  var s=parseDate(t.start), e=tripEnd(t);
  var diff=Math.round((s-today)/86400000);
  if(diff>0) return {text:"還有 "+diff+" 天出發", cls:""};
  if(today<=e) return {text:"旅程進行中 ✨", cls:"now"};
  return {text:"已結束", cls:"past"};
}
/* v3.5 起花費有兩種：**已付**與**預計（還沒付）**。
   ⚠️ `spentOf` 的語意跟著收窄成「**只算已付**」——它是「這趟花掉多少」，
      首頁旅程卡也是用它，預計的錢不可以混進去（還沒花的錢不叫花費）。
   要「總共要準備多少」用 `needOf`（＝已付＋預計）。 */
function spentOf(t){
  var s=0; (t.expenses||[]).forEach(function(e){ if(!e.plan) s+=Number(e.amount)||0; }); return s;
}
function planOf(t){
  var s=0; (t.expenses||[]).forEach(function(e){ if(e.plan) s+=Number(e.amount)||0; }); return s;
}
function needOf(t){ return spentOf(t) + planOf(t); }   /* 這趟總共要準備多少 */
function zoneCount(items, z){
  return items.filter(function(i){return i.zone===z;}).length;
}

/* ============ toast（正式版新增：錯誤/唯讀提示） ============ */
var toastEl = document.getElementById("toast");
var toastTimer = null;
/* act（v2.8 選配）＝{label, fn}：需要他當場做決定時才給（目前只有「新增之後這天接不上」）。
 * 有動作鈕時停留久一點（8 秒），沒有就維持原本的 2.6 秒；沒帶 act ＝ 跟舊版一模一樣。 */
function toast(msg, isErr, act){
  toastEl.textContent = msg;
  toastEl.className = isErr ? "err" : "";
  if(act && act.label){
    var b = document.createElement("button");
    b.type = "button"; b.className = "t-act"; b.textContent = act.label;
    b.onclick = function(){ toastEl.className = "hidden"; act.fn(); };
    toastEl.appendChild(b);
    toastEl.className += " has-act";
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.className += " hidden"; }, (act && act.label) ? 8000 : 2600);
}

/* ============ md 序列化（server.js 的 mirror，改要一起改） ============ */
function isTransit(s){ return s && s.type==="transit"; } /* 缺 type＝行程點（舊資料無痛） */
function cleanStop(s){
  /* v1.3 移動（transit）：刻意只留 note＋stayMinutes（＝移動時間），
   * 不寫 title/cat/place 等站點欄位，讓「路上」不佔版面也不佔資料 */
  if(isTransit(s)){
    var m = { id:String(s.id||""), type:"transit" };
    if(s.note) m.note = String(s.note);
    if(Number(s.stayMinutes) > 0) m.stayMinutes = Math.round(Number(s.stayMinutes));
    return m;
  }
  var o = { id:String(s.id||"") };
  o.title = String(s.title||"");
  if(s.time) o.time = String(s.time);
  if(s.cat) o.cat = String(s.cat);
  if(s.place) o.place = String(s.place);
  if(s.note) o.note = String(s.note);
  if(s.mapUrl) o.mapUrl = String(s.mapUrl);
  if(s.addr) o.addr = String(s.addr); /* v2.4 展開 mapUrl 短連結後的完整地址（server 補；移動那條的路線連結靠它） */
  if(Number(s.cost)) o.cost = Number(s.cost);
  if(Number(s.stayMinutes) > 0) o.stayMinutes = Math.round(Number(s.stayMinutes)); /* v1.2 預計停留（分鐘；負值不落檔） */
  if(s.bookingRef) o.bookingRef = String(s.bookingRef);
  if(s.phone) o.phone = String(s.phone);
  if(s.url) o.url = String(s.url);
  if(s.hoursOpen) o.hoursOpen = String(s.hoursOpen);
  if(s.hoursClose) o.hoursClose = String(s.hoursClose);
  if(s.hours24) o.hours24 = true;
  if(s.hours) o.hours = String(s.hours);
  return o;
}
/* 花費的「第幾天」（v3.3 起的選填欄位；server.js mirror，改要一起改）
 *   "pre" ＝ 行前（機票／訂房這種出發前就花的錢，不屬於任何一天，但通常是最大筆）
 *   1..N  ＝ Day N
 *   缺值  ＝ 沒指定 ⇒ **舊資料零遷移、序列化後逐字不變**（跟 kind/bag 同一招）
 * ⚠️ 刻意不驗證上限：**縮天不刪資料**（跟 itinerary 同一個哲學）——day 比現在的 days 大時
 *    資料照留、選單也照列得出來，天數改回來就回得來。 */
function expDayVal(v){
  if(v==="pre") return "pre";
  var n = Math.floor(Number(v));
  return (n>=1 && isFinite(n)) ? n : 0;               /* 0 ＝ 沒指定 */
}
function cleanExpense(e){
  var o = { id:String(e.id||""), amount:Number(e.amount)||0, cat:String(e.cat||"other"), desc:String(e.desc||"") };
  var d = expDayVal(e.day);
  if(d) o.day = d;                                    /* 空值不寫 */
  /* v3.5：`plan:true` ＝ 這筆只是「預計要花」、還沒付。
     ⚠️ 真值刻意是 plan 不是 paid：既有資料全都是「已經花掉的」，
        用「缺值＝已付」才做得到零遷移（跟 kind/bag/day 同一招）。 */
  if(e.plan) o.plan = true;
  return o;
}
/* 打包項目（v2.9 起多了 kind／bag 兩個選填欄位＝「包」）
 * key 順序固定 id,text,done,zone,kind,bag；空值不寫 ⇒ 舊資料（沒有 kind/bag）零遷移、序列化後逐字不變 */
function cleanPackItem(p){
  p = p || {};
  var o = { id:String(p.id||""), text:String(p.text||""), done:!!p.done, zone:(p.zone==="checked"?"checked":"carry") };
  if(p.kind==="bag") o.kind="bag";                    /* 這一筆是一個包 */
  else if(p.bag) o.bag=String(p.bag);                 /* 在哪個包裡（父包 id）；包不能在包裡 */
  return o;
}
/* 打包清單 normalize（server.js mirror，改要一起改；必須冪等）
 * 1. bag 指向不存在的 id → 降級成頂層（壞掉的參照要有 fallback，不整份炸掉）
 * 2. kind==="bag" 強制沒有 bag（只允許兩層）
 * 3. 包內物品的 zone 不是真值來源 —— 一律同步成父包的 zone
 * 4. 輸出時包的小孩緊跟在包後面（parser 不依賴這個順序，但檔案要人讀得懂） */
function normalizePacking(list){
  var items = (Array.isArray(list)?list:[]).map(cleanPackItem);
  var bagZone = {};
  items.forEach(function(p){ if(p.kind==="bag" && p.id) bagZone[p.id]=p.zone; });
  items.forEach(function(p){
    if(p.kind==="bag"){ delete p.bag; return; }
    if(p.bag && !(p.bag in bagZone)) delete p.bag;
    if(p.bag) p.zone = bagZone[p.bag];
  });
  var out=[], emitted=[];
  items.forEach(function(p,i){
    if(p.bag) return;                                  /* 小孩跟著它的包一起輸出 */
    out.push(p); emitted[i]=true;
    if(p.kind==="bag" && p.id){
      items.forEach(function(k,j){ if(!emitted[j] && k.bag===p.id){ out.push(k); emitted[j]=true; } });
    }
  });
  return out;
}
function fmString(v){ return JSON.stringify(String(v==null?"":v)); }
function fmNumber(v){ var n=Number(v); return String(isFinite(n)?n:0); }

function serializeTrip(t){
  var L=[];
  L.push("---");
  L.push("name: "+fmString(t.name));
  L.push("dest: "+fmString(t.dest));
  L.push("emoji: "+fmString(t.emoji));
  L.push("theme: "+fmString(t.theme));
  L.push("start: "+fmString(t.start));
  L.push("days: "+fmNumber(t.days||1));
  L.push("budget: "+fmNumber(t.budget));
  L.push("createdAt: "+fmString(t.createdAt||new Date().toISOString()));
  L.push("updatedAt: "+fmString(t.updatedAt||new Date().toISOString()));
  L.push("---","","## 行程","");
  var dayKeys = Object.keys(t.itinerary||{}).map(Number)
    .filter(function(n){return isFinite(n)&&n>=1;}).sort(function(a,b){return a-b;});
  dayKeys.forEach(function(d){
    var list=(t.itinerary||{})[String(d)]||[];
    if(!list.length) return;
    L.push("### Day "+d,"");
    list.forEach(function(s){ L.push("- "+JSON.stringify(cleanStop(s))); });
    L.push("");
  });
  L.push("## 花費","");
  (t.expenses||[]).forEach(function(e){ L.push("- "+JSON.stringify(cleanExpense(e))); });
  L.push("","## 打包","");
  normalizePacking(t.packing).forEach(function(p){ L.push("- "+JSON.stringify(p)); });
  L.push("","## 備註","");
  var notes=String(t.notes||"").replace(/\r\n/g,"\n");
  if(notes.trim()) L.push(notes.replace(/\s+$/,""));
  L.push("");
  return L.join("\n");
}
function parseFmLine(line){
  var idx=line.indexOf(":");
  if(idx===-1) return null;
  var key=line.slice(0,idx).trim();
  var raw=line.slice(idx+1).trim();
  var value;
  try{ value=JSON.parse(raw); }catch(e){ value=raw.replace(/^["']|["']$/g,""); }
  return [key,value];
}
function parseTrip(id, text){
  var t={ id:id, name:"", dest:"", emoji:"🧳", theme:"sunset", start:"", days:1, budget:0,
    createdAt:"", updatedAt:"", itinerary:{}, expenses:[], packing:[], notes:"" };
  text=String(text).replace(/\r\n/g,"\n");
  var body=text;
  var fm=/^---\n([\s\S]*?)\n---\n?/.exec(text);
  if(fm){
    fm[1].split("\n").forEach(function(line){
      var p=parseFmLine(line); if(!p) return;
      var k=p[0], v=p[1];
      if(k==="days"||k==="budget") t[k]=Number(v)||(k==="days"?1:0);
      else if(k in t) t[k]=v;
    });
    body=text.slice(fm[0].length);
  }
  var section=null, day=0, inNotes=false, notesBuf=[];
  body.split("\n").forEach(function(line){
    if(inNotes){ notesBuf.push(line); return; }
    var h2=/^##\s+(.+)$/.exec(line.trim());
    if(h2){
      var name=h2[1].trim();
      if(name==="行程"){ section="plan"; day=0; }
      else if(name==="花費") section="exp";
      else if(name==="打包") section="pack";
      else if(name==="備註") inNotes=true;
      else section=null;
      return;
    }
    if(section==="plan"){
      var dm=/^###\s*Day\s*(\d+)/i.exec(line.trim());
      if(dm){ day=Number(dm[1]); return; }
    }
    var im=/^-\s+(\{.*\})\s*$/.exec(line);
    if(!im) return;
    var obj;
    try{ obj=JSON.parse(im[1]); }catch(e){ return; }
    if(section==="plan" && day>=1){
      var key=String(day);
      if(!t.itinerary[key]) t.itinerary[key]=[];
      t.itinerary[key].push(obj);
    }else if(section==="exp"){ t.expenses.push(cleanExpense(obj)); }
    else if(section==="pack"){ t.packing.push(cleanPackItem(obj)); }
  });
  t.packing = normalizePacking(t.packing);
  t.notes=notesBuf.join("\n").trim();
  if(!(t.days>=1)) t.days=1;
  return t;
}
/* 模板項目（v2.9 起同樣可以有包）：{text,zone,kind?,bag?}
 * ⚠️ bag 存的是「包的名字」不是 id —— 模板檔本來就沒有 id、是人可以手打的小清單 */
function cleanTplItem(it){
  it = it || {};
  var o = { text:String(it.text||""), zone:(it.zone==="checked"?"checked":"carry") };
  if(it.kind==="bag") o.kind="bag";
  else if(it.bag) o.bag=String(it.bag);
  return o;
}
/* 同 normalizePacking 的四條規則，只是父參照換成名字（server.js mirror；冪等） */
function normalizeTplItems(list){
  var items = (Array.isArray(list)?list:[]).map(cleanTplItem);
  var bagZone = {};
  items.forEach(function(i){ if(i.kind==="bag" && i.text) bagZone[i.text]=i.zone; });
  items.forEach(function(i){
    if(i.kind==="bag"){ delete i.bag; return; }
    if(i.bag && !(i.bag in bagZone)) delete i.bag;
    if(i.bag) i.zone = bagZone[i.bag];
  });
  var out=[], emitted=[];
  items.forEach(function(i,ix){
    if(i.bag) return;
    out.push(i); emitted[ix]=true;
    if(i.kind==="bag" && i.text){
      items.forEach(function(k,j){ if(!emitted[j] && k.bag===i.text){ out.push(k); emitted[j]=true; } });
    }
  });
  return out;
}
function serializeTemplate(tp){
  var L=["---","name: "+fmString(tp.name),"---","","## 項目",""];
  normalizeTplItems(tp.items).forEach(function(it){ L.push("- "+JSON.stringify(it)); });
  L.push("");
  return L.join("\n");
}
function parseTemplate(id, text){
  var tp={id:id, name:"", items:[]};
  text=String(text).replace(/\r\n/g,"\n");
  var body=text;
  var fm=/^---\n([\s\S]*?)\n---\n?/.exec(text);
  if(fm){
    fm[1].split("\n").forEach(function(line){
      var p=parseFmLine(line);
      if(p && p[0]==="name") tp.name=String(p[1]);
    });
    body=text.slice(fm[0].length);
  }
  body.split("\n").forEach(function(line){
    var im=/^-\s+(\{.*\})\s*$/.exec(line);
    if(!im) return;
    try{
      var obj=JSON.parse(im[1]);
      tp.items.push(cleanTplItem(obj));
    }catch(e){}
  });
  tp.items = normalizeTplItems(tp.items);
  return tp;
}
/* 類別清單序列化（server.js mirror；單一檔 data/categories.md） */
function cleanCategory(c){
  var o = {
    id:String((c&&c.id)||"").trim(),
    label:String((c&&c.label)||"").trim()||"未命名",
    emoji:String((c&&c.emoji)||"✨"),
    color:String((c&&c.color)||"")
  };
  if(!/^#[0-9a-fA-F]{3,8}$/.test(o.color)) o.color="#7a7265";
  if(!o.id) o.id = Date.now().toString(36)+Math.random().toString(36).slice(2,5);
  return o;
}
function normalizeCategories(list){
  var out=[], seen={};
  (Array.isArray(list)?list:[]).forEach(function(c){
    var o=cleanCategory(c);
    if(seen[o.id]) return;
    seen[o.id]=true; out.push(o);
  });
  if(!out.some(function(c){return c.id==="other";})) out.push(defaultCategories()[5]);
  return out;
}
function serializeCategories(list){
  var L=["## 類別",""];
  normalizeCategories(list).forEach(function(c){
    L.push("- "+JSON.stringify({id:c.id, label:c.label, emoji:c.emoji, color:c.color}));
  });
  L.push("");
  return L.join("\n");
}
function parseCategories(text){
  var out=[];
  String(text).replace(/\r\n/g,"\n").split("\n").forEach(function(line){
    var im=/^-\s+(\{.*\})\s*$/.exec(line);
    if(!im) return;
    try{ out.push(JSON.parse(im[1])); }catch(e){}
  });
  return normalizeCategories(out);
}
function b64EncodeUtf8(str){
  var bytes=new TextEncoder().encode(str);
  var bin="";
  for(var i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64DecodeUtf8(b64){
  return new TextDecoder().decode(Uint8Array.from(atob(String(b64).replace(/\n/g,"")), function(c){return c.charCodeAt(0);}));
}

/* ============ DataStore ============ */
var GH = { owner:"xd1104", repo:"travel-book", branch:"main" };
var IS_LOCAL = ["localhost","127.0.0.1","::1",""].indexOf(location.hostname)>=0;
var FORCE_GH = /[?&]store=github\b/.test(location.search);
var TOKEN_KEY = "travel_gh_pat";
/* key 名稱刻意不動（跟舊版完全相容）。v2.0 起多讀一個 sessionStorage：
 * 鑰匙圈解鎖時沒勾「記住這台裝置」就存那裡，關掉分頁即失效（別人的電腦用）。 */
function getToken(){
  try{ return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ""; }catch(e){ return ""; }
}
function setToken(t){ try{ localStorage.setItem(TOKEN_KEY,t); }catch(e){} }
function clearToken(){
  try{ localStorage.removeItem(TOKEN_KEY); }catch(e){}
  try{ sessionStorage.removeItem(TOKEN_KEY); }catch(e){}
}

function uiError(message){ var e=new Error(message); e.userMessage=message; return e; }

var LocalStore = {
  local:true,
  canWrite:function(){ return true; },
  loadAll:function(){
    return fetch("api/data").then(function(r){
      if(!r.ok) throw uiError("讀取資料失敗（"+r.status+"）");
      return r.json();
    }).catch(function(e){
      throw (e && e.userMessage) ? e : uiError("連不到旅途手帳伺服器（server.js 沒開？）");
    });
  },
  _post:function(path, payload, failMsg){
    return fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok, data:d}; }); })
      .then(function(x){
        if(!x.ok || !x.data || !x.data.ok) throw uiError((x.data&&x.data.message)||failMsg);
        return x.data;
      },function(){ throw uiError("連不到伺服器，"+failMsg); });
  },
  saveTrip:function(t){ return this._post("api/trips", t, "旅程儲存失敗"); },
  deleteTrip:function(id){
    return fetch("api/trips/"+encodeURIComponent(id),{method:"DELETE"}).then(function(r){
      if(!r.ok) throw uiError("刪除失敗");
    });
  },
  saveTemplate:function(tp){ return this._post("api/templates", tp, "模板儲存失敗"); },
  deleteTemplate:function(id){
    return fetch("api/templates/"+encodeURIComponent(id),{method:"DELETE"}).then(function(r){
      if(!r.ok) throw uiError("刪除模板失敗");
    });
  },
  saveCategories:function(list){ return this._post("api/categories", {categories:list}, "類別儲存失敗"); }
};

var GitHubStore = {
  local:false,
  rawBase:"https://raw.githubusercontent.com/"+GH.owner+"/"+GH.repo+"/"+GH.branch,
  apiBase:"https://api.github.com/repos/"+GH.owner+"/"+GH.repo,
  _sha:{}, /* path -> 已知 blob sha（PUT/DELETE 要帶） */
  canWrite:function(){ return !!getToken(); },

  _ghFetch:function(url, opts, needAuth){
    var headers = Object.assign(
      { Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28" },
      (opts&&opts.headers)||{});
    if(needAuth){
      var token=getToken();
      if(!token) return Promise.reject(uiError("尚未設定 GitHub 金鑰。"));
      headers.Authorization="token "+token;
    }
    var self=this;
    return fetch(url, Object.assign({},opts,{headers:headers})).then(function(res){
      if(res.ok) return res;
      return res.json().catch(function(){return {};}).then(function(body){
        var err=uiError(self._msgForStatus(res.status, body));
        err.status=res.status;
        throw err;
      });
    },function(){ throw uiError("目前離線或連不到 GitHub。"); });
  },
  _msgForStatus:function(status, body){
    if(status===401) return "GitHub 金鑰無效或已過期，請到「設定」重新貼上金鑰。";
    if(status===403) return "GitHub 金鑰權限不足：需 fine-grained PAT，授權 travel-book repo，Contents 設為 Read and write。";
    if(status===404) return "找不到資源（可能路徑錯或金鑰未授權此 repo）。";
    if(status===409) return "資料版本衝突（有其他裝置剛改過），請重試。";
    if(status===422) return "GitHub 拒絕此次寫入（"+((body&&body.message)||"格式問題")+"）。";
    return "GitHub 錯誤 "+status+"："+((body&&body.message)||"");
  },
  _listDir:function(dir, parseFn){
    var self=this;
    var hasKey=this.canWrite();
    return this._ghFetch(this.apiBase+"/contents/"+dir+"?ref="+GH.branch, {}, hasKey)
      .then(function(res){ return res.json(); })
      .catch(function(e){ if(e.status===404) return []; throw e; }) /* 資料夾還不存在 = 空 */
      .then(function(files){
        var mds=(Array.isArray(files)?files:[]).filter(function(f){ return /\.md$/.test(f.name); });
        var out=[];
        return Promise.all(mds.map(function(f){
          var pathRel=dir+"/"+f.name;
          var get;
          if(hasKey){
            /* 認證 API：即時、順便拿 sha */
            get=self._ghFetch(f.url, {}, true).then(function(r){ return r.json(); }).then(function(j){
              self._sha[pathRel]=j.sha;
              return j.content ? b64DecodeUtf8(j.content) : "";
            });
          }else{
            /* 匿名：raw CDN 會快取 -> 用 sha 當 cache-buster */
            var bust=(f.download_url.indexOf("?")>=0?"&":"?")+"t="+encodeURIComponent(f.sha);
            self._sha[pathRel]=f.sha;
            get=fetch(f.download_url+bust).then(function(r){ return r.text(); });
          }
          return get.then(function(txt){
            out.push(parseFn(f.name.replace(/\.md$/,""), txt));
          }).catch(function(){ /* 單檔壞掉就跳過 */ });
        })).then(function(){ return out; });
      });
  },
  loadAll:function(){
    var self=this;
    return Promise.all([
      self._listDir("data/trips", parseTrip),
      self._listDir("data/templates", parseTemplate),
      self._loadCategories()
    ]).then(function(r){ return { trips:r[0], templates:r[1], categories:r[2] }; });
  },
  _loadCategories:function(){
    /* 單一檔：有金鑰走認證 API（即時＋拿 sha）；無金鑰走 raw + 時間 cache-buster（唯讀、可容忍略舊） */
    var self=this;
    if(this.canWrite()){
      return this._getFile("data/categories.md")
        .then(function(f){ return f ? parseCategories(f.text) : null; })
        .catch(function(){ return null; });
    }
    return fetch(this.rawBase+"/data/categories.md?t="+Date.now())
      .then(function(r){ if(!r.ok) return null; return r.text().then(parseCategories); })
      .catch(function(){ return null; });
  },
  saveCategories:function(list){
    var pathRel="data/categories.md";
    return this._putFile(pathRel, b64EncodeUtf8(serializeCategories(list)), "mobile: update categories", this._sha[pathRel]||null);
  },
  _getFile:function(pathRel){
    var self=this;
    return this._ghFetch(this.apiBase+"/contents/"+pathRel+"?ref="+GH.branch, {}, true)
      .then(function(res){ return res.json(); })
      .then(function(j){ self._sha[pathRel]=j.sha; return {sha:j.sha, text:j.content?b64DecodeUtf8(j.content):""}; })
      .catch(function(e){ if(e.status===404){ delete self._sha[pathRel]; return null; } throw e; });
  },
  _putFile:function(pathRel, contentB64, message, sha){
    var self=this;
    var body={ message:message, content:contentB64, branch:GH.branch };
    if(sha) body.sha=sha;
    return this._ghFetch(this.apiBase+"/contents/"+pathRel, {method:"PUT", body:JSON.stringify(body)}, true)
      .then(function(res){ return res.json(); })
      .then(function(j){ if(j&&j.content) self._sha[pathRel]=j.content.sha; return j; })
      .catch(function(e){
        if(e.status===409||e.status===422){
          /* sha 過期或缺 sha（檔案已存在）：重取 sha 再試一次，last-write-wins */
          return self._getFile(pathRel).then(function(cur){
            body.sha=cur?cur.sha:undefined;
            return self._ghFetch(self.apiBase+"/contents/"+pathRel, {method:"PUT", body:JSON.stringify(body)}, true)
              .then(function(res){ return res.json(); })
              .then(function(j){ if(j&&j.content) self._sha[pathRel]=j.content.sha; return j; });
          });
        }
        throw e;
      });
  },
  _deleteFile:function(pathRel, message){
    var self=this;
    var doDelete=function(sha){
      if(!sha) return Promise.resolve(); /* 檔案本來就不在 */
      return self._ghFetch(self.apiBase+"/contents/"+pathRel,
        {method:"DELETE", body:JSON.stringify({message:message, sha:sha, branch:GH.branch})}, true)
        .then(function(){ delete self._sha[pathRel]; });
    };
    if(this._sha[pathRel]) {
      return doDelete(this._sha[pathRel]).catch(function(){
        /* sha 過期 -> 重取再刪一次 */
        return self._getFile(pathRel).then(function(cur){ return doDelete(cur?cur.sha:null); });
      });
    }
    return this._getFile(pathRel).then(function(cur){ return doDelete(cur?cur.sha:null); });
  },
  saveTrip:function(t){
    var pathRel="data/trips/"+t.id+".md";
    t.updatedAt=new Date().toISOString();
    if(!t.createdAt) t.createdAt=t.updatedAt;
    return this._putFile(pathRel, b64EncodeUtf8(serializeTrip(t)), "mobile: save "+t.name, this._sha[pathRel]||null);
  },
  deleteTrip:function(id){
    return this._deleteFile("data/trips/"+id+".md", "mobile: delete trip "+id);
  },
  saveTemplate:function(tp){
    var pathRel="data/templates/"+tp.id+".md";
    return this._putFile(pathRel, b64EncodeUtf8(serializeTemplate(tp)), "mobile: save template "+tp.name, this._sha[pathRel]||null);
  },
  deleteTemplate:function(id){
    return this._deleteFile("data/templates/"+id+".md", "mobile: delete template "+id);
  }
};

var STORE = (IS_LOCAL && !FORCE_GH) ? LocalStore : GitHubStore;

/* ============ 鑰匙圈解鎖（v2.0） ============
 * 手機／別人的電腦不用再貼一長串 PAT：每個人一組密碼，任何裝置輸一次就能編輯。
 * 金鑰的密文放在公開的 keyring repo，解開後照樣寫進既有的 travel_gh_pat，
 * 所以 GitHubStore 完全不用改。模組正本在 keyring/client/keyring-unlock.js，
 * 這個 repo 裡的 keyring-unlock.js 由 keyring 的 sync-unlock.yml 自動同步過來——別手改。
 * 「設定→貼金鑰」入口刻意保留：萬一鑰匙圈壞掉，還能手動貼一把救回來。 */
var KR = (typeof Keyring !== "undefined") ? Keyring : null;
var KR_ON = !!KR && !STORE.local;
if(KR){
  KR.init({
    enabled: KR_ON,
    appId: "travel-book",
    tokenKey: TOKEN_KEY,
    toast: function(msg, isErr){ toast(msg, isErr); },
    /* 解鎖／換人／後台換了金鑰 -> 重新載入（有金鑰走認證 API，沒金鑰退回唯讀） */
    onChange: function(){ if(booted) reloadData(); }
  });
}

/* ============ 持久化（樂觀更新：畫面先動，背景寫入，失敗才 toast） ============ */
var persistChains = {}; /* 同一份檔案的寫入排隊，避免並發互蓋 */
function chainPersist(key, job){
  var run=function(){
    return job().catch(function(e){
      toast("儲存失敗："+(e.userMessage||e.message||""), true);
    });
  };
  persistChains[key]=(persistChains[key]||Promise.resolve()).then(run);
  return persistChains[key];
}
function persistTrip(t){
  if(!t) return Promise.resolve();
  return chainPersist("trip:"+t.id, function(){ return STORE.saveTrip(t); });
}
function persistTemplate(tp){
  if(!tp) return Promise.resolve();
  return chainPersist("tpl:"+tp.id, function(){ return STORE.saveTemplate(tp); });
}
function persistCategories(){
  return chainPersist("cats", function(){ return STORE.saveCategories(db.categories); });
}

/* 唯讀守門（Pages 無金鑰）
 * v2.0：不再只丟 toast 叫他自己回首頁找「設定」——直接把解鎖 sheet 端到他面前，
 * 並帶上理由條（reason ＝ 他剛剛想做的事，例如「規劃新旅程」）。 */
function requireWrite(reason){
  if(STORE.canWrite()) return true;
  if(KR_ON){ KR.open(reason||""); return false; }
  toast("唯讀模式：到下方「設定」貼上金鑰才能編輯", true);
  return false;
}

/* ============ 資料 + 舊資料遷移（冪等） ============ */
var db = { trips:[], templates:[], categories:defaultCategories() };
function migrate(d){
  if(!d) d={};
  if(!Array.isArray(d.trips)) d.trips=[];
  if(!Array.isArray(d.templates)) d.templates=[];
  d.templates.forEach(function(tp){ tp.items = normalizeTplItems(tp.items); });
  /* 類別：來源沒有（舊資料/Pages 上檔案還沒建）就用內建六類；並保證「其他」存在 */
  d.categories = (Array.isArray(d.categories) && d.categories.length)
    ? normalizeCategories(d.categories) : defaultCategories();
  d.trips.forEach(function(t){
    if(!t.itinerary) t.itinerary={};
    if(!Array.isArray(t.expenses)) t.expenses=[];
    if(!Array.isArray(t.packing)) t.packing=[];
    if(t.notes==null) t.notes="";
    /* 舊資料沒分區 -> 歸隨身；v2.9 起順便把包的參照補正（壞掉的 bag 降級成頂層） */
    t.packing = normalizePacking(t.packing);
  });
  return d;
}

/* ============ UI 狀態 ============ */
var ui = { screen:"home", tripId:null, tab:"plan", day:1, edit:false, showEnded:false,
  /* 打包分頁（v2.9）：open＝哪些包展開著、filter＝只看沒打包的、adding＝就地新增中的容器 */
  pk: { open:{}, filter:{checked:false, carry:false}, adding:null, pending:"" } };
function curTrip(){
  for(var i=0;i<db.trips.length;i++) if(db.trips[i].id===ui.tripId) return db.trips[i];
  return null;
}
function curList(){
  var t=curTrip(); if(!t) return null;
  return t.itinerary[String(ui.day)] || null;
}

/* ============ Render ============ */
var appEl = document.getElementById("app");
function render(keepScroll){
  var y = keepScroll ? window.scrollY : 0;
  appEl.innerHTML = (ui.screen==="home") ? viewHome() : viewTrip();
  window.scrollTo(0, y);
  pkAfterRender();   /* 打包的就地新增：render 之後把輸入框的內容與 focus 接回來 */
}

/* ---- 首頁（進行中/未出發 主區 + 旅行回憶歸檔卡） ---- */
function tripCard(t){
  var st = tripStatus(t);
  return '<button class="trip-card" onclick="openTrip(\''+t.id+'\')">'
    + '<div class="cover" style="background:'+(THEMES[t.theme]||THEMES.sunset)+'">'
    +   '<span class="cover-emoji">'+esc(t.emoji)+'</span>'
    +   '<div class="cover-txt"><h2>'+esc(t.name)+'</h2><div>'+esc(t.dest)+'</div></div>'
    + '</div>'
    + '<div class="trip-meta"><span>'+tripRange(t)+'・'+t.days+' 天</span>'
    + '<span class="count-chip '+st.cls+'">'+st.text+'</span></div>'
    + '</button>';
}
/* 版本那顆按鈕：平常顯示版本號，偵測到新版就改口成「點一下更新」並轉成琥珀色。
 * 電腦版沒有「設定」入口，所以版本放 footer（兩邊都看得到）。 */
function verBtn(){
  return updateReady
    ? '<button class="ver-btn hot" onclick="openVersion()">🎉 有新版本・點一下更新</button>'
    : '<button class="ver-btn" onclick="openVersion()">v'+APP_VER+'</button>';
}
function homeFoot(){
  if(STORE.local){
    return '<footer class="home-foot">資料存在這台電腦，並自動同步到 GitHub　'
      + verBtn()+'</footer>';
  }
  /* 第一行＝身分藥丸（誰在用／點我解鎖），第二行才是原本的 footer 連結。
   * 身分放這裡不放頂部：旅程頁的 header 是旅程封面，塞身分會搶主體。 */
  var chip = KR_ON
    ? KR.chipHtml()
    : '<span class="foot-mode">'+(STORE.canWrite()?"已連線 GitHub・可編輯":"唯讀模式・貼上金鑰即可編輯")+'</span>';
  return '<footer class="home-foot">'+chip
    + '<div class="foot-links">'
    +   '<button onclick="openSettings()">設定</button>'
    +   '<button onclick="reloadData()">重新整理</button>'
    +   verBtn()
    + '</div></footer>';
}
function viewHome(){
  var today=new Date(); today.setHours(0,0,0,0);
  var act=[], past=[];
  db.trips.forEach(function(t){ (tripEnd(t)<today ? past : act).push(t); });
  act.sort(function(a,b){ return a.start<b.start?-1:1; });   /* 快出發的在上 */
  past.sort(function(a,b){ return a.start>b.start?-1:1; });  /* 最近結束的在上 */
  var actHtml;
  if(act.length){
    actHtml = act.map(function(t){return tripCard(t);}).join("");
  }else{
    actHtml = '<div class="empty slim"><div class="big">🌱</div>'
      + '<p>'+(past.length?"目前沒有進行中或即將出發的旅程，<br>來規劃下一趟吧":"還沒有任何旅程，<br>從下面開始規劃第一趟吧")+'</p></div>';
  }
  var endedHtml = "";
  if(past.length){
    endedHtml = '<section class="ended-sec"><div class="mem-card">'
      + '<button class="mem-head" onclick="toggleEnded()" aria-expanded="'+(ui.showEnded?"true":"false")+'">'
      +   '<span class="mem-title">📔 旅行回憶</span><span class="mem-count">'+past.length+'</span>'
      +   '<span class="mem-chev'+(ui.showEnded?" up":"")+'" id="mem-chev">▾</span></button>'
      + '<div class="ended-wrap'+(ui.showEnded?" open":"")+'" id="ended-wrap"><div class="ended-inner">'
      +   past.map(memRow).join("")
      + '</div></div>'
      + '</div></section>';
  }
  return ''
    + '<header class="home-head">'
    +   '<div class="home-eyebrow">TRAVEL PLANNER</div>'
    +   '<h1>旅途手帳</h1><p>把每一趟旅行，收進口袋 🧳</p>'
    + '</header>'
    + '<main class="home-list">'+actHtml
    +   '<button class="add-trip" onclick="openTripSheet()">＋ 規劃新旅程</button>'
    + '</main>'
    + endedHtml
    + homeFoot();
}
function memRow(t){
  var s = parseDate(t.start);
  var spent = spentOf(t);
  return '<button class="mem-row" onclick="openTrip(\''+t.id+'\')">'
    + '<span class="mem-emoji" style="background:'+(THEMES[t.theme]||THEMES.sunset)+'">'+esc(t.emoji)+'</span>'
    + '<span class="mem-mid"><b>'+esc(t.name)+'</b>'
    +   '<span>'+s.getFullYear()+'/'+(s.getMonth()+1)+'/'+s.getDate()+'・'+t.days+' 天</span></span>'
    + '<span class="mem-right">'+(spent?money(spent):"")+'<i>›</i></span>'
    + '</button>';
}
function toggleEnded(){
  ui.showEnded = !ui.showEnded;
  /* 就地切 class 讓收合有過渡動畫；找不到節點才退回整頁重繪 */
  var w = document.getElementById("ended-wrap");
  var c = document.getElementById("mem-chev");
  if(w && w.classList && typeof w.classList.toggle==="function"){
    w.classList.toggle("open", ui.showEnded);
    if(c) c.classList.toggle("up", ui.showEnded);
  }else{
    render(true);
  }
}

/* ---- 旅程頁骨架 ---- */
function viewTrip(){
  var t = curTrip(); if(!t){ ui.screen="home"; return viewHome(); }
  if(ui.day > t.days) ui.day = t.days;
  var st = tripStatus(t);
  var body = ui.tab==="plan" ? viewPlan(t)
           : ui.tab==="budget" ? viewBudget(t)
           : ui.tab==="pack" ? viewPack(t)
           : viewNotes(t);
  var fab = "";
  if(ui.tab==="plan")   fab = '<button class="fab" onclick="openAddPicker()" aria-label="新增行程點或移動">＋</button>';
  if(ui.tab==="budget") fab = '<button class="fab" onclick="openExpenseSheet()" aria-label="記一筆花費">＋</button>';
  function tabBtn(id, ico, label){
    return '<button class="'+(ui.tab===id?"on":"")+'" onclick="setTab(\''+id+'\')">'
      + '<span class="ico">'+ico+'</span>'+label+'</button>';
  }
  return ''
    + '<header class="trip-head" style="background:'+(THEMES[t.theme]||THEMES.sunset)+'">'
    +   '<div class="head-top">'
    +     '<button class="back-btn" onclick="goHome()">‹ 我的旅程</button>'
    +     '<button class="head-edit" onclick="openTripSheet(\''+t.id+'\')">✎ 編輯</button>'
    +   '</div>'
    +   '<div class="trip-title"><span class="emo">'+esc(t.emoji)+'</span><h1>'+esc(t.name)+'</h1></div>'
    +   '<div class="trip-sub">'+tripRange(t)+'・'+t.days+' 天・'+st.text+'</div>'
    + '</header>'
    + '<div class="tab-body">'+body+'</div>'
    + fab
    + '<nav class="tabbar">'
    +   tabBtn("plan","🗓️","行程") + tabBtn("budget","💰","花費")
    +   tabBtn("pack","🎒","打包") + tabBtn("notes","📝","備註")
    + '</nav>';
}

/* ---- 逐日行程 ---- */
function viewPlan(t){
  var s = parseDate(t.start);
  var chips = "";
  for(var i=1;i<=t.days;i++){
    var d = addDays(s,i-1);
    chips += '<button class="day-chip '+(ui.day===i?"on":"")+'" onclick="setDay('+i+')">'
      + '<b>Day '+i+'</b><span>'+fmtMD(d)+' 週'+WD[d.getDay()]+'</span></button>';
  }
  var list = t.itinerary[String(ui.day)] || [];
  /* v2.8：先算「哪幾站來不及」——只有負的差（來不及）進得來，空檔不標（見 lateSet） */
  var late = lateSet(list);
  var lateKeys = Object.keys(late);
  var items;
  if(!list.length){
    items = '<div class="empty"><div class="big">🌤️</div>'
      + '<p>Day '+ui.day+' 還是空白的，<br>想到什麼就先丟進來吧</p>'
      + '<button class="btn-primary" onclick="openStopSheet()">＋ 加入第一個行程點</button></div>';
  }else{
    items = list.map(function(sp, idx){
      var c = CATS[sp.cat] || CATS.other;
      /* v2.8 rail：接不上的那一段線轉琥珀（零高度成本，捲動時一眼掃得到接不上的位置） */
      var nextLate = late[idx+1] ? " to-late" : "";
      var right;
      if(ui.edit){
        right = '<span class="stop-tools">'
          + '<button class="tool-btn danger" onclick="delStop('+idx+')" aria-label="刪除">✕</button>'
          + '<button class="drag-handle" aria-label="拖曳排序" oncontextmenu="return false"'
          + ' onpointerdown="dragStart(event,'+idx+')" onpointermove="dragMove(event)"'
          + ' onpointerup="dragEnd(event)" onpointercancel="dragCancel(event)">☰</button>'
          + '</span>';
      }
      /* v1.3 移動：灰色輕薄一條，內容只有備註＋時間；rail 用小空心點＋虛線＝「路上」不是站點 */
      if(isTransit(sp)){
        var parts = [];
        if(sp.note) parts.push(esc(sp.note));
        if(sp.stayMinutes) parts.push(formatStay(sp.stayMinutes));
        var txt = parts.join("・") || "移動";
        /* v2.4 路線鈕：上下兩站都算得出地址才長出來（調整模式不顯示，跟卡片的 .map-btn 一致） */
        var dir = ui.edit ? "" : routeLink(list, idx);
        return '<div class="stop transit">'
          + '<div class="rail"><span class="dot mini"></span><span class="ln dash'+nextLate+'"></span></div>'
          + '<div class="transit-bar'+(ui.edit?"":" tappable")+'"'
          +   (ui.edit?"":' onclick="openTransitEdit('+idx+')"')+'>'
          +   '<span class="tr-ico">🚶</span><span class="tr-txt">'+txt+'</span>'
          +   (dir ? '<a class="map-btn" href="'+esc(dir)+'" target="_blank" rel="noopener"'
                   + ' onclick="event.stopPropagation()" aria-label="看這一段路線">'+ICO.route+'</a>' : "")
          +   (ui.edit ? right : '')
          + '</div></div>';
      }
      if(!ui.edit){
        var href = mapLink(sp);
        right = href ? '<a class="map-btn" href="'+esc(href)+'" target="_blank" rel="noopener"'
          + ' onclick="event.stopPropagation()" aria-label="在地圖上看這個地點">'+ICO.pin+'</a>' : "";
      }
      var tap = ui.edit ? "" : ' onclick="openStopDetail('+idx+')"';
      /* v2.8 銜接條（樣式 A，Benson 拍板）：卡片頂端一行 hairline，是「這張卡的狀態」不是按鈕。
       * 語氣是提醒不是錯誤（琥珀＝沿用「有新版本」那套語言，刻意不用 --bad）。
       * 調整模式不顯示：它會改變卡片高度、干擾拖曳的讓位計算。 */
      var g = late[idx];
      var gapNote = (g && !ui.edit)
        ? '<button type="button" class="gap-note" onclick="event.stopPropagation();openReplan('+idx+')">'
          + '<i></i><span>晚 <b>'+formatStay(g.gap)+'</b>・'+timeOf(g.arrive)+' 才到得了</span>'
          + '<span class="gn-go">重新排 ›</span></button>'
        : "";
      return '<div class="stop">'
        + '<div class="rail"><span class="dot'+(g?" is-late":"")+'" style="background:'+c.color+'"></span><span class="ln'+nextLate+'"></span></div>'
        + '<div class="stop-card'+(ui.edit?"":" tappable")+'"'+tap+'>'
        +   gapNote
        +   '<div class="stop-top">'+timeHtml(sp)
        +     '<span class="cat-pill" style="color:'+c.color+'; background:'+c.color+'1a">'+c.emoji+' '+c.label+'</span>'
        +     right + '</div>'
        +   '<div class="stop-name">'+esc(sp.title)+'</div>'
        +   (sp.place ? '<div class="stop-place">📍 '+esc(sp.place)+'</div>' : "")
        +   (sp.note ? '<div class="stop-note">'+esc(sp.note)+'</div>' : "")
        + '</div></div>';
    }).join("");
  }
  /* v2.8 Day 層級摘要＋重排入口：只有這一天真的接不上時才長出來（它是「工具」，所以才給底色與 ≥52px） */
  var fix = "";
  if(lateKeys.length){
    var i0 = +lateKeys[0];
    var sub = esc(list[i0].title)+" 晚 "+formatStay(late[i0].gap);
    if(lateKeys.length>1) sub += "，還有 "+(lateKeys.length-1)+" 處";
    fix = '<button type="button" class="fix-bar" onclick="openReplan('+i0+')">'
      + '<span class="fx-dot"></span>'
      + '<span class="fx-tx"><b>這一天有 '+lateKeys.length+' 處銜接不上</b><span>'+sub+'</span></span>'
      + '<span class="fx-go">重新排 ›</span></button>';
  }
  /* v3.3：這一天花了多少。**沒花錢就整條不顯示**（0 元不是資訊，只是噪音），
     調整模式也不顯示（跟銜接條同一個理由：會改動 timeline 上方的高度、干擾拖曳讓位）。 */
  var dS = spentOfDay(t, ui.day);
  /* 這天還有沒付的 ⇒ 講「要花」（規劃期）；全部付掉了 ⇒ 講「花了」（記帳期）。 */
  var spendBar = (dS.all>0 && !ui.edit)
    ? '<button type="button" class="day-spend" onclick="setTab(\'budget\')">'
      + '<span class="ds-l">'+(dS.plan>0 ? "這天要花" : "這天花了")+'</span><b>'+money(dS.all)+'</b>'
      + (dS.plan>0 && dS.paid>0 ? '<span class="ds-sub">已付 '+money(dS.paid)+'</span>' : "")
      + '<span class="ds-go">看花費 ›</span></button>'
    : "";
  return '<div class="day-bar"><div class="day-chips">'+chips+'</div>'
    + '<button class="edit-toggle '+(ui.edit?"on":"")+'" onclick="toggleEdit()">'+(ui.edit?"完成":"調整")+'</button></div>'
    + spendBar
    + fix
    + '<div class="timeline" id="timeline">'+items+'</div>';
}

/* ---- 拖曳排序（pointer events，零依賴；正式版加：長清單邊緣自動捲動） ----
 * 座標一律用 page 座標（clientY + scrollY），自動捲動時位置才不會亂 */
var drag = null;
function dragStart(ev, idx){
  if(drag) return;
  ev.preventDefault();
  try{ ev.currentTarget.setPointerCapture(ev.pointerId); }catch(e){}
  var box = document.getElementById("timeline");
  if(!box) return;
  var items = [].slice.call(box.children);
  var el = items[idx]; if(!el) return;
  var gap = 12;
  if(items.length>1){
    var a=items[0].getBoundingClientRect(), b=items[1].getBoundingClientRect();
    gap = Math.max(0, b.top - a.bottom);
  }
  var sy = window.scrollY;
  var rects = items.map(function(it){ return it.getBoundingClientRect(); });
  /* 每項「實際佔用高度」（到下一項頂端的距離，含間距）——stop 白卡與 transit 灰條高度差很多，
   * 讓位動畫若統一用被拖項高度會過衝，所以逐項記錄、dragUpdate 依重排後位置算位移 */
  var sizes = rects.map(function(r,i){
    return (i < rects.length-1) ? (rects[i+1].top - r.top) : (r.height + gap);
  });
  var tops = [], acc = 0;
  sizes.forEach(function(h){ tops.push(acc); acc += h; });
  drag = { idx:idx, cur:idx, pageY0:ev.clientY+sy, lastClientY:ev.clientY, el:el, items:items,
           sizes:sizes, tops:tops, raf:0 };
  el.classList.add("dragging");
  items.forEach(function(it,i){ if(i!==idx) it.classList.add("drag-anim"); });
}
function dragUpdate(){
  if(!drag) return;
  var dy = (drag.lastClientY + window.scrollY) - drag.pageY0;
  drag.el.style.transform = "translateY("+dy+"px)";
  /* 落點判定：把「被拖項目前的頂端」對到「插入第 j 格時該有的頂端」，取最接近的 j。
   * 高度混合（白卡 vs 灰條）時，用原始中心點比較會晚一步交換＝視覺過衝，這裡用實際高度累加就準 */
  var others = [];
  for(var k=0;k<drag.items.length;k++) if(k!==drag.idx) others.push(k);
  var prefix = [0];
  for(var m=0;m<others.length;m++) prefix.push(prefix[m] + drag.sizes[others[m]]);
  var curTop = drag.tops[drag.idx] + dy;
  var newIdx = 0, bestD = Infinity;
  for(var j=0;j<prefix.length;j++){
    var dd = Math.abs(prefix[j] - curTop);
    if(dd < bestD){ bestD = dd; newIdx = j; }
  }
  drag.cur = newIdx;
  /* 依「被拖項插到 newIdx 之後」的重排順序，算每一項的目標位置 - 原位置＝該項位移 */
  var order = others.slice();
  order.splice(newIdx, 0, drag.idx);
  var newTop = {}, acc2 = 0;
  for(var n=0;n<order.length;n++){ newTop[order[n]] = acc2; acc2 += drag.sizes[order[n]]; }
  drag.items.forEach(function(it,i){
    if(i===drag.idx) return;
    var tr = newTop[i] - drag.tops[i];
    it.style.transform = tr ? "translateY("+tr+"px)" : "";
  });
}
function dragAutoScroll(){
  /* 手指靠近視窗上下邊緣時自動捲動（rAF 迴圈；離開邊緣或放手即停） */
  if(!drag || drag.raf) return;
  var TH=80, SPEED=9;
  var step=function(){
    if(!drag){ return; }
    var y=drag.lastClientY, vh=window.innerHeight;
    var dir = y<TH ? -1 : (y>vh-TH ? 1 : 0);
    if(!dir){ drag.raf=0; return; }
    window.scrollBy(0, dir*SPEED);
    dragUpdate();
    drag.raf=requestAnimationFrame(step);
  };
  drag.raf=requestAnimationFrame(step);
}
function dragMove(ev){
  if(!drag) return;
  ev.preventDefault();
  drag.lastClientY = ev.clientY;
  dragUpdate();
  dragAutoScroll();
}
function dragEnd(ev){
  if(!drag) return;
  if(drag.raf) cancelAnimationFrame(drag.raf);
  var from = drag.idx, to = drag.cur;
  drag = null;
  var list = curList();
  if(list && to!==from && to>=0 && to<list.length){
    var it = list.splice(from,1)[0];
    list.splice(to,0,it);
    persistTrip(curTrip());
  }
  render(true);
}
function dragCancel(ev){
  if(!drag) return;
  if(drag.raf) cancelAnimationFrame(drag.raf);
  drag = null;
  render(true);
}

/* ---- v2.8 重新排：預覽（差異清單）→ 他按「就這樣排」才套用 ----
 * 鐵律：這是他的真行程，**一定要先預覽**，按了「先不要」什麼都不動（連 persist 都不會發生）。
 * 預覽方式＝差異清單（Benson 拍板）：列出哪幾筆會變、從幾點變幾點，並講清楚哪段空檔被吃掉多少。 */
var rp = null; /* {startIdx, scope:'break'|'day'} */
function shortName(t){ t=String(t||""); return t.length>7 ? t.slice(0,7)+"…" : t; }
function openReplan(idx){
  if(!requireWrite("重新排這一天")) return;
  var list = curList()||[];
  var first = firstLateIdx(list);
  if(first<0){ toast("這一天的時間都接得上"); return; }
  var start = (idx>=0 && idx<list.length && !isTransit(list[idx])) ? idx : first;
  rp = { startIdx:start, scope:"break" };
  drawReplanSheet();
}
function replanNow(){
  var list = curList()||[];
  return replanDay(list, rp.scope==="day" ? 0 : rp.startIdx);
}
function setReplanScope(s){ if(!rp) return; rp.scope = s; drawReplanSheet(); }
function drawReplanSheet(){
  var list = curList()||[];
  var r = replanNow();
  var bufs = bufferDiff(list, r.newT);
  var late = lateSet(list), lateKeys = Object.keys(late);
  if(!lateKeys.length){ closeSheet(); return; }
  var i0 = late[rp.startIdx] ? rp.startIdx : +lateKeys[0];

  var why = '<div class="rp-why">'
    + 'Day '+ui.day+' 的 <b>'+esc(list[i0].title)+'</b> 排在 '+esc(list[i0].time)
    + '，但照前面的停留＋移動走，<b>'+timeOf(late[i0].arrive)+'</b> 才到得了。<br>'
    + '重新排＝從這一站起，只把來不及的往後挪，<b>你刻意留的空檔會留著</b>。</div>';

  var scope = '<div class="rp-scope">'
    + '<button type="button" class="'+(rp.scope==="break"?"on":"")+'" onclick="setReplanScope(\'break\')">從「'
    +   esc(shortName(list[rp.startIdx].title))+'」起</button>'
    + '<button type="button" class="'+(rp.scope==="day"?"on":"")+'" onclick="setReplanScope(\'day\')">整天重排</button></div>';

  var rows;
  if(r.changes.length){
    rows = '<div class="rp-sec">會變動的 '+r.changes.length+' 筆</div>'
      + r.changes.map(function(ch){
          return '<div class="rp-row"><span class="rp-nm">'+esc(ch.title)+'</span>'
            + '<span class="rp-tm"><s>'+esc(ch.from||"—")+'</s><i>→</i><b>'+esc(ch.to)+'</b></span>'
            + '<span class="rp-dl">+'+ch.delta+'</span></div>';
        }).join("");
  }else{
    rows = '<div class="rp-sec">沒有東西需要變動</div>';
  }

  var stopCount = list.filter(function(s){ return !isTransit(s); }).length;
  var same = stopCount - r.changes.length;
  var sameLine = same>0 ? '<div class="rp-same">其他 '+same+' 筆時間不動。</div>' : "";

  var bufHtml = "";
  if(bufs.length){
    bufHtml = '<div class="rp-sec">你留的空檔</div><div class="rp-buf"><span>🫧</span><div>'
      + bufs.map(function(b){
          return '<b>'+esc(b.title)+'</b> 前面的空檔　'+formatStay(b.from)+' → '
            + (b.to>0 ? formatStay(b.to) : "沒了");
        }).join("<br>")
      + '<br><span class="rp-dim">延誤被這段空檔吸收掉了，後面不用整串往後推。</span>'
      + '</div></div>';
  }

  openSheet("重新排 Day "+ui.day, why + scope + rows + sameLine + bufHtml
    + '<div class="rp-acts">'
    +   '<button type="button" class="btn-ghost" onclick="closeSheet()">先不要</button>'
    +   '<button type="button" class="btn-primary" onclick="applyReplan()">'+(r.changes.length?"就這樣排":"知道了")+'</button>'
    + '</div>');
}
function applyReplan(){
  if(!requireWrite("重新排這一天")) return;
  if(!rp) return;
  var list = curList()||[];
  var r = replanNow();
  var n = r.changes.length;
  for(var i=0;i<list.length;i++) if(r.newT[i]) list[i].time = r.newT[i];
  rp = null;
  if(n) persistTrip(curTrip());
  closeSheet(); render(true);
  toast(n ? ("已重排・"+n+" 筆時間換過了") : "本來就接得上，沒有動任何時間");
}

/* ---- 行程點詳細（檢視 / 編輯） ---- */
function openStopDetail(idx){
  var list=curList()||[]; var sp=list[idx]; if(!sp) return;
  var c = CATS[sp.cat] || CATS.other;
  function row(ic,label,valHtml){
    return '<div class="d-row"><span class="d-ic">'+ic+'</span>'
      + '<div class="d-bd"><div class="d-lb">'+label+'</div><div class="d-v">'+valHtml+'</div></div></div>';
  }
  var rows = "";
  if(sp.place) rows += row("📍","地點",esc(sp.place));
  if(sp.stayMinutes) rows += row("⏱️","預計停留",esc(formatStay(sp.stayMinutes)));
  /* 「預估費用」v3.5 起不顯示（資料仍保留在檔案裡，比照下面的 bookingRef）：
     它從來沒有任何地方加總，等於填了也算不出東西——Benson 真實資料一筆都沒填過。
     預估花費統一走花費頁的「預計」（`plan`），**不要讓兩個地方都能填錢**，
     否則兩邊加起來不一樣，而且沒有人說得出哪個才算數。 */
  /* 訂位／票券代號欄位 v1.1 起不顯示（資料仍保留在檔案裡） */
  if(sp.phone) rows += row("📞","電話",'<a href="tel:'+esc(String(sp.phone).replace(/[^+\d]/g,""))+'">'+esc(sp.phone)+"</a>");
  if(sp.url)   rows += row("🔗","官網／參考",'<a href="'+esc(extUrl(sp.url))+'" target="_blank" rel="noopener">'+esc(sp.url)+"</a>");
  var ht = hoursText(sp);
  if(ht) rows += row("🕘","營業時間",esc(ht));
  if(sp.note)  rows += row("📝","備註",esc(sp.note).replace(/\n/g,"<br>"));
  if(!rows) rows = '<p class="d-empty">還沒有詳細資訊，點下面「編輯」補上</p>';
  var href = mapLink(sp);
  openSheet(esc(sp.title),
    '<div class="d-meta"><span class="day-tag">Day '+ui.day+'</span>'
    + (sp.time ? timeHtml(sp) : "")
    + '<span class="cat-pill" style="color:'+c.color+'; background:'+c.color+'1a">'+c.emoji+' '+c.label+'</span></div>'
    + rows
    + '<div class="d-acts">'
    + (href ? '<a class="btn-ghost" href="'+esc(href)+'" target="_blank" rel="noopener">'+ICO.pin+' 開啟 Google 地圖</a>' : "")
    + '<button class="btn-primary" onclick="openStopEdit('+idx+')">✎ 編輯</button>'
    + '</div>');
}
function toggleHours24(cb){
  var f = cb.form;
  f.hoursOpen.disabled = cb.checked;
  f.hoursClose.disabled = cb.checked;
}

/* ---- v2.6 地圖連結欄（DESIGN.md 附錄 A2 方案 A，Benson 拍板；別退回普通 input）----
 * 欄位顯示的是**地址（addr）不是網址**：那串短網址人看不懂，手機上還要先刪光才貼得進去。
 * 三個狀態：① 沒連結＝虛線「貼上 Google 地圖連結」② 有連結有 addr＝地址卡
 *          ③ 有連結但 addr 還沒補上＝「已連結，地址整理中…」（見下方說明，這是正常狀態不是壞掉）
 * 值的載體是隱藏的 <input name="mapUrl">，所以兩張表單的 submit 讀法（f.mapUrl.value）一行都不用改。
 * 新增／編輯**共用這一個元件**，不要複製第二份 UI。
 * ⚠️ 前端永遠不自己寫 addr（短連結只有 server／CI 展得開），UI 只負責顯示與清空。 */
var MF = { url:"", addr:"", editing:false };
function isMapUrl(s){
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)/i.test(String(s||"").trim());
}
function hostOf(u){ return String(u||"").split("/")[2] || ""; }
/* 表單開場時呼叫一次；sp 傳 null＝新增行程點（開場就是狀態 ①） */
function mapField(sp){
  MF.url = String((sp && sp.mapUrl) || "");
  MF.addr = String((sp && sp.addr) || "");
  MF.editing = false;
  return '<div class="mapf" id="mapf">'+mapfInner()+'</div>';
}
function mapfInner(){
  var h = '<span class="fl">Google 地圖</span>'
    + '<input type="hidden" name="mapUrl" value="'+esc(MF.url)+'">';
  if(MF.editing){
    h += '<div class="m-edit">'
      +    '<input id="mfIn" type="text" inputmode="url" value="'+esc(MF.url)+'"'
      +    ' placeholder="貼上地圖分享連結" autocomplete="off" oninput="mapfType(this.value)">'
      +    '<button type="button" class="m-done" onclick="mapfDone()">完成</button>'
      +  '</div>'
      +  '<div class="hint">整串已經幫你選起來了，直接長按貼上就會蓋掉舊的。</div>';
  }else if(!MF.url){
    h += '<button type="button" class="m-empty" onclick="mapfPaste()">'+ICO.paste+' 貼上 Google 地圖連結</button>'
      +  '<div class="hint">沒有連結也沒關係，會用上面的「地點」文字去搜尋。</div>';
  }else{
    /* 狀態 ③：mapUrl 有了、addr 還沒有。展開短連結只有 server／CI 做得到，
     * 手機端存檔後要等 GitHub Actions 跑完（約一分鐘）才會長出地址；
     * 路線型短連結（maps/dir/?geocode=）則永遠展不開（CLAUDE.md 已知缺口）。
     * 所以文案刻意中性、不寫「失敗」，也不能留白看起來像壞掉。 */
    var pend = !MF.addr;
    h += '<div class="mlink'+(pend?" pending":"")+'">'
      +    '<span class="mp">'+ICO.pin+'</span>'
      +    '<span class="mb">'
      +      '<span class="maddr">'+(pend ? "已連結，地址整理中…" : esc(MF.addr))+'</span>'
      +      '<span class="msub">'+(pend ? "存檔後由伺服器把連結換成地址，大約一分鐘" : esc(hostOf(MF.url))+" 連結")+'</span>'
      +    '</span>'
      +  '</div>'
      +  '<div class="mlink-acts">'
      +    '<button type="button" class="m-paste" onclick="mapfPaste()">'+ICO.paste+' 貼上新連結</button>'
      +    '<button type="button" class="m-clear" onclick="mapfClear()" aria-label="清除連結">✕</button>'
      +  '</div>'
      +  '<button type="button" class="m-manual" onclick="mapfManual()">手動編輯連結</button>';
  }
  return h;
}
function mapfDraw(){
  var box = document.getElementById("mapf"); if(!box) return;
  box.innerHTML = mapfInner();
  if(MF.editing){
    var el = document.getElementById("mfIn");
    /* iOS 用 setSelectionRange 不要用 select()，而且要在同一個 user gesture 的 tick 內 */
    if(el){ el.focus(); try{ el.setSelectionRange(0, el.value.length); }catch(e){} }
  }
}
/* ★ mapUrl 一有變動（含清空）就把 addr 清掉——addr 是 mapUrl 的衍生值，
 *   留著舊地址＝移動那條的路線鈕會用錯的起訖點。
 *   清除的時機刻意在「按下貼上／✕ 的當下」，不是等到存檔（畫面立刻反映）。 */
function mapfPut(url){ MF.url = String(url||"").trim(); MF.addr = ""; }
function mapfType(v){
  var el = document.querySelector("#mapf input[name=mapUrl]");
  if(String(v||"").trim() !== MF.url) mapfPut(v);
  if(el) el.value = MF.url;
}
function mapfPaste(){
  /* readText 一定要有 fallback：iOS Safari 會跳系統的「貼上」確認、使用者可能不點；
   * 非安全脈絡直接 reject。沒有 fallback ＝ 這功能在他手機上有機率整個不能用。 */
  function got(txt, ok){
    txt = String(txt||"").trim();
    if(isMapUrl(txt)){
      if(txt === MF.url){ toast("跟現在這條一樣，沒有換"); return; }
      mapfPut(txt); MF.editing = false; mapfDraw();
      toast("已換成剛剛複製的連結");
      return;
    }
    MF.editing = true; mapfDraw();
    toast(!ok ? "讀不到剪貼簿，改用手動貼上" : (txt ? "剪貼簿裡不是地圖連結，改用手動" : "剪貼簿是空的，改用手動"));
  }
  try{
    if(navigator.clipboard && navigator.clipboard.readText){
      navigator.clipboard.readText().then(function(t){ got(t, true); }, function(){ got("", false); });
    }else got("", false);
  }catch(e){ got("", false); }
}
function mapfClear(){
  MF.url = ""; MF.addr = ""; MF.editing = false;   /* ✕＝連結與地址一起清 */
  mapfDraw(); toast("連結和地址都清掉了");
}
function mapfManual(){ MF.editing = true; mapfDraw(); }
function mapfDone(){
  var el = document.getElementById("mfIn");
  if(el) mapfType(el.value);   /* 沒有觸發 oninput 的路徑（例如程式填值）也收得到 */
  MF.editing = false; mapfDraw();
}
function openStopEdit(idx){
  if(!requireWrite("改這個行程點")) return;
  var list=curList()||[]; var sp=list[idx]; if(!sp) return;
  var curCat = CATS[sp.cat] ? sp.cat : "other"; /* 類別被刪掉的舊行程點 fallback 到「其他」 */
  var legacyHours = (sp.hours && !sp.hoursOpen && !sp.hoursClose && !sp.hours24)
    ? '<div class="hint">原本記的文字：「'+esc(sp.hours)+'」——下面選了時間就會取代它。</div>' : "";
  openSheet("編輯行程點",
    '<form onsubmit="submitStopEdit(event,'+idx+')">'
    + '<label class="field"><span class="fl">名稱 *</span><input name="title" required value="'+esc(sp.title)+'" autocomplete="off"></label>'
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">時間</span><input type="time" name="time" value="'+esc(sp.time)+'" oninput="stayTimeChanged(this.form)"></label>'
    +   '<label class="field">'+catFieldLabel()+'<select name="cat">'+catOptions(curCat)+'</select></label>'
    + '</div>'
    + '<label class="field"><span class="fl">地點</span><input name="place" value="'+esc(sp.place)+'" autocomplete="off"></label>'
    + mapField(sp)
    + stayField(sp.stayMinutes)
    /* 「預估費用」欄位 v3.5 移除（見上面 viewStopDetail 的理由）。
       ⚠️ serializer／parser 的 `cost` 刻意留著（比照 bookingRef）：
          萬一哪裡還有舊值，不可以因為 UI 拿掉就被無聲清空。
       ⚠️ 連 `.f-row2` 外框一起拿掉：它是 1fr 1fr 的 grid，只剩電話一格時
          會孤零零佔左半邊、右邊開一個洞。 */
    + '<label class="field"><span class="fl">聯絡電話</span><input type="tel" name="phone" value="'+esc(sp.phone||"")+'" autocomplete="off"></label>'
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">營業時間（開）</span><input type="time" name="hoursOpen" value="'+esc(sp.hoursOpen||"")+'"'+(sp.hours24?" disabled":"")+'></label>'
    +   '<label class="field"><span class="fl">營業時間（關）</span><input type="time" name="hoursClose" value="'+esc(sp.hoursClose||"")+'"'+(sp.hours24?" disabled":"")+'></label>'
    + '</div>'
    + '<label class="check-row"><input type="checkbox" name="hours24"'+(sp.hours24?" checked":"")+' onchange="toggleHours24(this)"><span class="ck-box"></span><span class="ck-lb">24 小時營業</span></label>'
    + legacyHours
    + '<label class="field"><span class="fl">官網／參考連結</span><input name="url" inputmode="url" value="'+esc(sp.url||"")+'" autocomplete="off"></label>'
    + '<label class="field"><span class="fl">詳細備註</span><textarea name="note" rows="3">'+esc(sp.note||"")+'</textarea></label>'
    + '<button class="btn-primary" type="submit">儲存</button>'
    + '</form>');
  stayInit();
}
function submitStopEdit(ev, idx){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f = ev.target; var list=curList()||[]; var sp=list[idx]; if(!sp) return;
  sp.title = f.title.value.trim();
  var oldTime = String(sp.time||"");
  sp.time = f.time.value;
  sp.cat = f.cat.value;
  sp.place = f.place.value.trim();
  var newMap = f.mapUrl.value.trim();   /* v2.6 起是地圖欄那個隱藏 input（見 mapField） */
  /* v2.4：連結換掉（或清空）＝舊地址失效，清掉讓 server 重新展開
   * （v2.6 的畫面在「按下貼上／✕ 的當下」就已經把 addr 從表單狀態拿掉了，這裡是落盤那一道） */
  if(newMap !== String(sp.mapUrl||"")) sp.addr = "";
  sp.mapUrl = newMap;
  /* ⚠️ 這裡刻意**不寫** sp.cost：欄位 v3.5 從表單移除了，`f.cost` 已經不存在
     （寫成 f.cost.value 會直接 TypeError），而且也不可以塞 0 ——
     那等於「一存檔就把舊值清掉」，正是 bookingRef 那條在防的事。 */
  var oldStay = Math.round(Number(sp.stayMinutes)||0);
  sp.stayMinutes = readStay(f); /* 0＝清空（serializer 不寫空值） */
  /* 時間或停留變了＝後面整串跟著移（v1.6；2026-08-21 起「時間」也連鎖）。
   * 一次算一個總量（見 stopShiftDelta），同時改兩者也只推一次。 */
  var delta = stopShiftDelta(oldTime, sp.time, oldStay, sp.stayMinutes);
  var moved = shiftAfter(list, idx, delta);
  /* bookingRef（訂位代號）欄位 v1.1 起 UI 不再提供，但既有值刻意不動（round-trip 保留） */
  sp.phone = f.phone.value.trim();
  sp.hours24 = !!f.hours24.checked;
  sp.hoursOpen = sp.hours24 ? "" : f.hoursOpen.value;
  sp.hoursClose = sp.hours24 ? "" : f.hoursClose.value;
  if(sp.hours24 || sp.hoursOpen || sp.hoursClose) sp.hours = ""; /* 結構化資料取代舊自由文字 */
  sp.url = f.url.value.trim();
  sp.note = f.note.value.trim();
  persistTrip(curTrip()); closeSheet(); render(true);
  shiftToast(moved, delta);
}

/* ---- 花費 ---- */
/* 按天分組（v3.3）。順序：行前 → Day 1..N →（超出目前天數的照排）→ 沒指定。
   ⚠️ 空的組不顯示（filter），否則 7 天的旅程一開頁面就是 9 個空標題。 */
function expGroups(t){
  var map = {}, order = [];
  function bucket(k){ if(!map[k]){ map[k]=[]; order.push(k); } return map[k]; }
  bucket("pre");
  for(var i=1;i<=t.days;i++) bucket(String(i));
  var extra = [];
  t.expenses.forEach(function(e){
    var d = expDayVal(e.day);
    if(typeof d==="number" && d>t.days && extra.indexOf(d)<0) extra.push(d);
  });
  extra.sort(function(a,b){ return a-b; }).forEach(function(d){ bucket(String(d)); });
  bucket("none");
  t.expenses.forEach(function(e){
    var d = expDayVal(e.day);
    bucket(d ? String(d) : "none").push(e);
  });
  return order.filter(function(k){ return map[k].length; }).map(function(k){
    var sum = 0;
    map[k].forEach(function(e){ sum += Number(e.amount)||0; });
    return { key:k, items:map[k], sum:sum };
  });
}
function expGroupHead(t, k){
  if(k==="pre")  return { t:"🎫 行前", sub:"出發前就花的" };
  if(k==="none") return { t:"沒指定哪一天", sub:"" };
  var s = parseDate(t.start), n = Number(k), d = s ? addDays(s, n-1) : null;
  return { t:"Day "+n, sub: (n>t.days ? "超出目前天數" : (d ? fmtMD(d)+" 週"+WD[d.getDay()] : "")) };
}
/* 這一天／這一組花了多少（viewPlan 也用同一支，兩邊口徑一定一樣） */
function spentOfDay(t, day){
  var r = { paid:0, plan:0, all:0 };
  t.expenses.forEach(function(e){
    if(expDayVal(e.day)!==day) return;
    var n = Number(e.amount)||0;
    if(e.plan) r.plan += n; else r.paid += n;
    r.all += n;
  });
  return r;
}
/* 花費列（v3.4：整列都能點開編輯，不是只有說明文字那一塊）
   ⚠️ v3.3 只把 `.exp-mid` 做成按鈕，實測命中區在 375px 下只有 x 84~202（約整列的 32%），
      金額那一大塊跟左邊的 emoji 都是死區 —— 使用者最自然會去點的就是金額。
      現在 emoji＋說明＋金額整包是一顆按鈕，只有 ✕ 留在外面（刪除必須是獨立的目標，
      不可以被「點一下開編輯」吃掉）。 */
function expRowHtml(e){
  var c = ECATS[e.cat]||ECATS.other;
  return '<div class="exp-item">'
    + '<button class="exp-open" onclick="openExpenseSheet(\''+e.id+'\')">'
    +   '<span class="exp-emo">'+c.emoji+'</span>'
    +   '<span class="exp-mid"><span class="d">'+esc(e.desc||c.label)+'</span>'
    +     '<span class="c">'+c.label
    +       (e.plan ? '<span class="plan-pill">預計</span>' : "") + '</span></span>'
    +   '<span class="exp-amt'+(e.plan?" is-plan":"")+'">'+money(e.amount)+'</span>'
    + '</button>'
    + '<button class="x-btn" onclick="delExpense(\''+e.id+'\')" aria-label="刪除">✕</button>'
    + '</div>';
}
function viewBudget(t){
  /* ⚠️ 預算的比較對象是「要準備多少」（已付＋預計）不是「已付」：
     不然規劃期把住宿車票都排進去了，畫面還是說「還可以花 20,000」。 */
  var spent = spentOf(t);
  var over = t.budget>0 && needOf(t)>t.budget;
  var remain = t.budget - needOf(t);
  var sums = {};
  t.expenses.forEach(function(e){ sums[e.cat]=(sums[e.cat]||0)+Number(e.amount||0); });
  var sumChips = Object.keys(sums).map(function(k){
    var c = ECATS[k]||ECATS.other;
    return '<span class="cat-sum">'+c.emoji+' '+c.label+' <b>'+money(sums[k])+'</b></span>';
  }).join("");
  var rows;
  if(!t.expenses.length){
    rows = '<div class="empty"><div class="big">🧾</div><p>還沒有任何花費，<br>點右下角 ＋ 記第一筆</p></div>';
  }else{
    rows = expGroups(t).map(function(g, gi){
      var h = expGroupHead(t, g.key);
      /* 組標題沿用打包區標題那套語言（.pack-head：左邊標題右邊數字），
         不另外發明第三種群組標頭。 */
      return '<div class="pack-head exp-head'+(gi===0?" first":"")+'"><span class="t">'+h.t
        + (h.sub ? '<span class="sub">（'+h.sub+'）</span>' : "") + '</span>'
        + '<span class="n">'+money(g.sum)+'</span></div>'
        + g.items.slice().reverse().map(expRowHtml).join("");
    }).join("");
  }
  /* 主數字＝「這趟要準備多少」（Benson 拍板）＝已付＋預計。
     進度條做成兩段：實心＝已經付掉的、淡的＝還沒付的預計 ——
     一眼看得出「預算被吃掉多少」跟「其中有多少已經真的出去了」。 */
  var plan = planOf(t), need = spentOf(t) + plan;
  var pctPaid = t.budget>0 ? Math.min(100, spent/t.budget*100) : 0;
  var pctPlan = t.budget>0 ? Math.min(100-pctPaid, plan/t.budget*100) : 0;
  return '<section class="budget-card">'
    +   '<div class="lbl">這趟要準備</div><div class="big">'+money(need)+'</div>'
    +   '<div class="prog"><i class="'+(over?"over":"")+'" style="width:'+pctPaid.toFixed(2)+'%"></i>'
    +     (plan ? '<i class="plan" style="width:'+pctPlan.toFixed(2)+'%"></i>' : "") + '</div>'
    +   '<div class="budget-row"><span>預算 '+money(t.budget)+'</span>'
    +     '<span>'+(over?'超出預算 <b class="over">'+money(-remain)+'</b>':'還可以再排 <b>'+money(remain)+'</b>')+'</span></div>'
    +   '<div class="budget-split"><span>已付 <b>'+money(spent)+'</b></span>'
    +     '<span class="sp-plan">還沒付 <b>'+money(plan)+'</b></span></div>'
    + '</section>'
    + (sumChips ? '<div class="cat-sums">'+sumChips+'</div>' : "")
    + '<div class="sec-title">花費紀錄</div>' + rows;
}

/* ============================================================================
   打包（v2.9 改版）：區 → 包 → 物品
   規格＝DESIGN.md 附錄 D，視覺與拖拉手感＝demo/packing.html（Benson 拍板，別自行改設計）
   ── 病根：「這一筆東西的歸屬」從頭到尾沒有地方可以改（沒有編輯、加錯區只能刪掉重加、
      想要「盥洗包」只能打成一行純文字）。所以這一版把「歸屬」變成一等公民：可看、可拖、可選、可改。
   ── 拍板的六件事（不要改回去）：
      ① 包同時是容器也是一件物品（有自己的勾，也能展開編輯內容）
      ② 各勾各的：勾包 ⇄ 勾包內物品完全不連動（連視覺都不准連動，見 styles.css 的 ⚠️）
      ③ 只允許兩層（包不能放進包）
      ④ 模板也要能有包
      ⑤ 點方塊＝勾、點文字＝編輯
      ⑥ 拿掉上面那排區域 segmented（兩區同時顯示）、拖曳把手 ☰ 常駐（不用進調整模式）
   ── 兩種進度、分母不同：區的「已打包 x / y」分母＝這一區的**頂層**項目（包算 1 件，包內物品不計）
      ＝「行李箱裝好沒」；包的「已裝 x / y」分母才是包內物品＝「這個包裝好沒」。
   ============================================================================ */
function pkAll(){ var t=curTrip(); return (t&&t.packing)||[]; }
function pkById(id){ var L=pkAll(); for(var i=0;i<L.length;i++) if(L[i].id===id) return L[i]; return null; }
function pkIsBag(p){ return !!p && p.kind==="bag"; }
function pkZoneOf(k){ for(var i=0;i<ZONES.length;i++) if(ZONES[i].key===k) return ZONES[i]; return ZONES[0]; }
function pkTop(z){ return pkAll().filter(function(p){ return p.zone===z && !p.bag; }); }
function pkKids(id){ return pkAll().filter(function(p){ return p.bag===id; }); }

function viewPack(t){
  if(!t.packing.length){
    return pkTopBar()
      + '<div class="empty"><div class="big">🧳</div>'
      + '<p>還沒有要帶的東西。<br>想到什麼就直接加，或整套帶入。</p>'
      + '<button class="btn-primary" onclick="openTplPicker()">📦 從模板帶入一套</button>'
      + '<div style="height:9px"></div>'
      + '<button class="btn-ghost" onclick="pkStartAdd(\''+ZONES[0].key+'\',\'\')">＋ 自己加第一樣</button></div>';
  }
  return pkTopBar() + ZONES.map(function(z){ return pkSectionHtml(z); }).join("");
}
/* 頂部一列（v3.0 附錄 E3）：進度為主、按鈕輕量化 —— 珊瑚只留給「已打包 x / y」這種他真的
 * 在看的東西；「新增」與「模板」按規格本來就是次要入口（主力是每區底部的就地新增），
 * 降成白底輕量鈕。舊的 segmented 與獨立輸入列 v2.9 已砍掉，「加到哪」由輸入框長在哪裡決定。
 * 分母＝頂層項目（包算 1 件），跟區的「已打包 x / y」同一套口徑，數字才對得起來。 */
function pkTopBar(){
  var all = pkAll().filter(function(p){ return !p.bag; });
  var done = all.filter(function(p){ return p.done; }).length;
  var pct = all.length ? Math.round(done/all.length*100) : 0;
  var prog = !all.length ? '還沒有東西'
    : (done===all.length
        ? '<span class="allok">✓ 全部打包好了</span>'
        : '還要帶 <b>'+(all.length-done)+'</b> 樣<span class="bar"><i style="width:'+pct+'%"></i></span>');
  return '<div class="pk-top">'
    + '<div class="pk-prog">'+prog+'</div>'
    + '<button class="pk-lite" onclick="openPackSheet()"><span class="plus">＋</span>新增</button>'
    + '<button class="pk-lite" onclick="openTplPicker()">📦 模板</button>'
    + '</div>';
}
function pkSectionHtml(z){
  var top = pkTop(z.key);
  var done = top.filter(function(p){return p.done;}).length;
  var filtered = ui.pk.filter[z.key] ? top.filter(function(p){return !p.done;}) : top;
  var rows = filtered.map(function(p){ return pkRowHtml(p, z); }).join("");
  var empty = "";
  if(!top.length) empty = '<div class="pk-inner-empty">這區還沒有東西</div>';
  else if(!filtered.length) empty = '<div class="pk-inner-empty">這區都打包好了 🎉</div>';
  var addRow = (ui.pk.adding && ui.pk.adding.zone===z.key && !ui.pk.adding.bag)
    ? pkAddForm("加到「"+z.emoji+" "+z.label+"」")
    : '<button class="pk-add" onclick="pkStartAdd(\''+z.key+'\',\'\')">'
      + '<span class="plus">＋</span>加東西到「'+z.emoji+' '+z.label+'」</button>';
  /* ⚠️ 計數的視覺是內層 .cp 那顆小藥丸，外層 .pk-cnt 只負責撐 44px 命中區 */
  return '<section class="pack-sec">'
    + '<div class="pack-head"><span class="t">'+z.emoji+' '+z.label
    +   '<span class="sub">（'+z.sub+'）</span></span>'
    +   '<button class="pk-cnt'+(ui.pk.filter[z.key]?" on":"")+'" onclick="pkToggleFilter(\''+z.key+'\')">'
    +     '<span class="cp"><span class="fdot"></span>'
    +     (ui.pk.filter[z.key] ? "只看沒打包的" : "已打包 "+done+" / "+top.length)
    +     '</span>'
    +   '</button>'
    + '</div>'
    + '<div class="pk-list" data-zone="'+z.key+'">'
    +   pkSlot(z.key, "", filtered.length?filtered[0].id:"")
    +   rows + empty + addRow
    + '</div></section>';
}
/* 落點錨：零高度、不佔版面，但要 display:block 才量得到寬度。
 * data-ref＝「插在哪一筆之前」（不是 index —— 移除來源之後 index 會失準）。 */
function pkSlot(zone, bag, refId){
  return '<i class="pk-slot" data-z="'+zone+'" data-b="'+bag+'" data-ref="'+refId+'"></i>';
}
function pkRowHtml(p, z){
  if(pkIsBag(p)) return pkBagHtml(p, z);
  return '<div class="pk-card" data-id="'+p.id+'">'
    + '<div class="pk-row'+(p.done?" done":"")+'" data-lp="'+p.id+'">'
    +   pkCkHtml(p)
    +   '<button class="pk-txt" onclick="openPackSheet(\''+p.id+'\')"><span class="t">'+esc(p.text)+'</span></button>'
    +   pkGripHtml(p.id)
    + '</div></div>'
    + pkSlot(z.key, "", pkNextTopRef(p, z.key));
}
function pkCkHtml(p){
  return '<button class="pk-ck" onclick="togglePack(\''+p.id+'\')" aria-label="打勾">'
    + '<span class="pk-box">'+(p.done?"✓":"")+'</span></button>';
}
/* 把手（v3.0 附錄 E2）：命中區永遠 44×56（一格都不准縮），改的是「視覺重量」與「怎麼觸發」。
 * 圖形＝6 個點的紋理，取代 19px 的 ☰ —— ☰ 在這個 App 是「調整模式的工具」，常駐等於把工具
 * 提到跟內容同一階，而且沿右緣重複成一條柱（v2.7 才剛在 .map-btn 修掉的同一個病）。
 * ⚠️ pointermove／up／cancel 不再寫 inline：待命期與拖曳期都掛在 window 上，
 *    手指滑出把手之後才收得到（門檻式判斷一定要收得到後續事件）。 */
var PK_GRIP_DOTS = '<span class="gv"><svg class="gd" viewBox="0 0 12 18" aria-hidden="true" focusable="false">'
  + '<circle cx="3.4" cy="4" r="1.35"/><circle cx="8.6" cy="4" r="1.35"/>'
  + '<circle cx="3.4" cy="9" r="1.35"/><circle cx="8.6" cy="9" r="1.35"/>'
  + '<circle cx="3.4" cy="14" r="1.35"/><circle cx="8.6" cy="14" r="1.35"/></svg></span>';
function pkGripHtml(id){
  return '<button class="pk-grip" aria-label="拖曳移動" oncontextmenu="return false"'
    + ' onpointerdown="packGripDown(event,\''+id+'\')">'+PK_GRIP_DOTS+'</button>';
}
function pkNextTopRef(p, zoneKey){
  var list = ui.pk.filter[zoneKey] ? pkTop(zoneKey).filter(function(x){return !x.done;}) : pkTop(zoneKey);
  var i = list.indexOf(p);
  return (i>=0 && list[i+1]) ? list[i+1].id : "";
}
/* 包＝同一張白卡長高（上半是包自己那一列，下半是內容）：層級靠「同一張卡＋左側 rail」不靠縮排，
 * 手機的水平空間才不會被吃掉。 */
function pkBagHtml(p, z){
  var kids = pkKids(p.id);
  var dn = kids.filter(function(k){return k.done;}).length;
  /* 勾起來＝丟進去了就自動收合（收合那一下在 togglePack 做），但**還是點得開**
   * ⚠️ 這裡不可以寫成 `&& !p.done`：那會讓已打包的包永遠打不開（demo 有這個瑕疵，實測抓到） */
  var open = !!ui.pk.open[p.id];
  var pct = kids.length ? Math.round(dn/kids.length*100) : 0;
  var sub = kids.length
    ? (dn===kids.length
        ? '<span class="all">✓ 都裝好了・'+kids.length+' 樣</span>'
        : '<span class="bar"><i style="width:'+pct+'%"></i></span><span>已裝 '+dn+' / '+kids.length+'</span>')
    : '<span>還是空的</span>';
  var inner = "";
  if(open){
    var addRow = (ui.pk.adding && ui.pk.adding.bag===p.id)
      ? pkAddForm("加到「"+p.text+"」")
      : '<button class="pk-add" onclick="pkStartAdd(\''+p.zone+'\',\''+p.id+'\')">'
        + '<span class="plus">＋</span>加東西到「'+esc(p.text)+'」</button>';
    inner = '<div class="pk-inner">'
      + pkSlot(p.zone, p.id, kids.length?kids[0].id:"")
      + (kids.length ? kids.map(function(k,i){
          /* ⚠️ 一定要帶 pk-row：所有「已打包」的樣式都掛在 .pk-row.done 上，
             少了它 → 包裡面勾起來畫面完全沒反應（資料是對的，功能測試抓不到） */
          return '<div class="pk-row pk-sub-row'+(k.done?" done":"")+'" data-id="'+k.id+'" data-lp="'+k.id+'">'
            + pkCkHtml(k)
            + '<button class="pk-txt" onclick="openPackSheet(\''+k.id+'\')"><span class="t">'+esc(k.text)+'</span></button>'
            + pkGripHtml(k.id)
            + '</div>'
            + pkSlot(p.zone, p.id, kids[i+1]?kids[i+1].id:"");
        }).join("")
        : '<div class="pk-inner-empty">這個包還是空的，加點東西進去</div>')
      + addRow
      + '</div>';
  }
  return '<div class="pk-card pk-bag'+(open?" open":"")+(p.done?" done":"")+'" data-id="'+p.id+'" data-bag="'+p.id+'">'
    + '<div class="pk-row pk-head-row'+(p.done?" done":"")+'" data-lp="'+p.id+'">'
    +   pkCkHtml(p)
    +   '<button class="pk-txt" onclick="pkToggleBag(\''+p.id+'\')">'
    +     '<span class="t"><span class="pk-emo">📦</span> '+esc(p.text)+'<span class="pk-chev">⌄</span></span>'
    +     '<span class="pk-sub">'+sub+'</span></button>'
    /* ✎＝這個包的設定（改名／換區／刪掉）的可見入口，v3.2 從盒子裡的整行搬到包頭。
     * ⚠️ 只有展開時才輸出：收合時 0 顆，才不會沿著右緣重複成一條柱（v2.7 .map-btn 的老病）。
     * 包頭「不准動」那條由 Benson 在 v3.2 親自解除，但也只准加這一顆，其餘原樣。 */
    +   (open ? '<button class="pk-edit" aria-label="這個包的設定" onclick="openPackSheet(\''+p.id+'\')">✎</button>' : '')
    +   pkGripHtml(p.id)
    + '</div>'
    + inner
    + '</div>'
    + pkSlot(z.key, "", pkNextTopRef(p, z.key));
}
function pkAddForm(ph){
  return '<form class="pk-form" onsubmit="pkSubmitAdd(event)">'
    + '<input id="pk-input" placeholder="'+esc(ph)+'" autocomplete="off" enterkeyhint="done"'
    + ' oninput="ui.pk.pending=this.value" required>'
    + '<button type="submit">加入</button></form>';
}

/* ---- 打包：資料操作（都會落盤；moveTo 是「歸屬」的唯一入口） ---- */
/* 把 item（若是包，連同它的小孩）搬到 (zone, bagId) 的 refId 之前；refId 空＝放最後 */
function pkMoveTo(item, zone, bagId, refId){
  var t=curTrip(); if(!t || !item) return;
  var kids = pkIsBag(item) ? pkKids(item.id) : [];
  var moving = [item].concat(kids);
  var parentBag = bagId ? pkById(bagId) : null;
  if(parentBag && (moving.indexOf(parentBag)>=0 || !pkIsBag(parentBag))) parentBag = null;
  if(pkIsBag(item)) parentBag = null;                    /* 只允許兩層：包永遠直接放在區裡 */
  var ref = refId ? pkById(refId) : null;
  if(ref && moving.indexOf(ref)>=0) ref = null;
  t.packing = t.packing.filter(function(p){ return moving.indexOf(p)<0; });
  var newZone = parentBag ? parentBag.zone : (zone==="checked"?"checked":"carry");
  item.zone = newZone;
  item.bag = parentBag ? parentBag.id : "";
  kids.forEach(function(k){ k.zone = newZone; });        /* 包內物品的 zone 跟著父包走 */
  var idx;
  if(ref){ idx = t.packing.indexOf(ref); }
  else{
    var list = parentBag ? pkKids(parentBag.id) : pkTop(newZone);
    if(!list.length){ idx = parentBag ? t.packing.indexOf(parentBag)+1 : t.packing.length; }
    else{
      var last = list[list.length-1];
      idx = pkIsBag(last) ? pkTailIdx(last) : t.packing.indexOf(last)+1;
    }
  }
  if(idx<0) idx = t.packing.length;
  t.packing.splice.apply(t.packing, [idx,0].concat(moving));
}
/* 一個包在 packing 陣列裡的尾端 index（含它的小孩） */
function pkTailIdx(bagItem){
  var t=curTrip(); if(!t) return 0;
  var i=t.packing.indexOf(bagItem), last=i;
  pkKids(bagItem.id).forEach(function(k){ last=Math.max(last, t.packing.indexOf(k)); });
  return last+1;
}
function pkAddItem(text, zone, bagId, asBag){
  var t=curTrip(); if(!t) return null;
  var b = (bagId && !asBag) ? pkById(bagId) : null;
  var o = {id:uid(), text:text, done:false, zone:(b?b.zone:(zone==="checked"?"checked":"carry")), bag:(b?b.id:"")};
  if(asBag){ o.kind="bag"; o.bag=""; }
  t.packing.push(o);
  pkMoveTo(o, o.zone, o.bag, "");
  return o;
}
/* 刪掉一個包＝裡面的東西「倒出來」留在同一區，不會跟著消失（toast 要講清楚） */
function pkRemove(item){
  var t=curTrip(); if(!t || !item) return;
  var kids = pkIsBag(item) ? pkKids(item.id) : [];
  kids.forEach(function(k){ k.bag=""; });
  t.packing = t.packing.filter(function(p){ return p!==item; });
  if(kids.length) toast("已刪掉「"+item.text+"」，裡面 "+kids.length+" 樣東西留在 "+pkZoneOf(item.zone).label);
  else toast("已刪掉「"+item.text+"」");
}

/* ---- 打包：互動 ---- */
function pkToggleBag(id){ ui.pk.open[id] = !ui.pk.open[id]; render(true); }
function pkToggleFilter(z){ ui.pk.filter[z] = !ui.pk.filter[z]; render(true); }
function pkStartAdd(zone, bag){
  if(!requireWrite("加打包項目")) return;
  ui.pk.adding = {zone:zone, bag:bag||""}; ui.pk.pending = "";
  if(bag) ui.pk.open[bag] = true;
  render(true);
}
function pkSubmitAdd(ev){
  ev.preventDefault();
  if(!requireWrite("加打包項目")) return;
  var inp = document.getElementById("pk-input");
  var text = (inp ? inp.value : "").trim();
  if(!text || !ui.pk.adding) return;
  pkAddItem(text, ui.pk.adding.zone, ui.pk.adding.bag, false);
  ui.pk.pending = "";
  persistTrip(curTrip());
  render(true);                 /* 連續加：輸入框留在原位、focus 不放掉（render 後由 pkAfterRender 補回） */
}
/* render() 之後把就地新增的輸入框接回來（內容 + 游標） */
function pkAfterRender(){
  if(!ui.pk || !ui.pk.adding) return;
  var inp = document.getElementById("pk-input");
  if(!inp) return;
  inp.value = ui.pk.pending || "";
  try{ inp.focus({preventScroll:true}); }catch(e){ inp.focus(); }
}

/* ---- 打包模板：帶入 / 管理 / 編輯 ---- */
function tplCounts(tp){
  var bags = (tp.items||[]).filter(function(i){ return i.kind==="bag"; }).length;
  return "🧳 "+zoneCount(tp.items,"checked")+" ・ 🎒 "+zoneCount(tp.items,"carry")
    + (bags ? "・含 "+bags+" 個包" : "");
}
function openTplPicker(){
  var rows = db.templates.map(function(tp){
    return '<div class="tpl-card"><div class="tpl-info"><b>'+esc(tp.name)+'</b><span>'+tplCounts(tp)+'</span></div>'
      + '<button class="tpl-apply" onclick="applyTemplate(\''+tp.id+'\')">帶入</button></div>';
  }).join("");
  if(!rows) rows = '<p class="d-empty">還沒有模板，先去「管理模板」建一個</p>';
  openSheet("從模板帶入",
    rows
    + '<div class="hint" style="margin-top:12px">同名的東西會自動跳過。<br>'
    + '模板裡的包如果你已經有了（例如「盥洗包」），<b>不會多開一個</b>，會把缺的東西補進你原本那個包裡。</div>'
    + '<div class="d-acts"><button class="btn-ghost" onclick="openTplManager()">管理模板</button></div>');
}
/* 帶入模板（v2.9 合併規則，比舊的「同名跳過」多一層）：
 * ① 模板裡的包，旅程裡已經有同名的包 → 不新增第二個，把缺的東西補進他原本那個包
 * ② 一般項目的同名判定要「連容器一起比」（同名且在同一個包裡才算重複）
 *    —— 「常備藥」放在盥洗包裡跟放在行李箱底層是兩件事
 * 帶入兩次的第二次必須是「0 樣、N 個包合併」（冪等）。 */
function applyTemplate(id){
  if(!requireWrite("套用打包模板")) return;
  var t=curTrip(); if(!t) return;
  var tp=null; db.templates.forEach(function(x){ if(x.id===id) tp=x; });
  if(!tp) return;
  var added=0, merged=0, bagMap={};   /* 模板裡的包名 -> 這趟旅程實際的包 id */
  (tp.items||[]).filter(function(i){ return i.kind==="bag"; }).forEach(function(i){
    var name = String(i.text||"").trim();
    if(!name) return;
    var exist=null;
    t.packing.forEach(function(p){ if(pkIsBag(p) && String(p.text||"").trim()===name) exist=p; });
    if(exist){ bagMap[i.text]=exist.id; merged++; }
    else{
      var o = pkAddItem(name, i.zone, "", true);
      if(o){ bagMap[i.text]=o.id; added++; ui.pk.open[o.id]=true; }
    }
  });
  (tp.items||[]).filter(function(i){ return i.kind!=="bag"; }).forEach(function(i){
    var name = String(i.text||"").trim();
    if(!name) return;
    var targetBag = i.bag ? (bagMap[i.bag]||"") : "";
    var dup = t.packing.some(function(p){
      return !pkIsBag(p) && String(p.text||"").trim()===name && (p.bag||"")===(targetBag||"");
    });
    if(dup) return;
    pkAddItem(name, i.zone, targetBag, false); added++;
  });
  persistTrip(t); closeSheet(); render(true);
  toast("帶入 "+added+" 樣"+(merged?("，"+merged+" 個包直接合併"):""));
}
function openTplManager(){
  var rows = db.templates.map(function(tp){
    return '<div class="tpl-card"><div class="tpl-info"><b>'+esc(tp.name)+'</b><span>'+tplCounts(tp)+'</span></div>'
      + '<div class="tpl-acts"><button onclick="openTplEdit(\''+tp.id+'\')">編輯</button>'
      + '<button class="danger" onclick="delTemplate(\''+tp.id+'\')">刪除</button></div></div>';
  }).join("");
  if(!rows) rows = '<p class="d-empty">還沒有任何模板</p>';
  openSheet("管理模板",
    rows + '<div class="d-acts"><button class="btn-primary" onclick="openTplEdit()">＋ 新增模板</button></div>');
}
function delTemplate(id){
  if(!requireWrite("刪掉打包模板")) return;
  if(!confirm("刪除這個模板？（不影響已帶入各旅程的項目）")) return;
  db.templates = db.templates.filter(function(t){return t.id!==id;});
  chainPersist("tpl:"+id, function(){ return STORE.deleteTemplate(id); });
  openTplManager();
}
var tplDraft = null;
function openTplEdit(id){
  if(!requireWrite("改打包模板")) return;
  var src=null;
  if(id){ db.templates.forEach(function(t){ if(t.id===id) src=t; }); }
  tplDraft = src
    ? {id:src.id, name:src.name, zone:ZONES[0].key, bag:"", asBag:false, pending:"",
       items:src.items.map(function(i){ return cleanTplItem(i); })}
    : {id:null, name:"", zone:ZONES[0].key, bag:"", asBag:false, pending:"", items:[]};
  renderTplEdit();
}
function syncTplDraft(){
  var n=document.getElementById("tpl-name"); if(n) tplDraft.name=n.value;
  var i=document.getElementById("tpl-item-input"); if(i) tplDraft.pending=i.value;
}
/* 模板編輯（v2.9：模板也要能有包）
 * ⚠️ 模板項目的 bag 存的是「包的名字」不是 id（模板檔沒有 id、是人可以手打的小清單） */
function tplBagsIn(z){ return tplDraft.items.filter(function(i){ return i.kind==="bag" && i.zone===z; }); }
function tplKidsOf(name){ return tplDraft.items.filter(function(i){ return i.kind!=="bag" && i.bag===name; }); }
function renderTplEdit(){
  var target = tplDraft.bag ? tplDraft.bag : tplDraft.zone;
  var locs = "";
  ZONES.forEach(function(z){
    var on = (target===z.key);
    locs += '<button class="loc'+(on?" on":"")+'" onclick="setTplLoc(\''+z.key+'\',-1)">'
         +  '<span>'+z.emoji+'</span><span>'+z.label+'</span>'+(on?'<span class="ck">✓</span>':'')+'</button>';
    if(tplDraft.asBag) return;                       /* 包只能放在區裡（只允許兩層） */
    /* ⚠️ 傳 index 不傳名字：包名是使用者打的自由文字，塞進 onclick 的字串裡會被引號炸掉 */
    tplBagsIn(z.key).forEach(function(b){
      var bon = (target===b.text);
      locs += '<button class="loc sub'+(bon?" on":"")+'" onclick="setTplLoc(\''+z.key+'\','+tplDraft.items.indexOf(b)+')">'
           +  '<span class="arw">↳</span><span>📦</span><span>'+esc(b.text)+'</span>'+(bon?'<span class="ck">✓</span>':'')+'</button>';
    });
  });
  function itemRow(it, i, sub){
    return '<div class="tpl-item'+(sub?" sub":"")+'">'
      + '<span>'+(it.kind==="bag"?"📦":(sub?"↳":pkZoneOf(it.zone).emoji))+'</span>'
      + '<span class="tx">'+esc(it.text)+'</span>'
      + '<button class="x-btn" onclick="delTplItem('+i+')" aria-label="刪除">✕</button></div>';
  }
  var lists = ZONES.map(function(z){
    var rows = "";
    tplDraft.items.forEach(function(it,i){
      if(it.zone!==z.key || it.bag) return;          /* 小孩跟著它的包一起畫 */
      rows += itemRow(it, i, false);
      if(it.kind==="bag"){
        tplKidsOf(it.text).forEach(function(k){ rows += itemRow(k, tplDraft.items.indexOf(k), true); });
      }
    });
    return '<div class="tpl-sec-h">'+z.emoji+' '+z.label+'（'+z.sub+'）</div>'
      + (rows || '<div class="tpl-none">還沒有項目</div>');
  }).join("");
  var where = tplDraft.bag ? ("📦 "+tplDraft.bag) : (pkZoneOf(tplDraft.zone).emoji+" "+pkZoneOf(tplDraft.zone).label);
  openSheet(tplDraft.id ? "編輯模板" : "新增模板",
    '<label class="field"><span class="fl">模板名稱 *</span><input id="tpl-name" value="'+esc(tplDraft.name)+'" placeholder="例：露營裝備" autocomplete="off"></label>'
    + '<div class="fl pk-loc-lb">新增到哪</div><div class="loc-list">'+locs+'</div>'
    + '<button class="bag-toggle'+(tplDraft.asBag?" on":"")+'" style="margin-top:13px" onclick="toggleTplBag()">'
    +   '<span style="font-size:20px">📦</span>'
    +   '<span class="bt-t"><b>加進去的是一個包</b><span>包裡面可以再放東西（帶入時同名的包會自動合併）</span></span>'
    +   '<span class="sw"><i></i></span></button>'
    + '<form class="pack-add" onsubmit="addTplItem(event)">'
    +   '<input id="tpl-item-input" value="'+esc(tplDraft.pending)+'" placeholder="新增'+(tplDraft.asBag?"包":"項目")+'到「'+esc(where)+'」" autocomplete="off" required>'
    +   '<button type="submit">加入</button></form>'
    + lists
    + '<div class="d-acts"><button class="btn-primary" onclick="saveTpl()">儲存模板</button></div>');
}
function setTplLoc(z, bagIdx){
  syncTplDraft();
  var b = (bagIdx>=0) ? tplDraft.items[bagIdx] : null;
  tplDraft.zone = z;
  tplDraft.bag = (b && b.kind==="bag") ? b.text : "";
  renderTplEdit();
}
function toggleTplBag(){
  syncTplDraft();
  tplDraft.asBag = !tplDraft.asBag;
  if(tplDraft.asBag) tplDraft.bag = "";
  renderTplEdit();
}
function addTplItem(ev){
  ev.preventDefault();
  syncTplDraft();
  var text=(tplDraft.pending||"").trim(); if(!text) return;
  if(tplDraft.asBag){
    /* 同名的包不開第二個（模板用名字當參照，重名會讓歸屬變模糊） */
    var dup = tplDraft.items.some(function(i){ return i.kind==="bag" && i.text===text; });
    if(!dup) tplDraft.items.push({text:text, zone:tplDraft.zone, kind:"bag"});
    tplDraft.asBag=false; tplDraft.bag=text;        /* 建完包直接把新增目標切進去，接著加內容 */
  }else{
    var it = {text:text, zone:tplDraft.zone};
    if(tplDraft.bag) it.bag = tplDraft.bag;
    tplDraft.items.push(it);
  }
  tplDraft.pending="";
  renderTplEdit();
  var inp=document.getElementById("tpl-item-input");
  if(inp) inp.focus({preventScroll:true});
}
/* 刪掉模板裡的包＝裡面的東西倒出來留在同一區（跟旅程清單同一套哲學） */
function delTplItem(i){
  syncTplDraft();
  var it = tplDraft.items[i];
  if(it && it.kind==="bag"){
    tplDraft.items.forEach(function(k){ if(k.bag===it.text) delete k.bag; });
    if(tplDraft.bag===it.text) tplDraft.bag="";
  }
  tplDraft.items.splice(i,1);
  renderTplEdit();
}
function saveTpl(){
  if(!requireWrite()) return;
  syncTplDraft();
  var name=(tplDraft.name||"").trim() || "未命名模板";
  var items = normalizeTplItems(tplDraft.items);
  var saved=null;
  if(tplDraft.id){
    db.templates.forEach(function(t){ if(t.id===tplDraft.id){ t.name=name; t.items=items; saved=t; } });
  }else{
    saved = {id:Date.now().toString(36)+"-"+slugify(name), name:name, items:items};
    db.templates.push(saved);
  }
  if(saved) persistTemplate(saved);
  tplDraft=null; openTplManager();
}

/* ---- 類別管理（v1.1：可自訂的全域資源） ---- */
function openCatManager(){
  var rows = (db.categories||[]).map(function(c){
    return '<div class="tpl-card">'
      + '<div class="tpl-info"><span class="cat-pill" style="color:'+c.color+'; background:'+c.color+'1a">'+esc(c.emoji)+' '+esc(c.label)+'</span></div>'
      + '<div class="tpl-acts"><button onclick="openCatEdit(\''+esc(c.id)+'\')">編輯</button>'
      + (c.id!=="other" ? '<button class="danger" onclick="delCat(\''+esc(c.id)+'\')">刪除</button>' : '')
      + '</div></div>';
  }).join("");
  openSheet("管理類別",
    rows
    + '<div class="hint" style="margin-top:12px">刪掉類別後，用到它的行程點會顯示成「其他」；「其他」不可刪。</div>'
    + '<div class="d-acts"><button class="btn-primary" onclick="openCatEdit()">＋ 新增類別</button></div>');
}
function openCatEdit(id){
  if(!requireWrite("改行程點類別")) return;
  var src=null;
  if(id){ (db.categories||[]).forEach(function(c){ if(c.id===id) src=c; }); }
  var draft = src ? {id:src.id, label:src.label, emoji:src.emoji, color:src.color}
                  : {id:"", label:"", emoji:"", color:CAT_COLORS[0]};
  var colors = CAT_COLORS.slice();
  if(draft.color && colors.indexOf(draft.color)<0) colors.unshift(draft.color);
  var colorPicks = colors.map(function(col){
    return '<label class="pick"><input type="radio" name="color" value="'+col+'"'+(col===draft.color?" checked":"")+'>'
      + '<span class="swatch" style="background:'+col+'"></span></label>';
  }).join("");
  openSheet(src ? "編輯類別" : "新增類別",
    '<form onsubmit="saveCat(event,\''+esc(draft.id)+'\')">'
    + '<label class="field"><span class="fl">名稱 *</span><input name="label" required value="'+esc(draft.label)+'" placeholder="例：咖啡廳" autocomplete="off"></label>'
    + '<label class="field"><span class="fl">emoji</span><input name="emoji" value="'+esc(draft.emoji)+'" placeholder="貼一個 emoji，例：☕" autocomplete="off" autocapitalize="off"></label>'
    + '<div class="field"><span class="fl">顏色</span><div class="pick-row">'+colorPicks+'</div></div>'
    + '<button class="btn-primary" type="submit">儲存</button>'
    + '</form>');
}
function saveCat(ev, id){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f=ev.target;
  var label=f.label.value.trim()||"未命名";
  var emoji=firstGrapheme(f.emoji.value)||"✨";
  var color=f.color.value;
  if(id){
    (db.categories||[]).forEach(function(c){
      if(c.id===id){ c.label=label; c.emoji=emoji; c.color=color; }
    });
  }else{
    db.categories.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,5), label:label, emoji:emoji, color:color});
  }
  db.categories = normalizeCategories(db.categories);
  rebuildCats();
  persistCategories();
  openCatManager();
  render(true); /* 行程卡的類別膠囊即時換色 */
}
function delCat(id){
  if(!requireWrite("刪掉類別")) return;
  if(id==="other") return; /* fallback 類別不可刪 */
  var c=CATS[id];
  if(!confirm("刪除類別「"+(c?c.label:id)+"」？用到它的行程點會顯示成「其他」。")) return;
  db.categories = db.categories.filter(function(x){return x.id!==id;});
  db.categories = normalizeCategories(db.categories);
  rebuildCats();
  persistCategories();
  openCatManager();
  render(true);
}

/* ---- 備註 ---- */
function viewNotes(t){
  var ro = !STORE.canWrite();
  /* 唯讀時 textarea 維持 readonly，但點下去要能解鎖（不是點了沒反應） */
  var hint = ro ? (KR_ON ? "只看看模式（點一下就能解鎖來寫）" : "唯讀模式（貼上金鑰即可編輯）")
                : "航班、訂房代號、緊急聯絡…都丟這裡";
  return '<div class="notes-hint"><span>'+hint+'</span>'
    +   '<span class="note-saved" id="note-saved">已儲存 ✓</span></div>'
    + '<textarea class="notes-area" '+(ro?'readonly onclick="requireWrite(\'寫備註\')" ':"")+'oninput="noteInput(this.value)" '
    +   'placeholder="例：&#10;去程航班 BR198 09:20&#10;飯店訂房代號 ABC-123">'+esc(t.notes)+'</textarea>';
}

/* ============ 動作 ============ */
function openTrip(id){ ui.screen="trip"; ui.tripId=id; ui.tab="plan"; ui.day=1; ui.edit=false; render(); }
function goHome(){ ui.screen="home"; render(); }
function setTab(tab){ ui.tab=tab; ui.edit=false; render(); }
function setDay(d){ ui.day=d; render(); }
function toggleEdit(){
  if(!ui.edit && !requireWrite("調整順序")) return;
  ui.edit=!ui.edit; render(true);
}

function delStop(idx){
  if(!requireWrite("刪掉這個行程點")) return;
  var list=curList(); if(!list) return;
  list.splice(idx,1); persistTrip(curTrip()); render(true);
}
/* 勾／取消勾。⚠️ 各勾各的：勾一個包只動包自己那一筆，裡面的東西一個位元組都不碰。 */
function togglePack(id){
  if(!requireWrite("勾打包清單")) return;
  var t=curTrip(); if(!t) return;
  var p = pkById(id); if(!p) return;
  p.done = !p.done;
  if(pkIsBag(p) && p.done) ui.pk.open[p.id] = false;   /* 丟進去了就不用看裡面（還是點得開） */
  persistTrip(t); render(true);
}

/* ============================================================================
   打包的拖曳（跟行程分頁那一套「index 位移＋讓位動畫」是兩套，刻意不共用）
   手感沿用行程：pointer events／只有把手可拖／setPointerCapture／preventDefault／
   邊緣自動捲動 TH=80、SPEED=9（跟 dragAutoScroll 同一組數字）。
   ⚠️ v3.0 改掉的是**觸發條件**：把手不再是 touch-action:none ＋ 一碰就拖（見下面 packGripDown）。
      行程那一套的 dragStart／dragMove／dragEnd 一行都沒動、也不准把門檻套過去——
      行程的把手只在「調整模式」出現，本來就不會誤觸，改了只會讓那邊變難拖。
   差別在落點：行程只有「排序」，打包還有「進包／出包／換區」⇒ 改用 slot 制。
   ⚠️ 座標用 client 座標是**對的**：每一次 pointermove 都重新 getBoundingClientRect（沒有
      「開始時的基準」），自動捲動之後 rect 自己就更新了。
      若有人把它改回 transform 位移法，就必須回到 page 座標（clientY+scrollY），別混用。
   ============================================================================ */
var pkDrag = null, pkPend = null;
/* 「先觀察，後接管」（v3.0 附錄 E2）＝這一版誤觸修正的核心：
 *   pointerdown 只進入「待命」：不 preventDefault、不 setPointerCapture，
 *   把手的 touch-action 是 pan-y ⇒ 這段期間捲動一路交給瀏覽器，不會頓一下。
 *     垂直位移 > PK_V_ESC(8px)  → 放棄（你在捲動）
 *     橫向位移 > PK_H_ARM(12px) → 進入拖曳（橫向不可能是捲動＝意圖明確）
 *     原地不動滿 PK_T_HOLD(220ms) → 進入拖曳
 *   進入拖曳的那一刻才：setPointerCapture ＋ 鎖捲動 ＋ 震一下 ＋ 把手變珊瑚。
 * ⚠️ 待命期間**不可以**把原點跟著手指移（「方向還不明就重設基準」那種寫法）：
 *    原點一直往前挪，橫向門檻永遠累積不到（UX 施工時實測「往左帶 24px」完全不會觸發）。
 *    小幅晃動交給 220ms 的倒數處理就好。 */
function packGripDown(ev, id){
  if(pkDrag || pkPend) return;
  if(!requireWrite("搬動打包項目")) return;
  var el = ev.currentTarget;
  pkPend = { id:id, el:el, pid:ev.pointerId, x:ev.clientX, y:ev.clientY,
             t:setTimeout(function(){ pkArmDrag("hold"); }, PK_T_HOLD) };
  el.classList.add("arming");                 /* 「充能」看得見：誤按可以立刻鬆手 */
  window.addEventListener("pointermove", pkPendMove, true);
  window.addEventListener("pointerup", pkClearPend, true);
  /* 快速滑過時瀏覽器會發 pointercancel ⇒ 待命狀態要放棄（免費的第二道保險） */
  window.addEventListener("pointercancel", pkClearPend, true);
}
function pkPendMove(e){
  if(!pkPend || e.pointerId!==pkPend.pid) return;
  var dx = e.clientX-pkPend.x, dy = e.clientY-pkPend.y;
  if(Math.abs(dy)>PK_V_ESC && Math.abs(dy)>=Math.abs(dx)){ pkClearPend(); return; }   /* 在捲動 */
  if(Math.abs(dx)>PK_H_ARM && Math.abs(dx)>Math.abs(dy)){ pkArmDrag("swipe", e); return; }
}
function pkClearPend(){
  if(!pkPend) return;
  clearTimeout(pkPend.t);
  if(pkPend.el) pkPend.el.classList.remove("arming");
  window.removeEventListener("pointermove", pkPendMove, true);
  window.removeEventListener("pointerup", pkClearPend, true);
  window.removeEventListener("pointercancel", pkClearPend, true);
  pkPend = null;
}
function pkArmDrag(how, e){
  if(!pkPend || pkDrag) return;
  var p = pkPend, x = e?e.clientX:p.x, y = e?e.clientY:p.y;
  pkClearPend();
  try{ if(navigator.vibrate) navigator.vibrate(12); }catch(err){}
  pkBeginDrag(p.id, x, y, p.el, p.pid);
  if(pkDrag) pkDrag.how = how;
}
/* 已經在拖了就吃掉 touchmove —— 「拖曳期間才鎖捲動」真正生效的地方。
 * touch-action 在手勢一開始就決定了，中途改沒有用；只有 preventDefault 擋得住。 */
document.addEventListener("touchmove", function(e){ if(pkDrag) e.preventDefault(); }, {passive:false});

function pkBeginDrag(id, x, y, gripEl, pid){
  if(pkDrag) return;
  var item = pkById(id); if(!item) return;
  var el = document.querySelector('.pk-list [data-id="'+id+'"]');
  if(!el) return;
  var r = el.getBoundingClientRect();

  var ghost = el.cloneNode(true);
  ghost.id = "pk-ghost";
  ghost.className = el.className.replace("is-dragging","");
  var gi = ghost.querySelector(".pk-inner");     /* 拖一整個包時，浮起來的只有包那一列 */
  if(gi) gi.remove();
  ghost.style.width = Math.min(r.width*0.72, 250) + "px";
  if(el.classList.contains("pk-sub-row")){ ghost.style.background="#fff"; ghost.style.paddingLeft="6px"; }
  document.body.appendChild(ghost);

  var bar = document.createElement("div");
  bar.id = "pk-dragbar"; bar.innerHTML = "";
  document.body.appendChild(bar);

  pkDrag = { id:id, item:item, el:el, ghost:ghost, bar:bar, grip:gripEl, pid:pid,
             gw:ghost.offsetWidth, gh:ghost.offsetHeight,
             x:x, y:y, target:null, raf:0, moved:false };
  el.classList.add("is-dragging");
  if(gripEl) gripEl.classList.add("hot");
  document.documentElement.classList.add("drag-lock");     /* 拖曳期間才鎖捲動（平常放行） */
  try{ if(gripEl && pid!=null) gripEl.setPointerCapture(pid); }catch(e){}
  window.addEventListener("pointermove", packDragMove, {passive:false});
  window.addEventListener("pointerup", packDragEnd, true);
  window.addEventListener("pointercancel", packDragCancel, true);
  pkPaintDrag();
}
function packDragMove(ev){
  if(!pkDrag) return;
  if(ev.cancelable) ev.preventDefault();
  pkDrag.x = ev.clientX; pkDrag.y = ev.clientY; pkDrag.moved = true;
  pkPaintDrag();
  pkDragAutoScroll();
}
function pkDragAutoScroll(){
  if(!pkDrag || pkDrag.raf) return;
  var TH=80, SPEED=9;
  var step=function(){
    if(!pkDrag) return;
    var vh = window.innerHeight;
    /* 上緣多讓 40px：頂部那條「會掉到哪」的固定橫條擋住了最上面一段 */
    var dir = pkDrag.y < TH+40 ? -1 : (pkDrag.y > vh-TH ? 1 : 0);
    if(!dir){ pkDrag.raf=0; return; }
    window.scrollBy(0, dir*SPEED);
    pkPaintDrag();
    pkDrag.raf = requestAnimationFrame(step);
  };
  pkDrag.raf = requestAnimationFrame(step);
}
function pkPaintDrag(){
  if(!pkDrag) return;
  /* 浮起來的那張卡刻意「浮在手指上方」而不是壓在手指底下 ——
     壓在底下時它剛好完整蓋住你正要放進去的那個包，高亮等於沒做（UX 實測截圖抓到）。 */
  var gx = Math.max(8, Math.min(pkDrag.x - pkDrag.gw + 22, window.innerWidth - pkDrag.gw - 8));
  var gy = Math.max(52, pkDrag.y - pkDrag.gh - 14);
  pkDrag.ghost.style.transform = "translate("+gx+"px,"+gy+"px)";

  var draggingBag = pkIsBag(pkDrag.item);
  var y = pkDrag.y, t = null, i;

  /* ① 先看有沒有壓在某個包的「包頭那一列」中間 60% ＝放進去（包不能放進包） */
  if(!draggingBag){
    var bags = [].slice.call(document.querySelectorAll(".pk-bag"));
    for(i=0;i<bags.length;i++){
      var head = bags[i].querySelector(".pk-head-row");
      if(!head) continue;
      var hr = head.getBoundingClientRect();
      if(!hr.height) continue;
      var pad = hr.height*0.2;                     /* 上下各 20% 留給「排在它前／後」 */
      if(y > hr.top+pad && y < hr.bottom-pad){
        t = {kind:"into", bagId:bags[i].getAttribute("data-bag")};
        break;
      }
    }
  }
  /* ② 否則找最近的插入錨 */
  if(!t){
    var slots = [].slice.call(document.querySelectorAll(".pk-slot"));
    var best=null, bestD=Infinity;
    for(i=0;i<slots.length;i++){
      var sr = slots[i].getBoundingClientRect();
      if(!sr.width) continue;                                    /* 藏起來的（被拖的包裡面）跳過 */
      if(draggingBag && slots[i].getAttribute("data-b")) continue; /* 包不能插進包裡 */
      var d = Math.abs(sr.top - y);
      if(d<bestD){ bestD=d; best=slots[i]; }
    }
    if(best) t = {kind:"before", zone:best.getAttribute("data-z"), bagId:best.getAttribute("data-b"),
                  ref:best.getAttribute("data-ref"), el:best};
  }
  pkDrag.target = t;

  /* 落點提示三個一起上（缺一個都不夠）：頂部固定橫條／整卡珊瑚環／插入線＋目的地藥丸 */
  var olds = document.querySelectorAll(".drop-into");
  for(i=0;i<olds.length;i++) olds[i].classList.remove("drop-into");
  var oldLine = document.querySelector(".pk-line"); if(oldLine) oldLine.remove();

  var label = "";
  if(t && t.kind==="into"){
    var bg = document.querySelector('.pk-bag[data-bag="'+t.bagId+'"]');
    if(bg) bg.classList.add("drop-into");
    var bagItem = pkById(t.bagId);
    var bz = pkZoneOf(bagItem?bagItem.zone:ZONES[0].key);
    label = '放進　📦 '+esc(bagItem?bagItem.text:"")+'　<span class="w">（'+bz.emoji+' '+bz.label+'）</span>';
  }else if(t){
    /* 插入線是零高度的疊層（不是插進去撐開間隙）—— 撐開會讓所有 slot 在手指底下跳動、來回抖 */
    var line = document.createElement("div");
    line.className = "pk-line";
    var host = t.el.parentNode;
    line.style.top = t.el.offsetTop + "px";
    host.style.position = "relative";
    var pb = t.bagId ? pkById(t.bagId) : null;
    var where = pb ? ('📦 '+esc(pb.text)+' 裡') : (pkZoneOf(t.zone).emoji+' '+pkZoneOf(t.zone).label);
    line.innerHTML = '<span class="dot"></span><i></i><b>'+where+'</b>';
    host.appendChild(line);
    label = '排到　'+where;
  }
  pkDrag.bar.innerHTML = label ? ('→　'+label) : '放開取消';
}
function packDragEnd(){
  if(!pkDrag) return;
  if(pkDrag.raf) cancelAnimationFrame(pkDrag.raf);
  var t = pkDrag.target, item = pkDrag.item, moved = pkDrag.moved;
  pkCleanupDrag();
  if(t && moved){
    var before = {zone:item.zone, bag:item.bag};
    if(t.kind==="into"){
      var bag = pkById(t.bagId);
      if(bag){
        pkMoveTo(item, bag.zone, bag.id, "");
        ui.pk.open[bag.id] = true;
        toast("已放進「"+bag.text+"」");
      }
    }else{
      pkMoveTo(item, t.zone, t.bagId, t.ref);
      if(before.bag && !item.bag) toast("已從包裡拿出來，放在 "+pkZoneOf(item.zone).label);
      else if(before.zone!==item.zone) toast("已移到 "+pkZoneOf(item.zone).emoji+" "+pkZoneOf(item.zone).label);
    }
    persistTrip(curTrip());
  }
  render(true);
}
function packDragCancel(){
  if(!pkDrag) return;
  if(pkDrag.raf) cancelAnimationFrame(pkDrag.raf);
  pkCleanupDrag();
  render(true);
}
function pkCleanupDrag(){
  if(!pkDrag) return;
  window.removeEventListener("pointermove", packDragMove, {passive:false});
  window.removeEventListener("pointerup", packDragEnd, true);
  window.removeEventListener("pointercancel", packDragCancel, true);
  document.documentElement.classList.remove("drag-lock");
  if(pkDrag.grip) pkDrag.grip.classList.remove("hot","arming");
  if(pkDrag.ghost) pkDrag.ghost.remove();
  if(pkDrag.bar) pkDrag.bar.remove();
  if(pkDrag.el) pkDrag.el.classList.remove("is-dragging");
  var l = document.querySelector(".pk-line"); if(l) l.remove();
  var olds = document.querySelectorAll(".drop-into");
  for(var i=0;i<olds.length;i++) olds[i].classList.remove("drop-into");
  pkDrag = null;
}

/* ============================================================================
   打包的 sheet：新增／編輯（共用一張）、長按動作選單
   拖拉不可以是唯一的路（單手／清單很長／不想拖）⇒ 編輯視窗裡的「放在哪」是第二條路，
   長按是隱藏手勢、只當捷徑。
   ============================================================================ */
var pkDraft = null;
function openPackSheet(id){
  if(!requireWrite(id?"改打包項目":"加打包項目")) return;
  var src = id ? pkById(id) : null;
  pkDraft = src
    ? {id:src.id, text:src.text, zone:src.zone, bag:src.bag||"", isBag:pkIsBag(src), kids:(pkIsBag(src)?pkKids(src.id).length:0)}
    : {id:null, text:"", zone:ZONES[0].key, bag:"", isBag:false, kids:0};
  pkPaintSheet();
}
function pkSyncDraft(){
  var n = document.getElementById("pk-name");
  if(n && pkDraft) pkDraft.text = n.value;
}
function pkPaintSheet(){
  var locked = pkDraft.isBag && pkDraft.kids>0;
  openSheet(pkDraft.id ? (pkDraft.isBag?"編輯這個包":"編輯物品") : "新增物品",
    '<label class="field"><span class="fl">名稱</span>'
  + '<input id="pk-name" value="'+esc(pkDraft.text)+'" placeholder="要帶什麼？" autocomplete="off"></label>'
  + '<button class="bag-toggle'+(pkDraft.isBag?" on":"")+'" onclick="pkToggleDraftBag()"'+(locked?' disabled style="opacity:.75"':'')+'>'
  +   '<span style="font-size:20px">📦</span>'
  +   '<span class="bt-t"><b>這是一個包</b><span>'
  +     (locked ? '裡面有 '+pkDraft.kids+' 樣東西，要先清空才能取消'
              : '包自己也有一個勾（＝整包丟進行李箱了），可以打開編輯裡面的東西')
  +   '</span></span><span class="sw"><i></i></span></button>'
  + '<div class="fl pk-loc-lb">放在哪</div>'
  + pkLocList(pkDraft.bag ? pkDraft.bag : pkDraft.zone, pkDraft.isBag, pkDraft.id)
  + '<div class="d-acts">'
  +   '<button class="btn-primary" onclick="pkSubmitSheet()">'+(pkDraft.id?"儲存":"加進清單")+'</button>'
  +   (pkDraft.id ? '<button class="btn-ghost pk-del" onclick="pkDelFromSheet()">刪掉這一'+(pkDraft.isBag?"個包":"樣")+'</button>' : "")
  + '</div>');
}
/* 「放在哪」＝把所有目的地攤平成一份可點清單（區／區裡的每個包）。包本身只列得到區（只允許兩層）。 */
function pkLocList(cur, asBag, selfId){
  var out = "";
  ZONES.forEach(function(z){
    var on = (cur===z.key);
    out += '<button class="loc'+(on?" on":"")+'" onclick="pkPickLoc(\''+z.key+'\',\'\')">'
        +  '<span>'+z.emoji+'</span><span>'+z.label+'</span>'+(on?'<span class="ck">✓</span>':'')+'</button>';
    if(asBag) return;
    pkAll().filter(function(p){ return pkIsBag(p) && p.zone===z.key && p.id!==selfId; }).forEach(function(b){
      var bon = (cur===b.id);
      out += '<button class="loc sub'+(bon?" on":"")+'" onclick="pkPickLoc(\''+z.key+'\',\''+b.id+'\')">'
          +  '<span class="arw">↳</span><span>📦</span><span>'+esc(b.text)+'</span>'+(bon?'<span class="ck">✓</span>':'')+'</button>';
    });
  });
  return '<div class="loc-list">'+out+'</div>';
}
function pkPickLoc(zone, bag){ pkSyncDraft(); pkDraft.zone=zone; pkDraft.bag=bag; pkPaintSheet(); }
function pkToggleDraftBag(){
  pkSyncDraft();
  if(pkDraft.isBag && pkDraft.kids>0) return;
  pkDraft.isBag = !pkDraft.isBag;
  if(pkDraft.isBag) pkDraft.bag = "";
  pkPaintSheet();
}
function pkSubmitSheet(){
  pkSyncDraft();
  var t=curTrip(); if(!t || !pkDraft) return;
  var text = (pkDraft.text||"").trim();
  if(!text){ toast("先給它一個名字", true); return; }
  if(pkDraft.id){
    var p = pkById(pkDraft.id);
    if(p){
      p.text = text;
      if(pkDraft.isBag && !pkIsBag(p)) p.kind = "bag";
      if(!pkDraft.isBag && pkIsBag(p)) delete p.kind;
      var tgBag = pkDraft.isBag ? "" : (pkDraft.bag||"");
      /* 只在「歸屬真的改了」時才搬。否則光是改個名字就會讓它跳到容器的最後一筆
       * ——他抱怨的就是「改東西很麻煩」，不能改完名字還得再把它拖回原位。 */
      if(p.zone!==pkDraft.zone || (p.bag||"")!==tgBag) pkMoveTo(p, pkDraft.zone, tgBag, "");
      toast("已更新");
    }
  }else{
    var o = pkAddItem(text, pkDraft.zone, pkDraft.bag, pkDraft.isBag);
    if(o && o.kind==="bag") ui.pk.open[o.id] = true;
    if(pkDraft.bag) ui.pk.open[pkDraft.bag] = true;
    toast("已加入");
  }
  pkDraft = null; persistTrip(t); closeSheet(); render(true);
}
function pkDelFromSheet(){
  var t=curTrip(); if(!t || !pkDraft) return;
  var p = pkById(pkDraft.id);
  if(p) pkRemove(p);
  pkDraft = null; persistTrip(t); closeSheet(); render(true);
}
/* 長按選單（隱藏手勢、只當捷徑） */
function openPackActions(id){
  var p = pkById(id); if(!p) return;
  openSheet(esc(p.text),
    '<button class="act-row" onclick="closeSheet();openPackSheet(\''+id+'\')"><span class="ai">✎</span>改名字／換位置</button>'
  + (pkIsBag(p) ? '<button class="act-row" onclick="closeSheet();pkToggleBag(\''+id+'\')"><span class="ai">📦</span>'+(ui.pk.open[id]?"收起來":"打開看裡面")+'</button>' : "")
  + '<button class="act-row" onclick="closeSheet();togglePack(\''+id+'\')"><span class="ai">'+(p.done?"○":"✓")+'</span>'+(p.done?"取消打勾":"標成已打包")+'</button>'
  + '<button class="act-row" onclick="pkDupItem(\''+id+'\')"><span class="ai">⧉</span>複製一份</button>'
  + '<button class="act-row danger" onclick="pkDelItem(\''+id+'\')"><span class="ai">🗑</span>刪掉</button>');
}
function pkDupItem(id){
  if(!requireWrite("複製打包項目")) return;
  var p = pkById(id); if(!p) return;
  var o = pkAddItem(p.text, p.zone, p.bag, false);
  if(o) pkMoveTo(o, p.zone, p.bag, "");
  persistTrip(curTrip()); closeSheet(); render(true); toast("已複製一份");
}
function pkDelItem(id){
  if(!requireWrite("刪掉打包項目")) return;
  var p = pkById(id); if(!p) return;
  pkRemove(p); persistTrip(curTrip()); closeSheet(); render(true);
}

/* ---- 打包：全域監聽（長按 450ms ＝動作選單；點空白處收掉就地新增） ---- */
var pkLp = null, pkLpFired = false;
document.addEventListener("pointerdown", function(e){
  var row = e.target.closest && e.target.closest("[data-lp]");
  if(!row || e.target.closest(".pk-grip")) return;
  var id = row.getAttribute("data-lp");
  pkLp = {id:id, x:e.clientX, y:e.clientY, t:setTimeout(function(){
    pkLp = null; pkLpFired = true;
    if(navigator.vibrate) navigator.vibrate(12);
    openPackActions(id);
  }, 450)};
}, true);
/* 長按開了選單之後，那一下的 click 必須吞掉，否則會順便勾起來／開編輯 */
document.addEventListener("click", function(e){
  if(!pkLpFired) return;
  pkLpFired = false;
  if(e.target.closest && e.target.closest(".sheet")) return;
  e.preventDefault(); e.stopPropagation();
}, true);
document.addEventListener("pointermove", function(e){
  if(!pkLp) return;
  if(Math.abs(e.clientX-pkLp.x)>8 || Math.abs(e.clientY-pkLp.y)>8){ clearTimeout(pkLp.t); pkLp=null; }
}, true);
["pointerup","pointercancel"].forEach(function(evName){
  document.addEventListener(evName, function(){ if(pkLp){ clearTimeout(pkLp.t); pkLp=null; } }, true);
});
document.addEventListener("click", function(e){
  if(!ui.pk || !ui.pk.adding || !e.target.closest) return;
  if(e.target.closest(".pk-form") || e.target.closest(".pk-add") || e.target.closest(".sheet")) return;
  var inp = document.getElementById("pk-input");
  if(inp && (inp.value||"").trim()) return;      /* 打到一半不要被關掉 */
  ui.pk.adding = null; render(true);
});
function delExpense(id){
  if(!requireWrite("刪掉這筆花費")) return;
  var t=curTrip();
  t.expenses = t.expenses.filter(function(e){return e.id!==id;});
  persistTrip(t); render(true);
}

var noteTimer=null;
function noteInput(val){
  var t=curTrip(); if(!t) return;
  if(!STORE.canWrite()) return;
  t.notes=val;
  clearTimeout(noteTimer);
  noteTimer=setTimeout(function(){
    persistTrip(t).then(function(){
      var el=document.getElementById("note-saved");
      if(el){ el.classList.add("show"); setTimeout(function(){ el.classList.remove("show"); },1200); }
    });
  },400);
}

/* ============ Bottom sheets ============ */
var sheetLayer = document.getElementById("sheet-layer");
function openSheet(title, bodyHtml){
  /* ⚠️ 先硬關：上一張可能還在離場動畫中間（連按、或「closeSheet(); openXxx()」
     那幾條就地換頁的路徑）。不先收掉的話新舊兩張會疊在一起，
     而且舊那張的 .closing 計時器會在 240ms 後把**新的**這張清掉。 */
  sheetHardClose();
  sheetLayer.innerHTML = '<div class="backdrop" onclick="closeSheet()"></div>'
    + '<div class="sheet"><div class="sheet-head"><h3>'+title+'</h3>'
    + '<button onclick="closeSheet()" aria-label="關閉">✕</button></div>'+bodyHtml+'</div>';
  sheetLayer.hidden = false;
}
/* ---- sheet 的離場（v3.5）----
 * 進場本來就有（slideUp／fadeIn，現在改吃 token），離場原本是 hidden=true ＋ innerHTML=""
 * ＝ 瞬間消失。這裡補一個對稱的收下去。
 * ⚠️⚠️ **不掛 animationend**（手冊鐵律：全螢幕的東西卡住＝畫面關不掉）。
 *    這條計時器就是唯一的流程，而且四層保險：
 *      ① .closing 的動畫是 fill-mode:both ⇒ 就算計時器沒跑到，終態（sheet 在畫面外、
 *         遮罩全透明）跟關閉後的靜態值一模一樣 ⇒ 失敗模式是「看不出來」不是「關不掉」；
 *      ② .closing 期間整層 pointer-events:none（CSS 那邊）⇒ 看不見的東西不會攔截點擊；
 *      ③ openSheet() 一開頭就先 sheetHardClose()；
 *      ④ setTimeout 不依賴任何事件（CSS 404、reduced-motion 都照跑）。
 * 240ms 是 --dur-1(180ms) ＋ 60ms 餘裕。減少動態時動畫 1ms 就演完，
 * 那 240ms 只是「已經看不見的東西還留在 DOM 裡」，無感。 */
var sheetCloseTimer = null;
function sheetHardClose(){
  if(sheetCloseTimer){ clearTimeout(sheetCloseTimer); sheetCloseTimer = null; }
  sheetLayer.classList.remove("closing");
  sheetLayer.hidden = true;
  sheetLayer.innerHTML = "";
}
function closeSheet(){
  tplDraft=null; rp=null; pkDraft=null;
  if(sheetLayer.hidden || !sheetLayer.firstChild){ sheetHardClose(); return; }
  if(sheetLayer.classList.contains("closing")) return;   /* 連按不重播 */
  sheetLayer.classList.add("closing");
  sheetCloseTimer = setTimeout(sheetHardClose, 240);
}

function catOptions(selectedId){
  return (db.categories||[]).map(function(c){
    return '<option value="'+esc(c.id)+'"'+(c.id===selectedId?" selected":"")+'>'+esc(c.emoji)+' '+esc(c.label)+'</option>';
  }).join("");
}
/* 類別欄標籤＋「管理」入口（開管理會取代目前表單 sheet，屬已知取捨） */
function catFieldLabel(){
  return '<span class="fl">類別<button type="button" class="fl-mini" onclick="openCatManager()">管理</button></span>';
}
/* ---- 停留／移動時間欄（v1.7 改版）----
 * 「停多久（時／分）」與「待到幾點」是**同一個值的兩個窗口**，改哪一邊另一邊跟著算——
 * 刻意不做成模式切換（不必先決定用哪種，而且兩個數字同時看得到）。
 * 真值＝時／分兩格（readStay 讀它們），「待到」只是輸入捷徑，不存檔。
 * 移動（transit）沒有起點時間，所以不給「待到」、chips 換成路上常用值。 */
var STAY_CHIPS = [{v:30,t:"30 分"}, {v:60,t:"1 小時"}, {v:120,t:"2 小時"}, {v:240,t:"半天"}];
var MOVE_CHIPS = [{v:10,t:"10 分"}, {v:30,t:"30 分"}, {v:60,t:"1 小時"}, {v:120,t:"2 小時"}];
function stayField(cur, label, isMove){
  cur = Math.max(0, Math.round(Number(cur)||0));
  var chips = isMove ? MOVE_CHIPS : STAY_CHIPS;
  var hm = '<div class="stay-sub"><span class="sfl">'+(isMove?"移動多久":"停多久")+'</span>'
    + '<div class="stay-hm">'
    +   '<input type="number" name="stayH" min="0" step="1" inputmode="numeric" aria-label="小時" placeholder="0"'
    +     ' value="'+(Math.floor(cur/60)||"")+'" oninput="stayHM(this.form)"><i>時</i>'
    +   '<input type="number" name="stayM" min="0" step="1" inputmode="numeric" aria-label="分鐘" placeholder="0"'
    +     ' value="'+((cur%60)||"")+'" oninput="stayHM(this.form)"><i>分</i>'
    + '</div></div>';
  var body = isMove ? hm
    : '<div class="f-row2">'+hm
      + '<div class="stay-sub"><span class="sfl">待到</span>'
      +   '<input type="time" name="stayUntil" oninput="stayUntilChanged(this.form)">'
      + '</div></div>'
      + '<div class="hint stay-hint" hidden>先填上面的「時間」，才算得出待到幾點。</div>';
  return '<div class="field stay-field"><span class="fl">'+(label||"預計停留")+'（選填）</span>'
    + '<div class="stay-chips">'
    + chips.map(function(c){
        return '<button type="button" class="stay-chip'+(cur===c.v?" on":"")+'" data-v="'+c.v+'"'
          + ' onclick="setStay(this,'+c.v+')">'+c.t+'</button>';
      }).join("")
    + '</div>' + body + '</div>';
}
/* 起點時間＝同一張表單的「時間」欄（transit 沒有這欄 → null） */
function stayStart(f){ return (f && f.time) ? minsOf(f.time.value) : null; }
function stayWrite(f, mins){
  mins = Math.max(0, Math.round(mins||0));
  if(f.stayH) f.stayH.value = Math.floor(mins/60) || "";
  if(f.stayM) f.stayM.value = (mins%60) || "";
}
/* 同步「待到」與 chips 選中狀態。src==="until" 時不回頭覆寫他正在打的那格。 */
function staySync(f, src){
  var mins = readStay(f), st = stayStart(f);
  if(f.stayUntil){
    f.stayUntil.disabled = (st===null);
    if(src!=="until") f.stayUntil.value = (st!==null && mins>0) ? timeOf(st+mins) : "";
  }
  var hint = f.querySelector(".stay-hint");
  if(hint) hint.hidden = (st!==null);
  [].slice.call(f.querySelectorAll(".stay-chip")).forEach(function(b){
    b.classList.toggle("on", mins>0 && Number(b.getAttribute("data-v"))===mins);
  });
}
function stayHM(f){ staySync(f, "hm"); }
/* 待到比開始早＝跨午夜（23:00 待到 00:30 ＝ 停 90 分） */
function stayUntilChanged(f){
  var st = stayStart(f), u = minsOf(f.stayUntil.value);
  if(st===null || u===null) return;
  stayWrite(f, ((u-st)%1440+1440)%1440);
  staySync(f, "until");
}
function setStay(btn, v){
  var f = btn.form;
  stayWrite(f, btn.classList.contains("on") ? 0 : v); /* 再點一次＝取消 */
  staySync(f, "chip");
}
/* 「時間」欄改了＝整段往前/後移，停多久不變、待到跟著算 */
function stayTimeChanged(f){ staySync(f, "time"); }
/* sheet 進 DOM 之後才跑得到（openSheet 沒有 onDraw hook） */
function stayInit(){
  var f = sheetLayer.querySelector("form");
  if(f && f.stayH) staySync(f, "init");
}
function readStay(f){
  var h = Math.max(0, Math.floor(Number(f.stayH && f.stayH.value)||0));
  var m = Math.max(0, Math.floor(Number(f.stayM && f.stayM.value)||0));
  return h*60 + m;
}
/* v1.3：FAB 先問要加哪一種（站點 vs 路上），避免把兩種塞進同一張長表單 */
function openAddPicker(){
  if(!requireWrite("加行程點或移動")) return;
  openSheet("加到 Day "+ui.day,
    '<div class="add-pick">'
    + '<button class="add-opt" onclick="openStopSheet()">'
    +   '<span class="ao-ico">📍</span>'
    +   '<span class="ao-bd"><b>行程點</b><span>要去的地方：景點、餐廳、住宿…</span></span></button>'
    + '<button class="add-opt" onclick="openTransitSheet()">'
    +   '<span class="ao-ico">🚶</span>'
    +   '<span class="ao-bd"><b>移動</b><span>兩個地點之間的路上：搭車、走路…</span></span></button>'
    + '</div>');
}
/* 移動：只有備註＋移動時間（沿用 stayMinutes 元件） */
function openTransitSheet(){
  if(!requireWrite("加一段移動")) return;
  openSheet("新增移動・Day "+ui.day,
    '<form onsubmit="submitTransit(event)">'
    + '<label class="field"><span class="fl">怎麼移動</span>'
    +   '<input name="note" placeholder="例：地鐵銀座線、走路、計程車" autocomplete="off"></label>'
    + stayField(0, "移動時間", true)
    + '<button class="btn-primary" type="submit">加入 Day '+ui.day+'</button>'
    + '</form>');
  stayInit();
}
function submitTransit(ev){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f=ev.target, t=curTrip();
  var key=String(ui.day);
  if(!t.itinerary[key]) t.itinerary[key]=[];
  var list=t.itinerary[key];
  var push=readStay(f);          /* 推的量＝新的移動時間 */
  var at=list.length;
  list.push({ id:uid(), type:"transit", note:f.note.value.trim(), stayMinutes:push });
  /* v2.8：新增也要推後面（這條路徑以前完全不推，缺口就是這樣長出來的）。
   * 目前 UI 一律加在最後 ⇒ 實務上 moved 多半是 0；之後若做「插在中間」就直接生效。 */
  var moved=shiftAfter(list, at, push);
  persistTrip(t); closeSheet(); render();
  afterAddToast(list, moved, push);
}
function openTransitEdit(idx){
  if(!requireWrite("改這段移動")) return;
  var list=curList()||[]; var sp=list[idx]; if(!sp) return;
  openSheet("編輯移動",
    '<form onsubmit="submitTransitEdit(event,'+idx+')">'
    + '<label class="field"><span class="fl">怎麼移動</span>'
    +   '<input name="note" value="'+esc(sp.note||"")+'" placeholder="例：地鐵銀座線、走路、計程車" autocomplete="off"></label>'
    + stayField(sp.stayMinutes, "移動時間", true)
    + '<button class="btn-primary" type="submit">儲存</button>'
    + '</form>');
  stayInit();
}
function submitTransitEdit(ev, idx){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f=ev.target; var list=curList()||[]; var sp=list[idx]; if(!sp) return;
  sp.note = f.note.value.trim();
  var oldStay = Math.round(Number(sp.stayMinutes)||0);
  sp.stayMinutes = readStay(f);
  /* 移動時間變了＝後面整串跟著移（v1.6） */
  var moved = shiftAfter(list, idx, sp.stayMinutes-oldStay);
  persistTrip(curTrip()); closeSheet(); render(true);
  shiftToast(moved, sp.stayMinutes-oldStay);
}
function openStopSheet(){
  if(!requireWrite("加行程點")) return;
  /* 時間預設帶「上一站結束＋中間的移動」，接著排最順；要改再改（v1.6） */
  var guess = nextTimeGuess(curList()||[]);
  openSheet("新增行程點・Day "+ui.day,
    '<form onsubmit="submitStop(event)">'
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">時間</span><input type="time" name="time" value="'+esc(guess)+'" oninput="stayTimeChanged(this.form)"></label>'
    +   '<label class="field">'+catFieldLabel()+'<select name="cat">'+catOptions()+'</select></label>'
    + '</div>'
    + '<label class="field"><span class="fl">名稱 *</span><input name="title" required placeholder="例：淺草寺" autocomplete="off"></label>'
    + '<label class="field"><span class="fl">地點</span><input name="place" placeholder="例：東京・淺草" autocomplete="off"></label>'
    + mapField(null)
    + stayField(0)
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">營業時間（開）</span><input type="time" name="hoursOpen"></label>'
    +   '<label class="field"><span class="fl">營業時間（關）</span><input type="time" name="hoursClose"></label>'
    + '</div>'
    + '<label class="check-row"><input type="checkbox" name="hours24" onchange="toggleHours24(this)"><span class="ck-box"></span><span class="ck-lb">24 小時營業</span></label>'
    + '<label class="field"><span class="fl">備註</span><textarea name="note" rows="2" placeholder="注意事項、想吃什麼…"></textarea></label>'
    + '<div class="hint">加入後點卡片可補齊更多細節（費用、電話、官網…）</div>'
    + '<button class="btn-primary" type="submit">加入 Day '+ui.day+'</button>'
    + '</form>');
  stayInit();
}
function submitStop(ev){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f = ev.target, t = curTrip();
  var key = String(ui.day);
  if(!t.itinerary[key]) t.itinerary[key]=[];
  var h24 = !!f.hours24.checked;
  var list = t.itinerary[key];
  var push = readStay(f);        /* 推的量＝新的停留時間 */
  var at = list.length;
  list.push({
    id:uid(), time:f.time.value, title:f.title.value.trim(),
    cat:f.cat.value, place:f.place.value.trim(),
    mapUrl:f.mapUrl.value.trim(),
    stayMinutes:push,
    hours24:h24,
    hoursOpen:h24?"":f.hoursOpen.value,
    hoursClose:h24?"":f.hoursClose.value,
    note:f.note.value.trim()
  });
  var moved = shiftAfter(list, at, push);   /* v2.8：新增也要推後面（見 submitTransit 的說明） */
  persistTrip(t); closeSheet(); render();
  afterAddToast(list, moved, push);
}
/* 新增之後的回饋：有推到人就沿用既有的 shiftToast；
 * 若加完之後這一天接不上，升級成可點的 toast 直接帶去重排（demo 的建議，只在這一種情況給動作鈕）。 */
function afterAddToast(list, moved, push){
  var k = Object.keys(lateSet(list||[])).length;
  if(k){
    toast("已加入"+(moved ? ("・後面 "+moved+" 筆往後 "+formatStay(push)) : "")+"，但這天有 "+k+" 處銜接不上",
      false, { label:"重新排", fn:function(){ openReplan(-1); } });
  }else{
    shiftToast(moved, push);
  }
}

/* 新增花費時預設帶「今天是這趟的第幾天」：出發前＝行前、旅程中＝那一天。
   結束之後刻意不猜（留「沒指定」讓他自己選）——事後補記時猜錯比留白更煩。 */
function todayExpDay(t){
  var s = parseDate(t.start); if(!s) return 0;
  var a = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  var n = new Date(); n = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  var diff = Math.round((n - a) / 86400000);
  if(diff < 0) return "pre";
  if(diff < t.days) return diff + 1;
  return 0;
}
function expDayOpts(t, cur){
  var s = parseDate(t.start), h = "";
  h += '<option value=""'+(!cur?" selected":"")+'>沒指定</option>';
  h += '<option value="pre"'+(cur==="pre"?" selected":"")+'>🎫 行前（機票・訂房…）</option>';
  for(var i=1;i<=t.days;i++){
    var d = s ? addDays(s,i-1) : null;
    h += '<option value="'+i+'"'+(cur===i?" selected":"")+'>Day '+i
      + (d ? '・'+fmtMD(d)+' 週'+WD[d.getDay()] : "") + '</option>';
  }
  /* 縮天之後 day 還留在資料裡的那些：選單也要列得出來，
     否則一點開編輯就被無聲改成「沒指定」＝縮天不刪資料被繞過去了。 */
  if(typeof cur==="number" && cur>t.days){
    h += '<option value="'+cur+'" selected>Day '+cur+'（超出目前天數）</option>';
  }
  return h;
}
/* 新增與編輯共用同一張 sheet（跟 v2.6 地圖欄、打包 v2.9 同一個決策，別複製第二份 UI）。
   ⚠️ 沒有編輯＝「這一筆的歸屬沒地方改」，那正是打包 v2.9 診斷出來的病根：
      記錯天只能刪掉重打。加了 day 就一定要同時給得了改的地方。 */
function openExpenseSheet(editId){
  if(!requireWrite(editId ? "改這筆花費" : "記一筆花費")) return;
  var t = curTrip(); if(!t) return;
  var ex = null;
  if(editId) t.expenses.forEach(function(e){ if(e.id===editId) ex=e; });
  var curCat = ex ? ex.cat : "food";
  var curDay = ex ? expDayVal(ex.day) : todayExpDay(t);
  /* 預設：**還沒出發＝預計、已經出發＝已付**。規劃期在排錢、旅程中在記帳，
     兩邊最常按的那一個先選好，多數情況不用動它。 */
  var curPlan = ex ? !!ex.plan : (todayExpDay(t)==="pre");
  var opts = Object.keys(ECATS).map(function(k){
    return '<option value="'+k+'"'+(k===curCat?" selected":"")+'>'+ECATS[k].emoji+' '+ECATS[k].label+'</option>';
  }).join("");
  openSheet(ex ? "改這筆花費" : "記一筆花費",
    '<form onsubmit="submitExpense(event)">'
    /* ⚠️ 這個欄位不可以叫 name="id"：HTMLFormElement 本身就有 .id（元素的 HTML id），
       f.id 會拿到那個字串而不是這個 input，編輯會整個失效。 */
    + '<input type="hidden" name="eid" value="'+(ex?esc(ex.id):"")+'">'
    /* 預計／已付：放在最上面，因為它決定這筆算不算進「已花費」。
       用 radio 不用 checkbox —— 兩個狀態都要說得出名字，「沒打勾」不是一個狀態。 */
    /* ⚠️ `.on` 是 render 當下給的，點 radio 不會重畫整張 sheet ⇒ 一定要有 paySegSync，
       否則按了「已經付了」畫面上白片不會移動，看起來像沒反應。 */
    + '<div class="pay-seg">'
    +   '<label class="'+(curPlan?"on":"")+'"><input type="radio" name="plan" value="1" onchange="paySegSync(this)"'+(curPlan?" checked":"")+'>預計要花</label>'
    +   '<label class="'+(curPlan?"":"on")+'"><input type="radio" name="plan" value="" onchange="paySegSync(this)"'+(curPlan?"":" checked")+'>已經付了</label>'
    + '</div>'
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">金額（NT$）*</span><input type="number" name="amount" required min="0" step="1" inputmode="numeric" placeholder="0" value="'+(ex?ex.amount:"")+'"></label>'
    +   '<label class="field"><span class="fl">類別</span><select name="cat">'+opts+'</select></label>'
    + '</div>'
    + '<label class="field"><span class="fl">哪一天</span><select name="day">'+expDayOpts(t,curDay)+'</select></label>'
    + '<label class="field"><span class="fl">說明</span><input name="desc" placeholder="例：teamLab 門票" autocomplete="off" value="'+(ex?esc(ex.desc):"")+'"></label>'
    + '<button class="btn-primary" type="submit">'+(ex?"存起來":"記下來")+'</button>'
    + '</form>');
}
function paySegSync(el){
  var seg = el.closest(".pay-seg"); if(!seg) return;
  [].forEach.call(seg.querySelectorAll("label"), function(l){
    l.classList.toggle("on", !!l.querySelector("input:checked"));
  });
}
function submitExpense(ev){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f = ev.target, t = curTrip();
  var amt = Number(f.amount.value);
  if(!(amt>=0)) return;
  var day = expDayVal(f.day.value), id = f.eid.value, ex = null;
  /* radio 群組讀 f.plan.value（RadioNodeList 會給選中的那顆的 value）；
     value="" ＝已付 ⇒ 直接轉 boolean 就對了。 */
  var isPlan = !!(f.plan && f.plan.value);
  if(id) t.expenses.forEach(function(e){ if(e.id===id) ex=e; });
  if(ex){
    ex.amount=amt; ex.cat=f.cat.value; ex.desc=f.desc.value.trim(); ex.day=day; ex.plan=isPlan;
  }else{
    t.expenses.push({ id:uid(), amount:amt, cat:f.cat.value, desc:f.desc.value.trim(), day:day, plan:isPlan });
  }
  persistTrip(t); closeSheet(); render();
}

/* ---- 新增／編輯旅程（共用表單） ---- */
function openTripSheet(editId){
  if(!requireWrite(editId ? "改這趟旅程" : "規劃新旅程")) return;
  var trip = null;
  if(editId){ db.trips.forEach(function(t){ if(t.id===editId) trip=t; }); }
  var emojis = ["🧳","🗼","🏝️","⛩️","🗽","🎡","⛰️","🌸"];
  if(trip && emojis.indexOf(trip.emoji)<0) emojis.unshift(trip.emoji);
  var curEmoji = trip ? trip.emoji : emojis[0];
  var curTheme = trip ? trip.theme : Object.keys(THEMES)[0];
  var emojiPicks = emojis.map(function(e){
    return '<label class="pick"><input type="radio" name="emoji" value="'+e+'"'+(e===curEmoji?" checked":"")+'><span>'+e+'</span></label>';
  }).join("");
  /* v1.1：不再用 inline border-color:transparent（會蓋掉選中框，看不出選了哪個），
   * 選中態改由 CSS ring＋勾勾呈現 */
  var themePicks = Object.keys(THEMES).map(function(k){
    return '<label class="pick"><input type="radio" name="theme" value="'+k+'"'+(k===curTheme?" checked":"")+'>'
      + '<span class="swatch" style="background:'+THEMES[k]+'"></span></label>';
  }).join("");
  var tplField = "";
  if(!trip){
    var tplOpts = db.templates.map(function(tp){
      return '<option value="'+tp.id+'">'+esc(tp.name)+'（'+tp.items.length+' 項）</option>';
    }).join("");
    tplField = '<label class="field"><span class="fl">打包模板</span>'
      + '<select name="tpl"><option value="">不使用</option>'+tplOpts+'</select></label>'
      + '<div class="hint">選一個模板，建立旅程時自動帶入打包清單。</div>';
  }
  /* 正式版新增：編輯模式提供「刪除這趟旅程」（demo 未含，屬旅程 CRUD 的 D） */
  var delBtn = trip
    ? '<button type="button" class="btn-danger" onclick="delTrip(\''+esc(trip.id)+'\')">🗑 刪除這趟旅程</button>' : "";
  openSheet(trip ? "編輯旅程" : "規劃新旅程",
    '<form onsubmit="submitTrip(event)">'
    + '<input type="hidden" name="editId" value="'+(trip?esc(trip.id):"")+'">'
    + '<label class="field"><span class="fl">旅程名稱 *</span><input name="name" required value="'+(trip?esc(trip.name):"")+'" placeholder="例：沖繩 4 日" autocomplete="off"></label>'
    + '<label class="field"><span class="fl">目的地</span><input name="dest" value="'+(trip?esc(trip.dest):"")+'" placeholder="例：日本・沖繩" autocomplete="off"></label>'
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">出發日 *</span><input type="date" name="start" required value="'+(trip?esc(trip.start):"")+'"></label>'
    +   '<label class="field"><span class="fl">天數 *</span><input type="number" name="days" required min="1" max="30" value="'+(trip?trip.days:3)+'" inputmode="numeric"></label>'
    + '</div>'
    + (trip ? '<div class="hint">縮短天數不會刪掉行程點，把天數改回來就會再出現。</div>' : "")
    + '<label class="field"><span class="fl">預算（NT$）</span><input type="number" name="budget" min="0" step="1" inputmode="numeric" value="'+(trip?(trip.budget||""):"")+'" placeholder="0"></label>'
    + tplField
    + '<div class="field"><span class="fl">封面 emoji</span><div class="pick-row">'+emojiPicks+'</div>'
    +   '<input name="emojiCustom" class="emoji-custom" value="" placeholder="或自己打一個 emoji（會取代上面選的）" autocomplete="off" autocapitalize="off"></div>'
    + '<div class="field"><span class="fl">封面色系</span><div class="pick-row">'+themePicks+'</div></div>'
    + '<button class="btn-primary" type="submit">'+(trip?"儲存":"建立旅程")+'</button>'
    + delBtn
    + '</form>');
}
function submitTrip(ev){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f = ev.target;
  var editId = f.editId.value;
  if(editId){
    var t = null;
    db.trips.forEach(function(x){ if(x.id===editId) t=x; });
    if(!t) return;
    t.name = f.name.value.trim();
    t.dest = f.dest.value.trim();
    t.emoji = firstGrapheme(f.emojiCustom.value) || f.emoji.value || "🧳"; /* 自由輸入優先，只取第一個 grapheme */
    t.theme = f.theme.value;
    t.start = f.start.value;
    t.days = Math.min(30, Math.max(1, Number(f.days.value)||1));
    t.budget = Number(f.budget.value)||0;
    if(ui.day > t.days) ui.day = t.days;
    persistTrip(t); closeSheet(); render();
    return;
  }
  var packing = [];
  if(f.tpl && f.tpl.value){
    db.templates.forEach(function(tp){
      if(tp.id!==f.tpl.value) return;
      /* v2.9：模板可以有包 —— 包名（模板的參照）在這裡換成新旅程裡的 id */
      var bagMap = {};
      normalizeTplItems(tp.items).forEach(function(it){
        var o = {id:uid(), text:it.text, done:false, zone:(it.zone==="checked"?"checked":"carry")};
        if(it.kind==="bag"){ o.kind="bag"; bagMap[it.text]=o.id; }
        else if(it.bag && bagMap[it.bag]) o.bag = bagMap[it.bag];
        packing.push(o);
      });
    });
  }
  var name = f.name.value.trim();
  var nt = {
    id:Date.now().toString(36)+"-"+slugify(name), /* 檔名 = <ts36>-<slug>.md */
    name:name, dest:f.dest.value.trim(),
    emoji:firstGrapheme(f.emojiCustom.value) || f.emoji.value || "🧳", theme:f.theme.value,
    start:f.start.value, days:Math.min(30, Math.max(1, Number(f.days.value)||1)),
    budget:Number(f.budget.value)||0,
    createdAt:new Date().toISOString(),
    itinerary:{}, expenses:[], packing:packing, notes:""
  };
  db.trips.push(nt);
  persistTrip(nt); closeSheet(); openTrip(nt.id);
}
function delTrip(id){
  if(!requireWrite("刪掉這趟旅程")) return;
  var t=null; db.trips.forEach(function(x){ if(x.id===id) t=x; });
  if(!t) return;
  if(!confirm("刪除「"+t.name+"」？整趟的行程、花費、打包、備註都會一起刪掉，無法復原。")) return;
  db.trips = db.trips.filter(function(x){return x.id!==id;});
  chainPersist("trip:"+id, function(){ return STORE.deleteTrip(id); });
  closeSheet();
  ui.screen="home"; ui.tripId=null;
  render();
  toast("已刪除旅程");
}

/* ============ 設定（GitHub 金鑰；只在 Pages 版出現）
 * v2.0 起這裡是**進階／救援**入口：平常用下面那條解鎖藥丸（一組密碼就好），
 * 這裡留給「鑰匙圈壞掉／還沒配好」時手動貼一把金鑰把自己救回來。 ============ */
function openSettings(){
  var t = getToken();
  openSheet("設定（進階）",
    (KR_ON ? '<div class="hint" style="margin-top:0">平常不用來這裡——首頁最下面那條「點我解鎖」輸入自己的密碼就好。'
           + '這頁是鑰匙圈出問題時的救援用。</div>' : '')
    + '<label class="field"><span class="fl">GitHub 金鑰（PAT）</span>'
    + '<input id="settings-token" value="'+esc(t)+'" placeholder="github_pat_..." autocomplete="off" autocapitalize="off" spellcheck="false"></label>'
    + '<div class="hint">用 fine-grained PAT、只授權 <b>travel-book</b> 這一個 repo 的 Contents（Read and write）。'
    + '金鑰只存在這支手機的瀏覽器，不會上傳到別的地方。</div>'
    + '<div class="hint" id="settings-status">'+(t?"目前已設定金鑰（可編輯）。":"尚未設定金鑰（唯讀）。")+'</div>'
    + '<div class="d-acts">'
    + '<button class="btn-primary" onclick="saveSettings()">儲存</button>'
    + '<button class="btn-ghost" onclick="clearSettings()">清除金鑰（回到唯讀）</button>'
    + '</div>');
}
function saveSettings(){
  var inp=document.getElementById("settings-token");
  var t=(inp&&inp.value||"").trim();
  if(!t){ toast("請先貼上金鑰", true); return; }
  setToken(t);
  toast("金鑰已儲存，重新載入資料…");
  closeSheet();
  reloadData();
}
function clearSettings(){
  clearToken();
  /* 鑰匙圈記著的身分也要一起清掉，否則下次載入又把金鑰寫回來，看起來像沒清成功 */
  if(KR_ON) KR.forget();
  toast("已清除金鑰，回到唯讀");
  closeSheet();
  reloadData();
}
/* ============ 版本 sheet ============ */
function openVersion(){
  var body;
  if(updateReady){
    body = '<div class="ver-alert"><b>🎉 新版本已經下載好了</b>'
      + '<span>重新載入就會換過去。記到一半的東西已經存好了，不會不見。</span></div>'
      + '<div class="d-acts"><button class="btn-primary" onclick="location.reload()">立即更新</button></div>';
  }else{
    body = (verMsg ? '<div class="ver-alert"><b>'+esc(verMsg)+'</b></div>' : '')
      + '<div class="d-acts"><button class="btn-ghost" onclick="doCheckUpdate(this)">檢查有沒有新版本</button></div>';
  }
  openSheet("版本",
    '<div class="ver-row"><span>現在跑的版本</span><b>v'+APP_VER+'</b></div>'
    + body
    + '<div class="hint">這是<b>這台裝置實際跑的版本</b>，不是雲端最新的。平常關掉重開就會換到新版。</div>');
  verMsg="";
}
function doCheckUpdate(btn){
  btn.disabled=true; btn.textContent="檢查中…";
  checkUpdate().then(function(found){
    verMsg = found ? "" : "已經是最新版了。";
    openVersion();   /* 整份重畫這個 sheet（openSheet 本來就是換掉 innerHTML） */
  });
}

function reloadData(){
  renderBoot();
  STORE._sha = {};
  bootLoad();
}

/* ============ 啟動 ============ */
/* 載入骨架屏（取代原本那顆孤零零的 🧳）。
 * 為什麼這支真的需要：GitHub 模式的 loadAll 會對 data/trips 與 data/templates
 * 各發一次目錄 API，再逐檔 fetch 每一份旅程（**N+2 個請求**）——手機在外面用行動網路
 * 那是好幾秒的空白。骨架長得像首頁的旅程卡（封面 ＋ 一列 meta），
 * 使用者一眼就知道「等一下會出現什麼」，而不是「這個 App 是不是掛了」。
 * ⚠️ 三張是固定的：這裡還沒有資料，猜不出他有幾趟旅程；三張剛好填滿一個手機畫面。
 * ⚠️ 「有點慢」那句由 CSS 的 animation-delay:8s 帶出來，**不用 JS 計時器**
 *    ⇒ 沒有要清的東西：render() 換掉 innerHTML 時它就跟著消失。
 * ⚠️ aria-hidden：這是等待中的佔位圖形，不要讀給輔助技術聽。 */
function renderBoot(){
  var cards = "";
  for(var i=0;i<3;i++){
    cards += '<div class="sk-card"><div class="sk-cover"></div>'
      + '<div class="sk-meta"><span class="sk-bar"></span><span class="sk-pill"></span></div></div>';
  }
  appEl.innerHTML = '<div class="sk-wrap" aria-hidden="true">'
    + '<div class="sk-head"><span class="sk-bar t1"></span><span class="sk-bar t2"></span><span class="sk-bar t3"></span></div>'
    + '<div class="sk-list">'+cards+'</div>'
    + '<p class="sk-slow">還在等旅程資料…網路好像有點慢。</p>'
    + '</div>';
}
/* ⚠️ class 是 .bootmsg 不是 .boot：motion/splash.js 收場時會把 class **boot**
 * 掛到 #app 上 ⇒ `#app.boot` 會命中 `.boot{…}`（置中的 flex column），
 * 整個首頁在那 1.4 秒會塌成一團。別改回去。 */
function renderBootError(e){
  appEl.innerHTML = '<div class="bootmsg"><div class="big">🌧️</div>'
    + '<p>'+esc((e&&e.userMessage)||"資料載入失敗")+'</p>'
    + '<button class="btn-primary" onclick="bootLoad()">再試一次</button>'
    + (STORE.local?'':'<button class="btn-ghost" style="width:auto;padding:0 26px" onclick="openSettings()">設定</button>')
    + '</div>';
}
var booted=false;
function bootLoad(){
  renderBoot();
  STORE.loadAll().then(function(d){
    db = migrate(d);
    rebuildCats();
    booted=true;
    render();
    /* 這台裝置從沒解鎖過、也沒看過解鎖 sheet -> 主動端一次，之後永遠不再自動彈 */
    if(KR_ON) KR.maybeIntro();
  }).catch(function(e){
    renderBootError(e);
  }).then(splashReady, splashReady);   /* 成功或失敗都要收開場 */
}
bootLoad();

/* ============ 版本與更新 ============
 * PWA 的殼是 cache-first，新的 service worker 裝好、activate 之後，
 * 畫面上跑的仍然是舊的 JS，要重新載入才會換過去——使用者看不到這件事，
 * 只會覺得「怎麼沒有新功能」。所以偵測到新版就記起來（updateReady），
 * footer 那顆改口成「點一下更新」，由使用者自己按。
 * ⚠️ 刻意不自動 reload：編行程編到一半被彈掉很惱人。
 * ⚠️ 改前端時 APP_VER 與 sw.js 的 cache 版本號要一起 +1。 */
var swReg=null;
var updateReady=false;
var verMsg="";                 /* 「檢查更新」的結果訊息，畫完就清掉 */

function markUpdate(){
  if(updateReady) return;
  updateReady=true;
  toast("有新版本了，首頁最下面點一下就能更新");
  if(booted) render(true);
}

if("serviceWorker" in navigator){
  /* 第一次安裝時本來就沒有 controller，那不算「更新」，不要嚇人 */
  var hadController=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", function(){
    if(!hadController){ hadController=true; return; }
    markUpdate();
  });
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("sw.js").then(function(reg){
      swReg=reg;
      /* 標準的偵測點：新的 worker 裝好、而且原本就有一個在跑 ＝ 有新版 */
      reg.addEventListener("updatefound", function(){
        var w=reg.installing;
        if(!w) return;
        w.addEventListener("statechange", function(){
          if(w.state==="installed" && navigator.serviceWorker.controller) markUpdate();
        });
      });
    }).catch(function(){ /* 沒 SW 也能用 */ });
  });
}

/* 主動問一次有沒有新版。瀏覽器自己也會檢查，但頻率不保證，
 * 使用者想「現在就確認」的時候要有東西可以按。 */
function checkUpdate(){
  if(!swReg || !swReg.update) return Promise.resolve(false);
  return swReg.update().then(function(){
    /* sw.js 有 skipWaiting，新的通常直接 activate，訊號由上面兩個 handler 送達；
     * 這裡等一下下讓它跑完再回報結果。 */
    return new Promise(function(res){
      setTimeout(function(){ res(updateReady); }, 1200);
    });
  }).catch(function(){ return false; });
}
