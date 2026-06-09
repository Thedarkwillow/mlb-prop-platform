const fs = require("fs");
const path = require("path");
const cp = require("child_process");

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function norm(v){ return s(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," "); }

function slateDate(){
  if(process.env.npm_config_date) return process.env.npm_config_date;
  if(process.env.DATE) return process.env.DATE;
  try { return cp.execSync("node scripts/local/board-slate-date.cjs",{encoding:"utf8"}).trim(); }
  catch { return new Date().toISOString().slice(0,10); }
}

function market(r){
  const raw=s(r.market||r.statType||r.stat||r.projection_type);
  const x=raw.toLowerCase().replace(/\(pp\)/g," pp").replace(/[^a-z0-9+]+/g,"_").replace(/^_+|_+$/g,"").replace(/_+/g,"_");
  const map={
    hitter_fantasy_score_pp:"hitter_fantasy_score",
    hitter_fantasy_score:"hitter_fantasy_score",
    fantasy_score:"hitter_fantasy_score",
    fantasy_score_pp:"hitter_fantasy_score",
    hits_runs_rbis:"hrr",
    "hits+runs+rbis":"hrr",
    hrr:"hrr",
    total_bases:"bases",
    bases:"bases",
    hits:"hits",
    singles:"singles",
    runs:"runs",
    rbis:"rbis",
    walks:"walks",
    hitter_walks:"walks",
    batter_walks:"walks",
    hitter_strikeouts:"hitter_strikeouts",
    strikeouts:"strikeouts",
    home_runs:"home_runs",
    hr:"home_runs"
  };
  return map[x]||x;
}

function side(r){
  const x=s(r.side||r.pick||r.direction||r.selection).toUpperCase();
  if(/MORE|OVER/.test(x)) return "MORE";
  if(/LESS|UNDER/.test(x)) return "LESS";
  return x;
}

function tier(r){
  return s(r.tier||r.oddsTier||r.type||r.promoType||"standard").toLowerCase();
}

function player(r){ return s(r.player||r.playerName||r.name); }
function team(r){ return s(r.team||r.teamAbbr||r.playerTeam); }
function line(r){ return n(r.line ?? r.projectionLine ?? r.threshold); }
function prob(r){ return n(r.probability ?? r.prob ?? r.p); }
function ev(r){ return n(r.ev ?? r.expectedValue); }

function indexByPlayerTeam(rows){
  const map=new Map();
  for(const r of rows||[]){
    const k=`${norm(player(r)||r.player)}|${s(team(r)||r.team).toUpperCase()}`;
    if(!map.has(k)) map.set(k,[]);
    map.get(k).push(r);
  }
  return map;
}

function findCtx(idx, r){
  const k=`${norm(player(r))}|${s(team(r)).toUpperCase()}`;
  return (idx.get(k)||[])[0]||{};
}

function handValue(v){
  const x=s(v).toUpperCase();
  if(x==="L"||x==="LEFT"||x==="LHP") return "L";
  if(x==="R"||x==="RIGHT"||x==="RHP") return "R";
  if(x==="S"||x==="SWITCH") return "S";
  return "";
}

function platoonEdge(hitterHand, pitcherHand){
  const h=handValue(hitterHand);
  const p=handValue(pitcherHand);
  if(!h||!p) return "unknown";
  if(h==="S") return "switch_edge";
  if(h==="R" && p==="L") return "advantage";
  if(h==="L" && p==="R") return "advantage";
  if(h===p) return "same_side_disadvantage";
  return "unknown";
}

const DATE=slateDate();
const board=read("outputs/priced-board.json",[]);
const signals=read("data/context/pickfinder-player-signals.json",{rows:[]});
const signalRows=Array.isArray(signals.rows)?signals.rows:[];
const enriched=read("outputs/manual/pickfinder-current-context-enriched.json",{rows:[]});
const enrichedRows=Array.isArray(enriched.rows)?enriched.rows:[];
const lineupCtx=read("data/context/pickfinder-lineups.json",{rows:[]});
const lineupRows=Array.isArray(lineupCtx.rows)?lineupCtx.rows:[];

