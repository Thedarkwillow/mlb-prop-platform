const fs = require("fs");
const path = require("path");
const cp = require("child_process");

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }

function date(){
  if (process.env.npm_config_date) return process.env.npm_config_date;
  if (process.env.DATE) return process.env.DATE;
  try { return cp.execSync("node scripts/local/board-slate-date.cjs",{encoding:"utf8"}).trim(); }
  catch { return new Date().toISOString().slice(0,10); }
}

function normMarket(v){
  const x=s(v).toLowerCase().replace(/\(pp\)/g," pp").replace(/[^a-z0-9+]+/g,"_").replace(/^_+|_+$/g,"").replace(/_+/g,"_");
  const map={
    hitter_fantasy_score_pp:"hitter_fantasy_score",
    hitter_fantasy_score:"hitter_fantasy_score",
    fantasy_score:"hitter_fantasy_score",
    fantasy_score_pp:"hitter_fantasy_score",
    hits_runs_rbis:"hrr",
    "hits+runs+rbis":"hrr",
    hrr:"hrr"
  };
  return map[x]||x;
}

function side(v){
  const x=s(v).toUpperCase();
  if(/LESS|UNDER/.test(x)) return "LESS";
  if(/MORE|OVER/.test(x)) return "MORE";
  return x;
}

function tier(v){
  return s(v).toLowerCase();
}

function player(r){ return s(r.player||r.playerName||r.name); }
function team(r){ return s(r.team||r.teamAbbr||r.playerTeam); }
function market(r){ return normMarket(r.market||r.statType||r.stat||r.projection_type); }
function line(r){ return n(r.line ?? r.projectionLine ?? r.threshold); }
function prob(r){ return n(r.probability ?? r.prob ?? r.p); }
function ev(r){ return n(r.ev ?? r.expectedValue); }

const DATE=date();
const board=read("outputs/priced-board.json",[]);
const rows=Array.isArray(board)?board:[];

const pfCard=read("outputs/clean-standard-pf-lean-card.json",{rows:[]});
const pfRows=Array.isArray(pfCard.rows)?pfCard.rows:[];

const isStandard = r => !tier(r.tier||r.oddsTier||"standard").includes("goblin") && !tier(r.tier||r.oddsTier||"standard").includes("demon");

const hrrLess = rows.filter(r =>
  player(r) &&
  isStandard(r) &&
  market(r)==="hrr" &&
  side(r.side||r.pick||r.direction)==="LESS" &&
  line(r)!==null
).map(r => ({
  player:player(r), team:team(r), market:"hrr", side:"LESS", line:line(r),
  probability:prob(r), ev:ev(r),
  pfSignalMatch:!!r.pfSignalMatch,
  pfSignalMatchType:r.pfSignalMatchType||"",
  pfSignalUsableForModel:!!r.pfSignalUsableForModel,
  pfSignalDecisionEligible:!!r.pfSignalDecisionEligible,
  pfTrendAvg:r.pfTrendAvg??null,
  pfLineupConfirmed:!!r.pfLineupConfirmed,
  pfBattingOrder:r.pfBattingOrder??null,
  source:"RESEARCH_HRR_LESS"
})).sort((a,b)=>(b.probability??0)-(a.probability??0)||(b.ev??0)-(a.ev??0)).slice(0,50);

const fantasyLess = rows.filter(r =>
  player(r) &&
  isStandard(r) &&
  market(r)==="hitter_fantasy_score" &&
  side(r.side||r.pick||r.direction)==="LESS" &&
  line(r)!==null &&
  line(r)>=6.5
).map(r => ({
  player:player(r), team:team(r), market:"hitter_fantasy_score", side:"LESS", line:line(r),
  probability:prob(r), ev:ev(r),
  pfSignalMatch:!!r.pfSignalMatch,
  pfSignalMatchType:r.pfSignalMatchType||"",
  pfSignalUsableForModel:!!r.pfSignalUsableForModel,
  pfSignalDecisionEligible:!!r.pfSignalDecisionEligible,
  pfTrendAvg:r.pfTrendAvg??null,
  pfLineupConfirmed:!!r.pfLineupConfirmed,
  pfBattingOrder:r.pfBattingOrder??null,
  source:"RESEARCH_FANTASY_LESS"
})).sort((a,b)=>(b.probability??0)-(a.probability??0)||(b.ev??0)-(a.ev??0)).slice(0,50);

const snapshot={
  date:DATE,
  generatedAt:new Date().toISOString(),
  status:"RESEARCH_ONLY_NO_OFFICIAL_PROMOTION",
  lanes:{
    cleanStandardPickFinder:{count:pfRows.length,rows:pfRows},
    hrrLess:{count:hrrLess.length,rows:hrrLess},
    fantasyLess:{count:fantasyLess.length,rows:fantasyLess}
  }
};

writeJson(`outputs/history/${DATE}-research-lanes-snapshot.json`,snapshot);
writeJson(`outputs/history/${DATE}-clean-standard-pf-lean-card.json`,{...pfCard,date:DATE,rows:pfRows});
writeJson(`outputs/history/${DATE}-hrr-less-watchlist.json`,{date:DATE,generatedAt:snapshot.generatedAt,status:snapshot.status,count:hrrLess.length,rows:hrrLess});
writeJson(`outputs/history/${DATE}-fantasy-less-watchlist.json`,{date:DATE,generatedAt:snapshot.generatedAt,status:snapshot.status,count:fantasyLess.length,rows:fantasyLess});

const lines=[];
lines.push(`RESEARCH LANES SNAPSHOT ${DATE}`);
lines.push("================================");
lines.push(`status=${snapshot.status}`);
lines.push(`cleanStandardPickFinder=${pfRows.length}`);
lines.push(`hrrLess=${hrrLess.length}`);
lines.push(`fantasyLess=${fantasyLess.length}`);
lines.push("");
lines.push("HRR LESS WATCHLIST");
for(const r of hrrLess.slice(0,20)) lines.push(`${r.player} | ${r.team} | HRR LESS ${r.line} | prob=${r.probability} | ev=${r.ev} | pf=${r.pfSignalMatchType||"none"} | trend=${r.pfTrendAvg}`);
lines.push("");
lines.push("FANTASY LESS WATCHLIST");
for(const r of fantasyLess.slice(0,20)) lines.push(`${r.player} | ${r.team} | HFS LESS ${r.line} | prob=${r.probability} | ev=${r.ev} | pf=${r.pfSignalMatchType||"none"} | trend=${r.pfTrendAvg}`);
lines.push("");
lines.push("CLEAN STANDARD PF CARD");
for(const r of pfRows.slice(0,20)) lines.push(`${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line} | prob=${r.probability??r.prob} | ev=${r.ev}`);

writeText(`outputs/history/${DATE}-research-lanes-snapshot.txt`,lines.join("\n")+"\n");
writeText("outputs/research-lanes-snapshot-latest.txt",lines.join("\n")+"\n");

console.log({date:DATE,cleanStandardPickFinder:pfRows.length,hrrLess:hrrLess.length,fantasyLess:fantasyLess.length});
