"use strict";
/*
 * 旅途手帳 — 前端（視覺與互動照 UX demo v3.1，勿自行改設計）
 * 資料層：DataStore 依 location.hostname 自動切
 *   localhost -> LocalStore：打本機 Node /api（全功能）
 *   其他(GitHub Pages) -> GitHubStore：直接讀寫 GitHub repo
 *     有 PAT -> 認證 Contents API 讀寫（即時）；無 PAT -> 唯讀走 raw + sha cache-buster
 * md 序列化與 server.js 是同一套 mirror，改格式要兩邊一起改（見 CLAUDE.md）
 */

/* ============ 常數 ============ */
/* 版本號的唯一來源：首頁 footer 與「版本」sheet 都讀它。
 * 改前端時跟 sw.js 的 cache 版本號一起 +1（見「版本與更新」段）。 */
var APP_VER="1.7";

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
function spentOf(t){
  var s=0; for(var i=0;i<t.expenses.length;i++) s+=Number(t.expenses[i].amount)||0; return s;
}
function zoneCount(items, z){
  return items.filter(function(i){return i.zone===z;}).length;
}

/* ============ toast（正式版新增：錯誤/唯讀提示） ============ */
var toastEl = document.getElementById("toast");
var toastTimer = null;
function toast(msg, isErr){
  toastEl.textContent = msg;
  toastEl.className = isErr ? "err" : "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ toastEl.className += " hidden"; }, 2600);
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
function cleanExpense(e){
  return { id:String(e.id||""), amount:Number(e.amount)||0, cat:String(e.cat||"other"), desc:String(e.desc||"") };
}
function cleanPackItem(p){
  return { id:String(p.id||""), text:String(p.text||""), done:!!p.done, zone:(p.zone==="checked"?"checked":"carry") };
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
  (t.packing||[]).forEach(function(p){ L.push("- "+JSON.stringify(cleanPackItem(p))); });
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
  t.notes=notesBuf.join("\n").trim();
  if(!(t.days>=1)) t.days=1;
  return t;
}
function serializeTemplate(tp){
  var L=["---","name: "+fmString(tp.name),"---","","## 項目",""];
  (tp.items||[]).forEach(function(it){
    L.push("- "+JSON.stringify({text:String(it.text||""), zone:(it.zone==="checked"?"checked":"carry")}));
  });
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
      tp.items.push({text:String(obj.text||""), zone:(obj.zone==="checked"?"checked":"carry")});
    }catch(e){}
  });
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
function getToken(){ try{ return localStorage.getItem(TOKEN_KEY)||""; }catch(e){ return ""; } }
function setToken(t){ try{ localStorage.setItem(TOKEN_KEY,t); }catch(e){} }
function clearToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch(e){} }

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

/* 唯讀守門（Pages 無金鑰） */
function requireWrite(){
  if(STORE.canWrite()) return true;
  toast("唯讀模式：到下方「設定」貼上金鑰才能編輯", true);
  return false;
}

/* ============ 資料 + 舊資料遷移（冪等） ============ */
var db = { trips:[], templates:[], categories:defaultCategories() };
function migrate(d){
  if(!d) d={};
  if(!Array.isArray(d.trips)) d.trips=[];
  if(!Array.isArray(d.templates)) d.templates=[];
  /* 類別：來源沒有（舊資料/Pages 上檔案還沒建）就用內建六類；並保證「其他」存在 */
  d.categories = (Array.isArray(d.categories) && d.categories.length)
    ? normalizeCategories(d.categories) : defaultCategories();
  d.trips.forEach(function(t){
    if(!t.itinerary) t.itinerary={};
    if(!Array.isArray(t.expenses)) t.expenses=[];
    if(!Array.isArray(t.packing)) t.packing=[];
    if(t.notes==null) t.notes="";
    (t.packing||[]).forEach(function(p){
      if(p.zone!=="carry" && p.zone!=="checked") p.zone="carry"; /* 舊資料沒分區 -> 歸隨身 */
    });
  });
  return d;
}

