const fs = require("fs");
const path = require("path");

const OUT_JSON = "outputs/pickfinder-coverage-lite.json";
const OUT_TXT = "outputs/pickfinder-coverage-lite.txt";

const TEAM_ALIAS = {
  "NY-A":"NYY", NYA:"NYY", ANA:"LAA", LA:"LAD", AZ:"ARI",
  WAS:"WSH", WSH:"WSH", OAK:"ATH", ATH:"ATH",
  "CHI-N":"CHC", CHN:"CHC", "CHI-A":"CWS", CHA:"CWS",
  KAN:"KC", SL:"STL"
};

function read(p,f=null){ try{return JSON.parse(fs.readFileSync(p,"utf8"));}catch{return f;} }
function write(p,x){ fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,JSON.stringify(x,null,2)+"\n"); }
function text(p,x){ fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,x); }
function s(v){ return String(v ?? "").trim(); }
function norm(v){ return s(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," "); }
function tv(v){ if(!v)return ""; if(typeof v==="string")return v; if(typeof v==="object")return s(v.abbreviation||v.abbr||v.team||v.name); return ""; }
function tm(v){ const x=tv(v).toUpperCase(); return TEAM_ALIAS[x]||x; }
function player(r){ return s(r.player||r.playerName||r.player_name||r.fullName||r.displayName||r.name); }
function team(r){ return tm(r.team||r.teamAbbr||r.playerTeam||r.player_team||""); }
const MARKET_ALIAS={hitter_fantasy_score_pp:"hitter_fantasy_score",hitter_fantasy_score:"hitter_fantasy_score",fantasy_score:"hitter_fantasy_score",hits_runs_rbis:"hrr","hits+runs+rbis":"hrr",hrr:"hrr",hits:"hits",singles:"singles",runs:"runs",rbis:"rbis",runs_batted_in:"rbis",bases:"bases",total_bases:"bases",walks:"walks",hitter_walks:"walks",hitter_strikeouts:"hitter_strikeouts",strikeouts:"strikeouts",home_runs:"home_runs",hr:"home_runs",earned_runs_allowed:"earned_runs_allowed",hits_allowed:"hits_allowed",pitcher_strikeouts:"strikeouts",pitching_outs:"pitching_outs",walks_allowed:"walks_allowed"};
function market(r){ const raw=s(r.market||r.statType||r.stat_type||r.type||r.projection_type||r.stat); const k=raw.toLowerCase().replace(/\(pp\)/g," pp").replace(/[^a-z0-9+]+/g,"_").replace(/^_+|_+$/g,"").replace(/_+/g,"_"); return MARKET_ALIAS[k]||k; }
function line(r){ const n=Number(r.line ?? r.projectionLine ?? r.threshold ?? r.value); return Number.isFinite(n)?n:null; }
function tier(r){ return s(r.tier||r.oddsTier||r.type||"standard").toLowerCase(); }
function flat(v,out=[]){ if(!v)return out; if(Array.isArray(v)){for(const x of v)flat(x,out);return out;} if(typeof v!=="object")return out; if(v.player||v.playerName||v.player_name||v.market||v.statType||v.stat||v.line||v.player_id)out.push(v); for(const x of Object.values(v))if(x&&typeof x==="object")flat(x,out); return out; }
function pk(p,t){ return `${norm(p)}|${tm(t)}`; }
function propk(p,t,m,l){ return `${norm(p)}|${tm(t)}|${market({market:m})}|${l??""}`; }
function add(map,k,r){ if(!k||k.startsWith("|"))return; if(!map.has(k))map.set(k,[]); map.get(k).push(r); }
function pct(a,b){ return b?+(100*a/b).toFixed(2):0; }

const board = flat(read("outputs/priced-board.json", []));
const pfProps = flat(read("outputs/pickfinder-mlb-props.json", {}));
const pfPopular = flat(read("outputs/pickfinder-mlb-popular.json", {}));
const pfDisc = flat(read("outputs/pickfinder-mlb-discrepancies.json", {}));
const pfOdds = flat(read("outputs/pickfinder-mlb-odds.json", {}));
const pfDetails = flat(read("outputs/pickfinder-mlb-player-details.json", {}));
const pfLineupsFile = read("data/context/pickfinder-lineups.json", {});
const pfLineups = Array.isArray(pfLineupsFile.rows) ? pfLineupsFile.rows : flat(pfLineupsFile);
const clean = read("outputs/clean-standard-pf-lean-card.json", {});
const cleanRows = Array.isArray(clean.rows) ? clean.rows : [];