const signalIdx=indexByPlayerTeam(signalRows);
const enrichedIdx=indexByPlayerTeam(enrichedRows);
const lineupIdx=indexByPlayerTeam(lineupRows);

const usableMarkets=new Set([
  "hitter_fantasy_score",
  "hrr",
  "hits",
  "bases",
  "singles",
  "runs",
  "rbis",
  "walks",
  "hitter_strikeouts",
  "home_runs"
]);

function enrichRow(r){
  const sig=findCtx(signalIdx,r);
  const ctx=findCtx(enrichedIdx,r);
  const lu=findCtx(lineupIdx,r);

  const hitterHand =
    handValue(r.hitterHand||r.bats||r.batSide||sig.hitterHand||sig.bats||ctx.hitterHand||ctx.bats||lu.hitterHand||lu.bats);

  const opposingPitcher =
    s(r.opposingPitcher||r.pitcher||r.probablePitcher||sig.opposingPitcher||sig.pitcher||ctx.opposingPitcher||ctx.pitcher);

  const opposingPitcherHand =
    handValue(r.opposingPitcherHand||r.pitcherHand||sig.opposingPitcherHand||sig.pitcherHand||ctx.opposingPitcherHand||ctx.pitcherHand);

  return {
    player:player(r),
    team:team(r),
    market:market(r),
    side:side(r),
    line:line(r),
    tier:tier(r),
    probability:prob(r),
    ev:ev(r),

    pfSignalMatch:!!r.pfSignalMatch,
    pfSignalMatchType:r.pfSignalMatchType||"",
    pfSignalUsableForModel:!!r.pfSignalUsableForModel,
    pfSignalDecisionEligible:!!r.pfSignalDecisionEligible,
    pfTrendAvg:r.pfTrendAvg ?? sig.pfTrendAvg ?? null,
    pfHitRate5:r.pfHitRate5 ?? sig.pfHitRate5 ?? null,
    pfHitRate10:r.pfHitRate10 ?? sig.pfHitRate10 ?? null,
    pfHitRate15:r.pfHitRate15 ?? sig.pfHitRate15 ?? null,
    pfDifferencePercent:r.pfDifferencePercent ?? sig.pfDifferencePercent ?? null,
    pfPopularFlag:!!(r.pfPopularFlag||sig.pfPopularFlag),
    pfDiscrepancyFlag:!!(r.pfDiscrepancyFlag||sig.pfDiscrepancyFlag),
    pfLineupConfirmed:!!(r.pfLineupConfirmed||sig.pfLineupConfirmed||lu.player),
    pfBattingOrder:r.pfBattingOrder ?? sig.pfBattingOrder ?? lu.battingOrder ?? null,
    pfPosition:r.pfPosition||sig.pfPosition||lu.position||"",

    hitterHand,
    opposingPitcher,
    opposingPitcherHand,
    matchupHand: hitterHand && opposingPitcherHand ? `${hitterHand}v${opposingPitcherHand}` : "",
    platoonEdge: platoonEdge(hitterHand,opposingPitcherHand),

    raw: {
      game:r.game||r.matchup||"",
      opponent:r.opponent||r.pfOpponent||sig.opponent||ctx.opponent||"",
      source:r.source||r.lineupSource||""
    }
  };
}

const rows=(Array.isArray(board)?board:[]).filter(r=>player(r)&&line(r)!==null).map(enrichRow);

const goblinMore=rows.filter(r =>
  r.tier.includes("goblin") &&
  r.side==="MORE" &&
  usableMarkets.has(r.market) &&
  r.pfSignalMatch &&
  r.pfSignalUsableForModel &&
  r.pfLineupConfirmed &&
  (r.pfTrendAvg===null || r.pfTrendAvg>=55)
).sort((a,b)=>
  (b.probability??0)-(a.probability??0) ||
  (b.ev??0)-(a.ev??0) ||
  (b.pfTrendAvg??0)-(a.pfTrendAvg??0)
).slice(0,40);