/* ============ UI 狀態 ============ */
var ui = { screen:"home", tripId:null, tab:"plan", day:1, edit:false, packZone:"carry", showEnded:false };
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
  var mode = STORE.canWrite() ? "已連線 GitHub・可編輯" : "唯讀模式・貼上金鑰即可編輯";
  return '<footer class="home-foot">'+mode+'　'
    + '<button onclick="openSettings()">設定</button>'
    + '<button onclick="reloadData()">重新整理</button>'
    + verBtn()+'</footer>';
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
  var items;
  if(!list.length){
    items = '<div class="empty"><div class="big">🌤️</div>'
      + '<p>Day '+ui.day+' 還是空白的，<br>想到什麼就先丟進來吧</p>'
      + '<button class="btn-primary" onclick="openStopSheet()">＋ 加入第一個行程點</button></div>';
  }else{
    items = list.map(function(sp, idx){
      var c = CATS[sp.cat] || CATS.other;
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
        return '<div class="stop transit">'
          + '<div class="rail"><span class="dot mini"></span><span class="ln dash"></span></div>'
          + '<div class="transit-bar'+(ui.edit?"":" tappable")+'"'
          +   (ui.edit?"":' onclick="openTransitEdit('+idx+')"')+'>'
          +   '<span class="tr-ico">🚶</span><span class="tr-txt">'+txt+'</span>'
          +   (ui.edit ? right : '')
          + '</div></div>';
      }
      if(!ui.edit){
        var href = mapLink(sp);
        right = href ? '<a class="map-btn" href="'+esc(href)+'" target="_blank" rel="noopener"'
          + ' onclick="event.stopPropagation()" aria-label="開啟地圖">🗺️</a>' : "";
      }
      var tap = ui.edit ? "" : ' onclick="openStopDetail('+idx+')"';
      return '<div class="stop">'
        + '<div class="rail"><span class="dot" style="background:'+c.color+'"></span><span class="ln"></span></div>'
        + '<div class="stop-card'+(ui.edit?"":" tappable")+'"'+tap+'>'
        +   '<div class="stop-top">'+timeHtml(sp)
        +     '<span class="cat-pill" style="color:'+c.color+'; background:'+c.color+'1a">'+c.emoji+' '+c.label+'</span>'
        +     right + '</div>'
        +   '<div class="stop-name">'+esc(sp.title)+'</div>'
        +   (sp.place ? '<div class="stop-place">📍 '+esc(sp.place)+'</div>' : "")
        +   (sp.note ? '<div class="stop-note">'+esc(sp.note)+'</div>' : "")
        + '</div></div>';
    }).join("");
  }
  return '<div class="day-bar"><div class="day-chips">'+chips+'</div>'
    + '<button class="edit-toggle '+(ui.edit?"on":"")+'" onclick="toggleEdit()">'+(ui.edit?"完成":"調整")+'</button></div>'
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
  if(sp.cost)  rows += row("💰","預估費用",money(sp.cost));
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
    + (href ? '<a class="btn-ghost" href="'+esc(href)+'" target="_blank" rel="noopener">🗺️ 開啟 Google 地圖</a>' : "")
    + '<button class="btn-primary" onclick="openStopEdit('+idx+')">✎ 編輯</button>'
    + '</div>');
}
function toggleHours24(cb){
  var f = cb.form;
  f.hoursOpen.disabled = cb.checked;
  f.hoursClose.disabled = cb.checked;
}
function openStopEdit(idx){
  if(!requireWrite()) return;
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
    + '<label class="field"><span class="fl">Google Maps 連結</span><input name="mapUrl" inputmode="url" value="'+esc(sp.mapUrl||"")+'" placeholder="貼上地圖分享連結（沒填就用地點文字搜尋）" autocomplete="off"></label>'
    + stayField(sp.stayMinutes)
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">預估費用（NT$）</span><input type="number" name="cost" min="0" step="1" inputmode="numeric" value="'+(sp.cost||"")+'"></label>'
    +   '<label class="field"><span class="fl">聯絡電話</span><input type="tel" name="phone" value="'+esc(sp.phone||"")+'" autocomplete="off"></label>'
    + '</div>'
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
  sp.time = f.time.value;
  sp.cat = f.cat.value;
  sp.place = f.place.value.trim();
  sp.mapUrl = f.mapUrl.value.trim();
  sp.cost = Number(f.cost.value)||0;
  var oldStay = Math.round(Number(sp.stayMinutes)||0);
  sp.stayMinutes = readStay(f); /* 0＝清空（serializer 不寫空值） */
  /* 停留變長／變短＝後面整串跟著移（v1.6） */
  var moved = shiftAfter(list, idx, sp.stayMinutes-oldStay);
  /* bookingRef（訂位代號）欄位 v1.1 起 UI 不再提供，但既有值刻意不動（round-trip 保留） */
  sp.phone = f.phone.value.trim();
  sp.hours24 = !!f.hours24.checked;
  sp.hoursOpen = sp.hours24 ? "" : f.hoursOpen.value;
  sp.hoursClose = sp.hours24 ? "" : f.hoursClose.value;
  if(sp.hours24 || sp.hoursOpen || sp.hoursClose) sp.hours = ""; /* 結構化資料取代舊自由文字 */
  sp.url = f.url.value.trim();
  sp.note = f.note.value.trim();
  persistTrip(curTrip()); closeSheet(); render(true);
  shiftToast(moved, sp.stayMinutes-oldStay);
}

