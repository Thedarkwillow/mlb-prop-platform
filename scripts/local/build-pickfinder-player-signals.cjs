const fs = require("fs");
const path = require("path");

const OUT_JSON = "data/context/pickfinder-player-signals.json";
const OUT_TXT = "outputs/pickfinder-player-signals.txt";

const TEAM_ALIAS = {
  "NY-A":"NYY", NYA:"NYY", ANA:"LAA", LA:"LAD", AZ:"ARI",
  WAS:"WSH", WSH:"WSH", OAK:"ATH", ATH:"ATH",
  "CHI-N":"CHC", CHN:"CHC", "CHI-A":"CWS", CHA:"CWS",
  KAN:"KC", SL:"STL"
};

const MARKET_ALIAS = {
  hitter_fantasy_score_pp:"hitter_fantasy_score",
  hitter_fantasy_score:"hitter_fantasy_score",
  fantasy_score:"hitter_fantasy_score",
  hits_runs_rbis:"hrr",
  "hits+runs+rbis":"hrr",
  hrr:"hrr",
  hits:"hits",
  singles:"singles",
  runs:"runs",
  rbis:"rbis",
  runs_batted_in:"rbis",
  bases:"bases",
  total_bases:"bases",
  walks:"walks",
  hitter_walks:"walks",
  hitter_strikeouts:"hitter_strikeouts",
  strikeouts:"strikeouts",
  home_runs:"home_runs",
  hr:"home_runs",
  earned_runs_allowed:"earned_runs_allowed",
  hits_allowed:"hits_allowed",
  pitcher_strikeouts:"strikeouts",
  pitching_outs:"pitching_outs",
  walks_allowed:"walks_allowed"
};

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function writeText(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function norm(v){ return s(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," "); }
function tv(v){ if(!v)return""; if(typeof v==="string")return v; if(typeof v==="object")return s(v.abbreviation||v.abbr||v.team||v.name||v.shortName); return ""; }
function tm(v){ const x=tv(v).toUpperCase(); return TEAM_ALIAS[x]||x; }
function player(r){ return s(r.player||r.playerName||r.player_name||r.fullName||r.displayName||r.name); }
function team(r){ return tm(r.team||r.teamAbbr||r.playerTeam||r.player_team||""); }
function opp(r){ return tm(r.opponent||r.opp||r.opponentTeam||r.awayTeam||r.homeTeam||""); }
function marketRaw(r){ return s(r.market||r.statType||r.stat_type||r.type||r.projection_type||r.stat); }
function market(r){
  const k=marketRaw(r).toLowerCase().replace(/\(pp\)/g," pp").replace(/[^a-z0-9+]+/g,"_").replace(/^_+|_+$/g,"").replace(/_+/g,"_");
  return MARKET_ALIAS[k]||k;
}
function line(r){ return n(r.line ?? r.projectionLine ?? r.threshold ?? r.value); }
function sideFrom(r){
  const raw=s(r.side||r.pick||r.prediction||r.direction||r.selection).toUpperCase();
  if(/MORE|OVER/.test(raw))return"MORE";
  if(/LESS|UNDER/.test(raw))return"LESS";
  return "";
}
function flat(v,out=[]){
  if(!v)return out;
  if(Array.isArray(v)){ for(const x of v) flat(x,out); return out; }
  if(typeof v!=="object")return out;
  if(v.player||v.playerName||v.player_name||v.market||v.statType||v.stat||v.line||v.player_id)out.push(v);
  for(const x of Object.values(v)) if(x&&typeof x==="object") flat(x,out);
  return out;
}
function pkey(p,t){ return `${norm(p)}|${tm(t)}`; }
function skey(p,t,m,l){ return `${norm(p)}|${tm(t)}|${m}|${l ?? ""}`; }
function add(map,k,row){ if(!k||k.startsWith("|"))return; if(!map.has(k))map.set(k,[]); map.get(k).push(row); }

const pfProps = flat(read("outputs/pickfinder-mlb-props.json", {}));
const pfPopular = flat(read("outputs/pickfinder-mlb-popular.json", {}));
const pfDisc = flat(read("outputs/pickfinder-mlb-discrepancies.json", {}));
const pfLineupsFile = read("data/context/pickfinder-lineups.json", {});
const pfLineups = Array.isArray(pfLineupsFile.rows) ? pfLineupsFile.rows : flat(pfLineupsFile);

const popularIdx = new Map();
const discIdx = new Map();
const lineupIdx = new Map();

for(const r of pfPopular) add(popularIdx, skey(player(r),team(r),market(r),line(r)), r);
for(const r of pfDisc) add(discIdx, skey(player(r),team(r),market(r),line(r)), r);
for(const r of pfLineups) add(lineupIdx, pkey(r.player||player(r), r.team||team(r)), r);

const rows = [];
const seen = new Set();

for(const r of pfProps){
  const p=player(r), t=team(r), m=market(r), l=line(r);
  if(!p||!t||!m)continue;

  const pk=pkey(p,t);
  const sig=skey(p,t,m,l);
  if(seen.has(sig))continue;
  seen.add(sig);

  const pop=popularIdx.get(sig)||[];
  const dis=discIdx.get(sig)||[];
  const lu=(lineupIdx.get(pk)||[])[0]||{};

  const consensusOver = n(r.consensus_over_ip);
  const consensusUnder = n(r.consensus_under_ip);
  const favOver = n(r.favorite_count_over);
  const favUnder = n(r.favorite_count_under);

  let pfSideLean = "";
  if(consensusOver !== null || consensusUnder !== null || favOver !== null || favUnder !== null){
    const overScore=(consensusOver||0)+(favOver||0);
    const underScore=(consensusUnder||0)+(favUnder||0);
    if(overScore>underScore)pfSideLean="MORE";
    else if(underScore>overScore)pfSideLean="LESS";
  }

  const hit5=n(r.hitRateLast5), hit10=n(r.hitRateLast10), hit15=n(r.hitRateLast15);
  const trendVals=[hit5,hit10,hit15].filter(x=>x!==null);
  const pfTrendAvg=trendVals.length ? +(trendVals.reduce((a,b)=>a+b,0)/trendVals.length).toFixed(2) : null;

  rows.push({
    player:p,
    team:t,
    market:m,
    line:l,
    source:"PICKFINDER",
    fixtureId:s(r.fixture_id||r.fixtureId||r.fixture||r.matchId),
    opponent:opp(r),
    side:sideFrom(r),
    pfSideLean,
    pfTrendAvg,
    pfHitRate5:hit5,
    pfHitRate10:hit10,
    pfHitRate15:hit15,
    pfH2H:n(r.hitRateH2H),
    pfAverage10:n(r.averageLast10),
    pfDifference10:n(r.differenceLast10),
    pfDifferencePercent:n(r.differencePercent),
    pfStreak:n(r.streak),
    pfDefenseRank:n(r.defenseRank),
    pfConsensusOver:consensusOver,
    pfConsensusUnder:consensusUnder,
    pfFavoriteOver:favOver,
    pfFavoriteUnder:favUnder,
    pfBestOverOdds:n(r.best_over_odds),
    pfBestUnderOdds:n(r.best_under_odds),
    pfPopularFlag:pop.length>0,
    pfPopularRows:pop.length,
    pfDiscrepancyFlag:dis.length>0,
    pfDiscrepancyRows:dis.length,
    pfLineupConfirmed:!!lu.player,
    pfLineupStatus:s(lu.status||lu.lineupStatus||""),
    pfBattingOrder:n(lu.battingOrder||lu.order||lu.lineupOrder),
    pfPosition:s(lu.position||lu.pos),
    pfLineupGame:s(lu.game||lu.matchup||""),
    pfLineupDate:s(lu.date||""),
    pfMlbId:s(lu.mlbId||lu.mlb_id||lu.playerId||""),
    rawStat:s(r.stat||r.market||r.statType),
    rawTeam:team(r),
    rawPlayer:p
  });
}

rows.sort((a,b)=>
  (a.player.localeCompare(b.player)) ||
  (a.market.localeCompare(b.market)) ||
  ((a.line??0)-(b.line??0))
);

const players = new Set(rows.map(r=>pkey(r.player,r.team)));
const withLineup = rows.filter(r=>r.pfLineupConfirmed).length;
const withPopular = rows.filter(r=>r.pfPopularFlag).length;
const withDisc = rows.filter(r=>r.pfDiscrepancyFlag).length;
const withTrend = rows.filter(r=>r.pfTrendAvg!==null).length;

const summary = {
  generatedAt:new Date().toISOString(),
  sourceFiles:{
    props:"outputs/pickfinder-mlb-props.json",
    popular:"outputs/pickfinder-mlb-popular.json",
    discrepancies:"outputs/pickfinder-mlb-discrepancies.json",
    lineups:"data/context/pickfinder-lineups.json"
  },
  counts:{
    rawProps:pfProps.length,
    rawPopular:pfPopular.length,
    rawDiscrepancies:pfDisc.length,
    rawLineups:pfLineups.length,
    signalRows:rows.length,
    signalPlayers:players.size,
    rowsWithLineup:withLineup,
    rowsWithPopular:withPopular,
    rowsWithDiscrepancy:withDisc,
    rowsWithTrend:withTrend
  },
  rows
};

writeJson(OUT_JSON, summary);

const lines=[];
lines.push("PICKFINDER PLAYER SIGNALS V1");
lines.push("============================");
lines.push(`generatedAt=${summary.generatedAt}`);
lines.push("");
lines.push("COUNTS");
lines.push("------");
for(const [k,v] of Object.entries(summary.counts)) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("TOP SIGNAL SAMPLE");
lines.push("-----------------");
for(const r of rows.slice(0,80)){
  lines.push(`${r.player} | ${r.team} | ${r.market} ${r.line} | trend=${r.pfTrendAvg} | L5=${r.pfHitRate5} L10=${r.pfHitRate10} L15=${r.pfHitRate15} | diff=${r.pfDifferencePercent} | consensus=${r.pfConsensusOver}/${r.pfConsensusUnder} | fav=${r.pfFavoriteOver}/${r.pfFavoriteUnder} | popular=${r.pfPopularFlag} | disc=${r.pfDiscrepancyFlag} | lineup=${r.pfLineupConfirmed} | order=${r.pfBattingOrder}`);
}
lines.push("");
lines.push("BEST MORE-LEAN SIGNALS");
lines.push("----------------------");
const more = rows.filter(r => r.pfTrendAvg !== null && r.pfTrendAvg >= 60).sort((a,b)=>
  (b.pfTrendAvg??0)-(a.pfTrendAvg??0) ||
  (b.pfDifferencePercent??-999)-(a.pfDifferencePercent??-999)
);
for(const r of more.slice(0,40)){
  lines.push(`${r.player} | ${r.team} | ${r.market} ${r.line} | trend=${r.pfTrendAvg} | diff=${r.pfDifferencePercent} | popular=${r.pfPopularFlag} | disc=${r.pfDiscrepancyFlag} | lineup=${r.pfLineupConfirmed} | order=${r.pfBattingOrder}`);
}
lines.push("");
lines.push(`saved: ${OUT_JSON}`);
lines.push(`saved: ${OUT_TXT}`);

writeText(OUT_TXT, lines.join("\n")+"\n");

console.log({counts:summary.counts,outJson:OUT_JSON,outTxt:OUT_TXT});