const standardMore=rows.filter(r =>
  !r.tier.includes("goblin") &&
  !r.tier.includes("demon") &&
  r.side==="MORE" &&
  usableMarkets.has(r.market) &&
  r.pfSignalMatch &&
  r.pfSignalUsableForModel &&
  r.pfLineupConfirmed &&
  (r.pfTrendAvg===null || r.pfTrendAvg>=55)
).sort((a,b)=>
  (b.probability??0)-(a.probability??0) ||
  (b.ev??0)-(a.ev??0) ||
  (b.pfTrendAvg??0)-(a.pfTrendAvg??0)
).slice(0,40);

const handRows=rows.filter(r =>
  r.pfSignalMatch &&
  r.pfSignalUsableForModel &&
  r.pfLineupConfirmed &&
  r.matchupHand
).sort((a,b)=>
  (a.platoonEdge==="advantage"?-1:0) - (b.platoonEdge==="advantage"?-1:0) ||
  (b.pfTrendAvg??0)-(a.pfTrendAvg??0)
).slice(0,80);

const out={
  date:DATE,
  generatedAt:new Date().toISOString(),
  status:"RESEARCH_ONLY",
  rules:{
    goblins:"MORE only",
    pfUsable:"exact or player_market only",
    playerOnly:"info only / excluded",
    handedness:"shown when available from board/PickFinder/context"
  },
  counts:{
    boardRows:rows.length,
    goblinMore:goblinMore.length,
    standardMore:standardMore.length,
    handRows:handRows.length,
    rowsWithMatchupHand:rows.filter(r=>r.matchupHand).length,
    rowsWithPlatoonAdvantage:rows.filter(r=>r.platoonEdge==="advantage").length,
    rowsWithUnknownHand:rows.filter(r=>r.platoonEdge==="unknown").length
  },
  lanes:{
    goblinMore,
    standardMore,
    handednessView:handRows
  }
};

writeJson("outputs/pickfinder-hand-goblin-card.json",out);
writeJson(`outputs/history/${DATE}-pickfinder-hand-goblin-card.json`,out);

const lines=[];
lines.push(`PICKFINDER HAND + GOBLIN RESEARCH ${DATE}`);
lines.push("=======================================");
lines.push(`status=${out.status}`);
for(const [k,v] of Object.entries(out.counts)) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("GOBLIN MORE PF RESEARCH");
lines.push("-----------------------");
for(const r of goblinMore.slice(0,25)){
  lines.push(`${r.player} | ${r.team} | ${r.market} MORE ${r.line} | prob=${r.probability} | ev=${r.ev} | pf=${r.pfSignalMatchType} | trend=${r.pfTrendAvg} | hand=${r.matchupHand||"?"} | platoon=${r.platoonEdge} | order=${r.pfBattingOrder}`);
}
lines.push("");
lines.push("STANDARD MORE PF RESEARCH");
lines.push("-------------------------");
for(const r of standardMore.slice(0,25)){
  lines.push(`${r.player} | ${r.team} | ${r.market} MORE ${r.line} | prob=${r.probability} | ev=${r.ev} | pf=${r.pfSignalMatchType} | trend=${r.pfTrendAvg} | hand=${r.matchupHand||"?"} | platoon=${r.platoonEdge} | order=${r.pfBattingOrder}`);
}
lines.push("");
lines.push("HANDEDNESS / PLATOON VIEW");
lines.push("-------------------------");
for(const r of handRows.slice(0,40)){
  lines.push(`${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line} | tier=${r.tier} | hand=${r.matchupHand} | platoon=${r.platoonEdge} | oppPitcher=${r.opposingPitcher||"?"} | trend=${r.pfTrendAvg} | pf=${r.pfSignalMatchType}`);
}
lines.push("");
lines.push("saved: outputs/pickfinder-hand-goblin-card.json");
lines.push(`saved: outputs/history/${DATE}-pickfinder-hand-goblin-card.json`);

writeText("outputs/pickfinder-hand-goblin-card.txt",lines.join("\n")+"\n");
writeText(`outputs/history/${DATE}-pickfinder-hand-goblin-card.txt`,lines.join("\n")+"\n");

console.log({date:DATE,counts:out.counts});