const idx = {
  props:new Map(), exact:new Map(), lineup:new Map(),
  popular:new Map(), disc:new Map(), odds:new Map(), details:new Map(), clean:new Map()
};

for(const r of pfProps){
  add(idx.props, pk(player(r), team(r)), r);
  add(idx.exact, propk(player(r), team(r), r.stat||r.market||r.statType, line(r)), r);
}
for(const r of pfLineups) add(idx.lineup, pk(r.player||player(r), r.team||team(r)), r);
for(const r of pfPopular) add(idx.popular, pk(player(r), team(r)), r);
for(const r of pfDisc) add(idx.disc, pk(player(r), team(r)), r);
for(const r of pfOdds) add(idx.odds, pk(player(r), team(r)), r);
for(const r of pfDetails) add(idx.details, pk(player(r), team(r)), r);
for(const r of cleanRows) add(idx.clean, pk(player(r), team(r)), r);

const players = new Map();

for(const r of board){
  const p=player(r), t=team(r), m=market(r);
  if(!p||!m)continue;
  const k=pk(p,t);
  if(!players.has(k)) players.set(k,{player:p,team:t,boardProps:0,standard:0,goblin:0,demon:0,markets:new Set(),exact:0});
  const rec=players.get(k);
  rec.boardProps++;
  const tr=tier(r);
  if(tr.includes("goblin"))rec.goblin++;
  else if(tr.includes("demon"))rec.demon++;
  else rec.standard++;
  rec.markets.add(m);
  if((idx.exact.get(propk(p,t,m,line(r)))||[]).length)rec.exact++;
}

const rows = [];

for(const [k,r] of players.entries()){
  const props=(idx.props.get(k)||[]).length;
  const lineup=(idx.lineup.get(k)||[]).length;
  const popular=(idx.popular.get(k)||[]).length;
  const disc=(idx.disc.get(k)||[]).length;
  const odds=(idx.odds.get(k)||[]).length;
  const details=(idx.details.get(k)||[]).length;
  const cleanCount=(idx.clean.get(k)||[]).length;
  let status="NO_PICKFINDER_SUPPORT";
  if(props&&lineup&&r.exact)status="FULL_PROP_AND_LINEUP_SUPPORT";
  else if(props&&r.exact)status="PROP_SUPPORT_ONLY";
  else if(lineup)status="LINEUP_SUPPORT_ONLY";
  else if(props)status="PLAYER_PROP_SUPPORT_NO_EXACT_LINE";
  const sample=(idx.props.get(k)||[])[0]||{};
  rows.push({
    player:r.player, team:r.team, boardProps:r.boardProps, standardProps:r.standard,
    goblinProps:r.goblin, demonProps:r.demon, markets:[...r.markets].sort(),
    pfPropRows:props, pfExactPropMatches:r.exact, pfLineupRows:lineup,
    pfPopularRows:popular, pfDiscrepancyRows:disc, pfOddsRows:odds,
    pfPlayerDetailsRows:details, cleanStandardPfRows:cleanCount,
    usableStatus:status,
    samplePf:{
      stat:sample.stat||null, line:sample.line??null,
      hitRateLast5:sample.hitRateLast5??null,
      hitRateLast10:sample.hitRateLast10??null,
      hitRateLast15:sample.hitRateLast15??null,
      differencePercent:sample.differencePercent??null,
      consensusOver:sample.consensus_over_ip??null,
      consensusUnder:sample.consensus_under_ip??null,
      bestOverOdds:sample.best_over_odds??null,
      bestUnderOdds:sample.best_under_odds??null,
      favoriteOver:sample.favorite_count_over??null,
      favoriteUnder:sample.favorite_count_under??null
    }
  });
}

rows.sort((a,b)=>{
  const rank={FULL_PROP_AND_LINEUP_SUPPORT:0,PROP_SUPPORT_ONLY:1,LINEUP_SUPPORT_ONLY:2,PLAYER_PROP_SUPPORT_NO_EXACT_LINE:3,NO_PICKFINDER_SUPPORT:4};
  return (rank[a.usableStatus]??9)-(rank[b.usableStatus]??9)||b.boardProps-a.boardProps||a.player.localeCompare(b.player);
});