/* ---- 花費 ---- */
function viewBudget(t){
  var spent = spentOf(t);
  var pct = t.budget>0 ? Math.min(100, Math.round(spent/t.budget*100)) : 0;
  var over = t.budget>0 && spent>t.budget;
  var remain = t.budget - spent;
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
    rows = t.expenses.slice().reverse().map(function(e){
      var c = ECATS[e.cat]||ECATS.other;
      return '<div class="exp-item">'
        + '<div class="exp-emo">'+c.emoji+'</div>'
        + '<div class="exp-mid"><div class="d">'+esc(e.desc||c.label)+'</div><div class="c">'+c.label+'</div></div>'
        + '<div class="exp-amt">'+money(e.amount)+'</div>'
        + '<button class="x-btn" onclick="delExpense(\''+e.id+'\')" aria-label="刪除">✕</button>'
        + '</div>';
    }).join("");
  }
  return '<section class="budget-card">'
    +   '<div class="lbl">已花費</div><div class="big">'+money(spent)+'</div>'
    +   '<div class="prog"><i class="'+(over?"over":"")+'" style="width:'+pct+'%"></i></div>'
    +   '<div class="budget-row"><span>預算 '+money(t.budget)+'</span>'
    +     '<span>'+(over?'超支 <b class="over">'+money(-remain)+'</b>':'還可以花 <b>'+money(remain)+'</b>')+'</span></div>'
    + '</section>'
    + (sumChips ? '<div class="cat-sums">'+sumChips+'</div>' : "")
    + '<div class="sec-title">花費紀錄</div>' + rows;
}

/* ---- 打包（行李／隨身 兩區 + 模板） ---- */
function viewPack(t){
  var zone = ZONES.filter(function(z){return z.key===ui.packZone;})[0] || ZONES[1];
  var seg = '<div class="seg">'+ZONES.map(function(z){
    return '<button type="button" class="'+(ui.packZone===z.key?"on":"")+'" onclick="setPackZone(\''+z.key+'\')">'
      + z.emoji+' '+z.label+'</button>';
  }).join("")+'</div>';
  var tplRow = '<div class="tpl-row">'
    + '<button onclick="openTplPicker()">📦 從模板帶入</button>'
    + '<button onclick="openTplManager()">管理模板</button></div>';
  var emptyCta = !t.packing.length
    ? '<button class="btn-ghost" style="margin-top:14px" onclick="openTplPicker()">📦 清單空空的，從模板帶入一套</button>' : "";
  var secs = ZONES.map(function(z){
    var items = t.packing.filter(function(p){return p.zone===z.key;});
    var done = items.filter(function(p){return p.done;}).length;
    var rows;
    if(!items.length){
      rows = '<div class="pack-sec-empty">這區還沒有東西</div>';
    }else{
      rows = '<ul>'+items.map(function(p){
        return '<li class="pack-item '+(p.done?"done":"")+'">'
          + '<button class="pack-main" onclick="togglePack(\''+p.id+'\')">'
          +   '<span class="pk-box">'+(p.done?"✓":"")+'</span><span class="txt">'+esc(p.text)+'</span></button>'
          + '<button class="x-btn" onclick="delPack(\''+p.id+'\')" aria-label="刪除">✕</button>'
          + '</li>';
      }).join("")+'</ul>';
    }
    return '<section class="pack-sec">'
      + '<div class="pack-head"><span class="t">'+z.emoji+' '+z.label+'（'+z.sub+'）</span>'
      + '<span class="n">已打包 '+done+' / '+items.length+'</span></div>'
      + rows + '</section>';
  }).join("");
  return seg
    + '<form class="pack-add" onsubmit="addPack(event)">'
    +   '<input id="pack-input" name="text" placeholder="要帶什麼？加到「'+zone.emoji+' '+zone.label+'」" autocomplete="off" required>'
    +   '<button type="submit">加入</button></form>'
    + tplRow + emptyCta + secs;
}
function setPackZone(z){
  var inp = document.getElementById("pack-input");
  var v = inp ? inp.value : "";
  ui.packZone = z;
  render(true);
  var again = document.getElementById("pack-input");
  if(again) again.value = v;
}

