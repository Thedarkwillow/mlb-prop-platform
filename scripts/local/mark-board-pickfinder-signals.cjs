const fs = require("fs");
const path = require("path");

const BOARD = "outputs/priced-board.json";
const SIGNALS = "data/context/pickfinder-player-signals.json";
const OUT_JSON = "outputs/pickfinder-board-signal-audit.json";
const OUT_TXT = "outputs/pickfinder-board-signal-audit.txt";

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
  fantasy_score_pp:"hitter_fantasy_score",
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
  batter_walks:"walks",
  hitter_walks:"walks",
  hitter_strikeouts:"hitter_strikeouts",
  strikeouts:"strikeouts",
  home_runs:"home_runs",
  hr:"home_runs",
  earned_runs_allowed:"earned_runs_allowed",
  hits_allowed:"hits_allowed",
  pitcher_strikeouts:"strikeouts",
  pitching_outs:"pitching_outs",
  walks_allowed:"walks_allowed",
  pitcher_fantasy_score_pp:"pitcher_fantasy_score",
  pitcher_fantasy_score:"pitcher_fantasy_score",
  total_pitches:"pitches_thrown",
  pitches_thrown:"pitches_thrown",
  "1st_inning_pitches":"first_inning_pitches",
  first_inning_pitches:"first_inning_pitches",
  "1st_inning_hits_allowed":"first_inning_hits_allowed",
  first_inning_hits_allowed:"first_inning_hits_allowed",
  "1st_inning_runs_allowed":"first_inning_runs_allowed",
  first_inning_runs_allowed:"first_inning_runs_allowed"
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
function rawMarket(r){ return s(r.market||r.statType||r.stat_type||r.type||r.projection_type||r.stat); }
function market(v){
  const raw = typeof v === "string" ? v : rawMarket(v);
  const k=raw.toLowerCase().replace(/\(pp\)/g," pp").replace(/[^a-z0-9+]+/g,"_").replace(/^_+|_+$/g,"").replace(/_+/g,"_");
  return MARKET_ALIAS[k]||k;
}
function line(r){ return n(r.line ?? r.projectionLine ?? r.threshold ?? r.value); }
function key(p,t,m,l){ return `${norm(p)}|${tm(t)}|${market(m)}|${l ?? ""}`; }
function playerKey(p,t){ return `${norm(p)}|${tm(t)}`; }

const board = read(BOARD, []);
const sigData = read(SIGNALS, {});
const signals = Array.isArray(sigData.rows) ? sigData.rows : [];

const exactIdx = new Map();
const playerMarketIdx = new Map();
const playerIdx = new Map();

for (const r of signals) {
  const p = r.player;
  const t = r.team;
  const m = r.market;
  const l = r.line;
  exactIdx.set(key(p,t,m,l), r);

  const pm = `${playerKey(p,t)}|${market(m)}`;
  if (!playerMarketIdx.has(pm)) playerMarketIdx.set(pm, []);
  playerMarketIdx.get(pm).push(r);

  const pk = playerKey(p,t);
  if (!playerIdx.has(pk)) playerIdx.set(pk, []);
  playerIdx.get(pk).push(r);
}

let rows = Array.isArray(board) ? board : [];
let matchedExact = 0;
let matchedPlayerMarket = 0;
let matchedPlayerOnly = 0;
let unmatched = 0;
const samples = [];

