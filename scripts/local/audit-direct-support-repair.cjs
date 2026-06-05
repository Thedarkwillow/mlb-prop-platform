const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);
const OUT_JSON = `outputs/direct-support-repair-audit-${DATE}.json`;
const OUT_TXT = `outputs/direct-support-repair-audit-${DATE}.txt`;

function read(p,f){try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return f}}
function flat(v,out=[]){
  if (!v) return out;
  if (Array.isArray(v)) { for (const x of v) flat(x,out); return out; }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.stat) out.push(v);
  for (const x of Object.values(v)) if (x && typeof x === "object") flat(x,out);
  return out;
}
function norm(v){
  return String(v||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g,"")
    .replace(/[^a-z0-9]+/g,"");
}
function market(v){
  let m = String(v?.market || v?.stat || v?.type || v || "").toLowerCase().replace(/\s+/g,"_");
  if (m === "total_bases") m = "bases";
  if (m === "runs_batted_in") m = "rbis";
  if (m === "hits+runs+rbis" || m === "hits_runs_rbis") m = "hrr";
  if (m === "pitcher_strikeouts") m = "strikeouts";
  if (m === "pitcher_outs" || m === "outs_recorded") m = "pitching_outs";
  if (m === "pitcher_hits_allowed") m = "hits_allowed";
  if (m === "pitcher_walks_allowed") m = "walks_allowed";
  if (m === "pitcher_earned_runs") m = "earned_runs_allowed";
  return m;
}
function side(r){ return String(r.side || r.recommendedSide || r.playableSide || "").toUpperCase(); }
function line(r){ return Number(r.line ?? r.target ?? r.value ?? r.threshold); }
function key(r){
  return [norm(r.player || r.playerName || r.name), market(r), side(r), line(r)].join("|");
}
function playerMarketKey(r){
  return [norm(r.player || r.playerName || r.name), market(r)].join("|");
}
function books(r){
  return Number(r.books ?? r.bookCount ?? r.sportsbookBookCount ?? r.directBookCount ?? r.supportBooks ?? 0);
}
function support(r){
  return String(r.support || r.bookSupport || r.directBookSupport || r.marketSupportFlag || r.supportType || "").toUpperCase();
}
function grade(r){
  return String(r.grade || r.bookSupportGrade || r.directBookGrade || r.validationGrade || "").toUpperCase();
}
function cls(r){
  return String(r.class || r.classification || r.candidateClass || "").toUpperCase();
}
function isUnsupported(r){
  const s = support(r);
  const g = grade(r);
  const b = books(r);
  return !Number.isFinite(b) || b < 2 || !s || s === "UNKNOWN" || s.includes("UNPRICED") || s.includes("LOW") || s.includes("MISSING") || g === "UNKNOWN";
}
function isRealPricedEvidence(r){
  const sportsbook = String(r.sportsbook || r.book || r.bookmaker || r.sportsbookTitle || "").trim();
  const odds = Number(r.odds ?? r.price);
  const l = line(r);
  const sd = side(r);
  const player = r.player || r.playerName || r.name || r.participant || r.description;

  if (!sportsbook) return false;
  if (!player) return false;
  if (!market(r)) return false;
  if (!["MORE","LESS"].includes(sd)) return false;
  if (!Number.isFinite(l)) return false;
  if (!Number.isFinite(odds)) return false;

  return true;
}

const production = read("outputs/production-candidates.json", {});
const prodRows = flat(production.all || production.classes || production);

const vegasRaw = flat(read("data/vegas-raw.json", []));

// IMPORTANT:
// Use data/vegas-raw.json as the true direct sportsbook evidence source.
// This file contains normalized OddsAPI/vegas rows with sportsbook, market,
// player, side, line, odds, and implied probability.
const evidenceRows = vegasRaw
  .map(r => ({...r, evidenceSource:"data/vegas-raw.json"}))
  .filter(r => r.player || r.playerName || r.name || r.participant || r.description);

const exact = new Map();
const byPlayerMarket = new Map();
const byMarket = new Map();

for (const r of evidenceRows) {
  const k = key(r);
  if (!exact.has(k)) exact.set(k, []);
  exact.get(k).push(r);

  const pm = playerMarketKey(r);
  if (!byPlayerMarket.has(pm)) byPlayerMarket.set(pm, []);
  byPlayerMarket.get(pm).push(r);

  const m = market(r);
  if (!byMarket.has(m)) byMarket.set(m, []);
  byMarket.get(m).push(r);
}

const unsupported = prodRows.filter(isUnsupported);