/* ---- 打包模板：帶入 / 管理 / 編輯 ---- */
function tplCounts(tp){
  return "🧳 "+zoneCount(tp.items,"checked")+" ・ 🎒 "+zoneCount(tp.items,"carry");
}
function openTplPicker(){
  var rows = db.templates.map(function(tp){
    return '<div class="tpl-card"><div class="tpl-info"><b>'+esc(tp.name)+'</b><span>'+tplCounts(tp)+'</span></div>'
      + '<button class="tpl-apply" onclick="applyTemplate(\''+tp.id+'\')">帶入</button></div>';
  }).join("");
  if(!rows) rows = '<p class="d-empty">還沒有模板，先去「管理模板」建一個</p>';
  openSheet("從模板帶入",
    rows
    + '<div class="hint" style="margin-top:12px">帶入時會自動跳過清單裡已經有的同名項目。</div>'
    + '<div class="d-acts"><button class="btn-ghost" onclick="openTplManager()">管理模板</button></div>');
}
function applyTemplate(id){
  if(!requireWrite()) return;
  var t=curTrip(); if(!t) return;
  var tp=null; db.templates.forEach(function(x){ if(x.id===id) tp=x; });
  if(!tp) return;
  var existing = {};
  t.packing.forEach(function(p){ existing[p.text.trim()] = true; });
  tp.items.forEach(function(it){
    if(existing[it.text.trim()]) return;
    t.packing.push({id:uid(), text:it.text, done:false, zone:(it.zone==="checked"?"checked":"carry")});
  });
  persistTrip(t); closeSheet(); render(true);
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
  if(!requireWrite()) return;
  if(!confirm("刪除這個模板？（不影響已帶入各旅程的項目）")) return;
  db.templates = db.templates.filter(function(t){return t.id!==id;});
  chainPersist("tpl:"+id, function(){ return STORE.deleteTemplate(id); });
  openTplManager();
}
var tplDraft = null;
function openTplEdit(id){
  if(!requireWrite()) return;
  var src=null;
  if(id){ db.templates.forEach(function(t){ if(t.id===id) src=t; }); }
  tplDraft = src
    ? {id:src.id, name:src.name, zone:"carry", pending:"", items:src.items.map(function(i){return {text:i.text, zone:i.zone};})}
    : {id:null, name:"", zone:"carry", pending:"", items:[]};
  renderTplEdit();
}
function syncTplDraft(){
  var n=document.getElementById("tpl-name"); if(n) tplDraft.name=n.value;
  var i=document.getElementById("tpl-item-input"); if(i) tplDraft.pending=i.value;
}
function renderTplEdit(){
  var segHtml = '<div class="seg">'+ZONES.map(function(z){
    return '<button type="button" class="'+(tplDraft.zone===z.key?"on":"")+'" onclick="setTplZone(\''+z.key+'\')">'
      + z.emoji+' '+z.label+'</button>';
  }).join("")+'</div>';
  var lists = ZONES.map(function(z){
    var rows = tplDraft.items.map(function(it,i){ return {it:it, i:i}; })
      .filter(function(x){ return x.it.zone===z.key; })
      .map(function(x){
        return '<div class="tpl-item"><span>'+z.emoji+'</span><span class="tx">'+esc(x.it.text)+'</span>'
          + '<button class="x-btn" onclick="delTplItem('+x.i+')" aria-label="刪除">✕</button></div>';
      }).join("");
    return '<div class="tpl-sec-h">'+z.emoji+' '+z.label+'（'+z.sub+'）</div>'
      + (rows || '<div class="tpl-none">還沒有項目</div>');
  }).join("");
  openSheet(tplDraft.id ? "編輯模板" : "新增模板",
    '<label class="field"><span class="fl">模板名稱 *</span><input id="tpl-name" value="'+esc(tplDraft.name)+'" placeholder="例：露營裝備" autocomplete="off"></label>'
    + segHtml
    + '<form class="pack-add" onsubmit="addTplItem(event)">'
    +   '<input id="tpl-item-input" value="'+esc(tplDraft.pending)+'" placeholder="新增項目到「'+(tplDraft.zone==="checked"?"🧳 行李":"🎒 隨身")+'」" autocomplete="off" required>'
    +   '<button type="submit">加入</button></form>'
    + lists
    + '<div class="d-acts"><button class="btn-primary" onclick="saveTpl()">儲存模板</button></div>');
}
function setTplZone(z){ syncTplDraft(); tplDraft.zone=z; renderTplEdit(); }
function addTplItem(ev){
  ev.preventDefault();
  syncTplDraft();
  var text=(tplDraft.pending||"").trim(); if(!text) return;
  tplDraft.items.push({text:text, zone:tplDraft.zone});
  tplDraft.pending="";
  renderTplEdit();
  var inp=document.getElementById("tpl-item-input");
  if(inp) inp.focus({preventScroll:true});
}
function delTplItem(i){ syncTplDraft(); tplDraft.items.splice(i,1); renderTplEdit(); }
function saveTpl(){
  if(!requireWrite()) return;
  syncTplDraft();
  var name=(tplDraft.name||"").trim() || "未命名模板";
  var saved=null;
  if(tplDraft.id){
    db.templates.forEach(function(t){ if(t.id===tplDraft.id){ t.name=name; t.items=tplDraft.items; saved=t; } });
  }else{
    saved = {id:Date.now().toString(36)+"-"+slugify(name), name:name, items:tplDraft.items};
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
  if(!requireWrite()) return;
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
  if(!requireWrite()) return;
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
  return '<div class="notes-hint"><span>'+(ro?"唯讀模式（貼上金鑰即可編輯）":"航班、訂房代號、緊急聯絡…都丟這裡")+'</span>'
    +   '<span class="note-saved" id="note-saved">已儲存 ✓</span></div>'
    + '<textarea class="notes-area" '+(ro?"readonly ":"")+'oninput="noteInput(this.value)" '
    +   'placeholder="例：&#10;去程航班 BR198 09:20&#10;飯店訂房代號 ABC-123">'+esc(t.notes)+'</textarea>';
}

/* ============ 動作 ============ */
function openTrip(id){ ui.screen="trip"; ui.tripId=id; ui.tab="plan"; ui.day=1; ui.edit=false; render(); }
function goHome(){ ui.screen="home"; render(); }
function setTab(tab){ ui.tab=tab; ui.edit=false; render(); }
function setDay(d){ ui.day=d; render(); }
function toggleEdit(){
  if(!ui.edit && !requireWrite()) return;
  ui.edit=!ui.edit; render(true);
}

function delStop(idx){
  if(!requireWrite()) return;
  var list=curList(); if(!list) return;
  list.splice(idx,1); persistTrip(curTrip()); render(true);
}
function togglePack(id){
  if(!requireWrite()) return;
  var t=curTrip();
  t.packing.forEach(function(p){ if(p.id===id) p.done=!p.done; });
  persistTrip(t); render(true);
}
function delPack(id){
  if(!requireWrite()) return;
  var t=curTrip();
  t.packing = t.packing.filter(function(p){return p.id!==id;});
  persistTrip(t); render(true);
}
function addPack(ev){
  ev.preventDefault();
  if(!requireWrite()) return;
  var t=curTrip();
  var input=document.getElementById("pack-input");
  var text=(input.value||"").trim(); if(!text) return;
  t.packing.push({id:uid(), text:text, done:false, zone:ui.packZone});
  persistTrip(t); render(true);
  var again=document.getElementById("pack-input");
  if(again) again.focus({preventScroll:true});
}
function delExpense(id){
  if(!requireWrite()) return;
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
  sheetLayer.innerHTML = '<div class="backdrop" onclick="closeSheet()"></div>'
    + '<div class="sheet"><div class="sheet-head"><h3>'+title+'</h3>'
    + '<button onclick="closeSheet()" aria-label="關閉">✕</button></div>'+bodyHtml+'</div>';
  sheetLayer.hidden = false;
}
function closeSheet(){ sheetLayer.hidden=true; sheetLayer.innerHTML=""; tplDraft=null; }

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
  if(!requireWrite()) return;
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
  if(!requireWrite()) return;
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
  t.itinerary[key].push({ id:uid(), type:"transit", note:f.note.value.trim(), stayMinutes:readStay(f) });
  persistTrip(t); closeSheet(); render();
}
function openTransitEdit(idx){
  if(!requireWrite()) return;
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
  if(!requireWrite()) return;
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
    + '<label class="field"><span class="fl">Google Maps 連結</span><input name="mapUrl" inputmode="url" placeholder="貼上地圖分享連結（沒填就用地點文字搜尋）" autocomplete="off"></label>'
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
  t.itinerary[key].push({
    id:uid(), time:f.time.value, title:f.title.value.trim(),
    cat:f.cat.value, place:f.place.value.trim(),
    mapUrl:f.mapUrl.value.trim(),
    stayMinutes:readStay(f),
    hours24:h24,
    hoursOpen:h24?"":f.hoursOpen.value,
    hoursClose:h24?"":f.hoursClose.value,
    note:f.note.value.trim()
  });
  persistTrip(t); closeSheet(); render();
}