rows = rows.map(r => {
  const p = player(r);
  const t = team(r);
  const m = market(r);
  const l = line(r);

  let sig = exactIdx.get(key(p,t,m,l));
  let matchType = "";

  if (sig) {
    matchType = "exact";
    matchedExact++;
  } else {
    const pmRows = playerMarketIdx.get(`${playerKey(p,t)}|${m}`) || [];
    if (pmRows.length) {
      sig = pmRows[0];
      matchType = "player_market";
      matchedPlayerMarket++;
    } else {
      const pRows = playerIdx.get(playerKey(p,t)) || [];
      if (pRows.length) {
        sig = pRows[0];
        matchType = "player_only";
        matchedPlayerOnly++;
      }
    }
  }

  if (!sig) {
    unmatched++;
    return {
      ...r,
      pfSignalMatch: false
    };
  }

  const pfSignalUsableForModel = matchType === "exact" || matchType === "player_market";
  const pfSignalDecisionEligible = matchType === "exact";
  const pfSignalInfoOnly = matchType === "player_only";

  const out = {
    ...r,
    pfSignalMatch: true,
    pfSignalMatchType: matchType,
    pfSignalUsableForModel,
    pfSignalDecisionEligible,
    pfSignalInfoOnly,
    pfTrendAvg: sig.pfTrendAvg ?? null,
    pfHitRate5: sig.pfHitRate5 ?? null,
    pfHitRate10: sig.pfHitRate10 ?? null,
    pfHitRate15: sig.pfHitRate15 ?? null,
    pfH2H: sig.pfH2H ?? null,
    pfAverage10: sig.pfAverage10 ?? null,
    pfDifference10: sig.pfDifference10 ?? null,
    pfDifferencePercent: sig.pfDifferencePercent ?? null,
    pfStreak: sig.pfStreak ?? null,
    pfConsensusOver: sig.pfConsensusOver ?? null,
    pfConsensusUnder: sig.pfConsensusUnder ?? null,
    pfFavoriteOver: sig.pfFavoriteOver ?? null,
    pfFavoriteUnder: sig.pfFavoriteUnder ?? null,
    pfBestOverOdds: sig.pfBestOverOdds ?? null,
    pfBestUnderOdds: sig.pfBestUnderOdds ?? null,
    pfPopularFlag: !!sig.pfPopularFlag,
    pfDiscrepancyFlag: !!sig.pfDiscrepancyFlag,
    pfLineupConfirmed: !!sig.pfLineupConfirmed,
    pfLineupStatus: sig.pfLineupStatus || "",
    pfBattingOrder: sig.pfBattingOrder ?? null,
    pfPosition: sig.pfPosition || "",
    pfSideLean: sig.pfSideLean || "",
    pfFixtureId: sig.fixtureId || "",
    pfOpponent: sig.opponent || "",
    pfSignalMarket: sig.market || "",
    pfSignalLine: sig.line ?? null
  };

  if (samples.length < 80 && matchType === "exact") {
    samples.push({
      player:p, team:t, market:m, line:l,
      trend:out.pfTrendAvg,
      popular:out.pfPopularFlag,
      discrepancy:out.pfDiscrepancyFlag,
      lineup:out.pfLineupConfirmed,
      order:out.pfBattingOrder
    });
  }

  return out;
});

writeJson(BOARD, rows);

const total = rows.length;
const audit = {
  generatedAt: new Date().toISOString(),
  boardFile: BOARD,
  signalFile: SIGNALS,
  totalRows: total,
  matchedExact,
  matchedPlayerMarket,
  matchedPlayerOnly,
  unmatched,
  matchedTotal: matchedExact + matchedPlayerMarket + matchedPlayerOnly,
  usableForModel: matchedExact + matchedPlayerMarket,
  decisionEligible: matchedExact,
  infoOnly: matchedPlayerOnly,
  rates: {
    exact: total ? +(100*matchedExact/total).toFixed(2) + "%" : "0%",
    usableForModel: total ? +(100*(matchedExact+matchedPlayerMarket)/total).toFixed(2) + "%" : "0%",
    infoOnly: total ? +(100*matchedPlayerOnly/total).toFixed(2) + "%" : "0%",
    totalMatched: total ? +(100*(matchedExact+matchedPlayerMarket+matchedPlayerOnly)/total).toFixed(2) + "%" : "0%",
    unmatched: total ? +(100*unmatched/total).toFixed(2) + "%" : "0%"
  },
  exactSamples: samples
};

writeJson(OUT_JSON, audit);

const lines = [];
lines.push("PICKFINDER BOARD SIGNAL AUDIT");
lines.push("=============================");
lines.push(`generatedAt=${audit.generatedAt}`);
lines.push(`boardFile=${BOARD}`);
lines.push(`signalFile=${SIGNALS}`);
lines.push("");
lines.push(`totalRows: ${total}`);
lines.push(`matchedExact: ${matchedExact} (${audit.rates.exact})`);
lines.push(`matchedPlayerMarket: ${matchedPlayerMarket}`);
lines.push(`matchedPlayerOnly: ${matchedPlayerOnly}`);
lines.push(`usableForModel: ${audit.usableForModel} (${audit.rates.usableForModel})`);
lines.push(`decisionEligibleExactOnly: ${audit.decisionEligible} (${audit.rates.exact})`);
lines.push(`infoOnlyPlayerOnly: ${audit.infoOnly} (${audit.rates.infoOnly})`);
lines.push(`matchedTotal: ${audit.matchedTotal} (${audit.rates.totalMatched})`);
lines.push(`unmatched: ${unmatched} (${audit.rates.unmatched})`);
lines.push("");
lines.push("EXACT MATCH SAMPLE");
lines.push("------------------");
for (const x of samples.slice(0,60)) {
  lines.push(`${x.player} | ${x.team} | ${x.market} ${x.line} | trend=${x.trend} | popular=${x.popular} | disc=${x.discrepancy} | lineup=${x.lineup} | order=${x.order}`);
}
lines.push("");
lines.push(`saved: ${OUT_JSON}`);
lines.push(`updated: ${BOARD}`);
writeText(OUT_TXT, lines.join("\n")+"\n");

console.log(audit);