const total=rows.length;
const summary={
  generatedAt:new Date().toISOString(),
  rawCounts:{
    boardRows:board.length, boardPlayers:total, pfProps:pfProps.length,
    pfLineups:pfLineups.length, pfPopular:pfPopular.length,
    pfDiscrepancies:pfDisc.length, pfOdds:pfOdds.length,
    pfPlayerDetails:pfDetails.length, cleanStandardPfRows:cleanRows.length
  },
  coverage:{
    pfPropsPlayers:rows.filter(x=>x.pfPropRows>0).length,
    pfExactPropPlayers:rows.filter(x=>x.pfExactPropMatches>0).length,
    pfLineupPlayers:rows.filter(x=>x.pfLineupRows>0).length,
    pfPopularPlayers:rows.filter(x=>x.pfPopularRows>0).length,
    pfDiscrepancyPlayers:rows.filter(x=>x.pfDiscrepancyRows>0).length,
    pfOddsPlayers:rows.filter(x=>x.pfOddsRows>0).length,
    pfPlayerDetailsPlayers:rows.filter(x=>x.pfPlayerDetailsRows>0).length,
    cleanStandardPfPlayers:rows.filter(x=>x.cleanStandardPfRows>0).length
  },
  rates:{},
  byUsableStatus:{}
};

for(const [k,v] of Object.entries(summary.coverage)) summary.rates[k]=`${pct(v,total)}%`;
for(const r of rows) summary.byUsableStatus[r.usableStatus]=(summary.byUsableStatus[r.usableStatus]||0)+1;

write(OUT_JSON,{...summary,rows});

const lines=[];
lines.push("PICKFINDER COVERAGE LITE");
lines.push("========================");
lines.push(`generatedAt=${summary.generatedAt}`);
lines.push("");
lines.push("RAW COUNTS");
lines.push("----------");
for(const [k,v] of Object.entries(summary.rawCounts)) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("PLAYER COVERAGE");
lines.push("---------------");
lines.push(`totalPlayers: ${total}`);
for(const [k,v] of Object.entries(summary.coverage)) lines.push(`${k}: ${v}/${total} (${summary.rates[k]})`);
lines.push("");
lines.push("USABLE STATUS");
lines.push("-------------");
for(const [k,v] of Object.entries(summary.byUsableStatus)) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("FULL SUPPORT SAMPLE");
lines.push("-------------------");
for(const r of rows.filter(x=>x.usableStatus==="FULL_PROP_AND_LINEUP_SUPPORT").slice(0,35)) lines.push(`${r.player} | ${r.team} | props=${r.boardProps} | exact=${r.pfExactPropMatches} | pfProps=${r.pfPropRows} | lineup=${r.pfLineupRows} | cleanPF=${r.cleanStandardPfRows} | markets=${r.markets.join(",")}`);
lines.push("");
lines.push("NO PF PROPS SAMPLE");
lines.push("------------------");
for(const r of rows.filter(x=>!x.pfPropRows).slice(0,35)) lines.push(`${r.player} | ${r.team} | props=${r.boardProps} | markets=${r.markets.join(",")}`);
lines.push("");
lines.push("NO PF LINEUP SAMPLE");
lines.push("-------------------");
for(const r of rows.filter(x=>!x.pfLineupRows).slice(0,35)) lines.push(`${r.player} | ${r.team} | props=${r.boardProps} | markets=${r.markets.join(",")}`);
lines.push("");
lines.push("CLEAN STANDARD PF PLAYERS");
lines.push("-------------------------");
for(const r of rows.filter(x=>x.cleanStandardPfRows>0)) lines.push(`${r.player} | ${r.team} | cleanRows=${r.cleanStandardPfRows} | exact=${r.pfExactPropMatches} | markets=${r.markets.join(",")}`);

text(OUT_TXT,lines.join("\n")+"\n");

console.log({rawCounts:summary.rawCounts,coverage:summary.coverage,rates:summary.rates,byUsableStatus:summary.byUsableStatus,outJson:OUT_JSON,outTxt:OUT_TXT});