function openExpenseSheet(){
  if(!requireWrite()) return;
  var opts = Object.keys(ECATS).map(function(k){
    return '<option value="'+k+'">'+ECATS[k].emoji+' '+ECATS[k].label+'</option>';
  }).join("");
  openSheet("記一筆花費",
    '<form onsubmit="submitExpense(event)">'
    + '<div class="f-row2">'
    +   '<label class="field"><span class="fl">金額（NT$）*</span><input type="number" name="amount" required min="0" step="1" inputmode="numeric" placeholder="0"></label>'
    +   '<label class="field"><span class="fl">類別</span><select name="cat">'+opts+'</select></label>'
    + '</div>'
    + '<label class="field"><span class="fl">說明</span><input name="desc" placeholder="例：teamLab 門票" autocomplete="off"></label>'
    + '<button class="btn-primary" type="submit">記下來</button>'
    + '</form>');
}
function submitExpense(ev){
  ev.preventDefault();
  if(!requireWrite()) return;
  var f = ev.target, t = curTrip();
  var amt = Number(f.amount.value);
  if(!(amt>=0)) return;
  t.expenses.push({ id:uid(), amount:amt, cat:f.cat.value, desc:f.desc.value.trim() });
  persistTrip(t); closeSheet(); render();
}

/* ---- 新增／編輯旅程（共用表單） ---- */
function openTripSheet(editId){
  if(!requireWrite()) return;
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
      if(tp.id===f.tpl.value){
        packing = tp.items.map(function(it){
          return {id:uid(), text:it.text, done:false, zone:(it.zone==="checked"?"checked":"carry")};
        });
      }
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
  if(!requireWrite()) return;
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

/* ============ 設定（GitHub 金鑰；只在 Pages 版出現） ============ */
function openSettings(){
  var t = getToken();
  openSheet("設定",
    '<label class="field"><span class="fl">GitHub 金鑰（PAT）</span>'
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
function renderBoot(msgHtml){
  appEl.innerHTML = '<div class="boot"><div class="big">🧳</div><p>'+(msgHtml||"整理行李中…")+'</p></div>';
}
function renderBootError(e){
  appEl.innerHTML = '<div class="boot"><div class="big">🌧️</div>'
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
  }).catch(function(e){
    renderBootError(e);
  });
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