const rows = unsupported.map(r => {
  const k = key(r);
  const pm = playerMarketKey(r);
  const exactMatches = exact.get(k) || [];
  const playerMarketMatches = byPlayerMarket.get(pm) || [];
  const marketMatches = byMarket.get(market(r)) || [];

  const realExact = exactMatches.filter(isRealPricedEvidence);
  const realNear = playerMarketMatches.filter(x => isRealPricedEvidence(x) && Math.abs(line(x) - line(r)) <= 1);

  let repairStatus = "STAYS_UNSUPPORTED";
  let repairReason = "no_real_direct_book_evidence";

  if (!marketMatches.length) {
    repairReason = "sportsbook_market_missing";
  } else if (!playerMarketMatches.length) {
    repairReason = "market_exists_player_unmatched";
  } else if (realExact.length) {
    repairStatus = "CAN_REPAIR_EXACT";
    repairReason = "real_exact_direct_support_found";
  } else if (realNear.length) {
    repairStatus = "CAN_REPAIR_NEAR_LINE";
    repairReason = "real_near_line_direct_support_found";
  } else if (playerMarketMatches.length) {
    repairReason = "player_market_found_but_no_trusted_line_support";
  }

  return {
    player: r.player || r.playerName || r.name,
    team: r.team || r.teamAbbr || r.resolvedTeam || "",
    market: market(r),
    side: side(r),
    line: line(r),
    tier: r.oddsTier || r.tier || "",
    class: cls(r),
    books: books(r),
    support: support(r) || "UNKNOWN",
    grade: grade(r) || "UNKNOWN",
    repairStatus,
    repairReason,
    exactMatches: exactMatches.length,
    playerMarketMatches: playerMarketMatches.length,
    marketMatches: marketMatches.length,
    bestExactEvidence: realExact.slice(0,2).map(x => ({
      source:x.evidenceSource,
      books:books(x),
      support:support(x),
      grade:grade(x),
      line:line(x)
    })),
    bestNearEvidence: realNear.slice(0,2).map(x => ({
      source:x.evidenceSource,
      books:books(x),
      support:support(x),
      grade:grade(x),
      line:line(x)
    }))
  };
});

function summarize(arr, fn){
  const m = {};
  for (const r of arr) {
    const k = fn(r);
    m[k] ||= { rows:0 };
    m[k].rows++;
  }
  return Object.entries(m).map(([bucket,v]) => ({bucket,...v})).sort((a,b)=>b.rows-a.rows);
}

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  note: "Audits unsupported production candidates against true direct sportsbook evidence from data/vegas-raw.json. Does not mutate data. Avoids circular production-candidate-derived audit evidence.",
  counts: {
    productionRows: prodRows.length,
    unsupportedRows: unsupported.length,
    repairExact: rows.filter(r => r.repairStatus === "CAN_REPAIR_EXACT").length,
    repairNearLine: rows.filter(r => r.repairStatus === "CAN_REPAIR_NEAR_LINE").length,
    staysUnsupported: rows.filter(r => r.repairStatus === "STAYS_UNSUPPORTED").length
  },
  byRepairReason: summarize(rows, r => r.repairReason),
  byMarketRepairReason: summarize(rows, r => `${r.market}|${r.repairReason}`),
  rows
};

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

const lines = [];
lines.push("DIRECT SUPPORT REPAIR / PROVENANCE AUDIT");
lines.push("========================================");
lines.push(`date=${DATE}`);
lines.push(JSON.stringify(report.counts));
lines.push("");
lines.push("BY REPAIR REASON");
for (const r of report.byRepairReason) lines.push(`${r.bucket}: ${r.rows}`);
lines.push("");
lines.push("REPAIRABLE SAMPLE");
for (const r of rows.filter(x => x.repairStatus !== "STAYS_UNSUPPORTED").slice(0,50)) {
  lines.push(`${r.repairStatus} | ${r.player} | ${r.market} ${r.side} ${r.line} | books=${r.books} support=${r.support} grade=${r.grade} | ${r.repairReason}`);
}
lines.push("");
lines.push("UNSUPPORTED SAMPLE");
for (const r of rows.filter(x => x.repairStatus === "STAYS_UNSUPPORTED").slice(0,50)) {
  lines.push(`${r.player} | ${r.market} ${r.side} ${r.line} | books=${r.books} support=${r.support} grade=${r.grade} | ${r.repairReason}`);
}
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(report.counts);
console.log("BY REPAIR REASON");
console.table(report.byRepairReason);
console.log("BY MARKET + REASON");
console.table(report.byMarketRepairReason.slice(0,40));
console.log("REPAIRABLE SAMPLE");
console.table(rows.filter(x => x.repairStatus !== "STAYS_UNSUPPORTED").slice(0,30).map(r => ({
  status:r.repairStatus,
  player:r.player,
  market:r.market,
  side:r.side,
  line:r.line,
  reason:r.repairReason
})));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
