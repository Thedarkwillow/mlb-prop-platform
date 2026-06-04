const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const PROD = "outputs/production-candidates.json";
const OUT = "outputs/production-pitcher-coverage-audit.json";

function read(p, f = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return f; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const hasProp =
    v.player || v.playerName || v.name ||
    v.market || v.statType || v.stat ||
    v.side || v.line || v.prob || v.probability;

  if (hasProp) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }

  return out;
}

function normName(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function marketNorm(v) {
  const s = String(v ?? "").toLowerCase().trim();
  const map = {
    pitcher_strikeouts: "strikeouts",
    strikeouts: "strikeouts",
    hits_allowed: "hits_allowed",
    pitcher_hits_allowed: "hits_allowed",
    walks_allowed: "walks_allowed",
    pitcher_walks_allowed: "walks_allowed",
    earned_runs_allowed: "earned_runs_allowed",
    pitcher_earned_runs_allowed: "earned_runs_allowed",
    pitching_outs: "pitching_outs",
    outs: "pitching_outs",
    pitches_thrown: "pitches_thrown",
    pitcher_fantasy_score: "pitcher_fantasy_score"
  };
  return map[s] || s;
}

function sideNorm(v, tier) {
  const raw = String(v ?? "").toUpperCase().trim();
  if (raw === "OVER") return "MORE";
  if (raw === "UNDER") return "LESS";
  if (raw === "MORE" || raw === "LESS") return raw;
  const t = String(tier ?? "").toLowerCase();
  if (t === "goblin" || t === "demon") return "MORE";
  return raw || "NA";
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getPlayer(r) {
  return r.player || r.playerName || r.name || r.participantName || r.displayName || "";
}

function getMarket(r) {
  return marketNorm(r.market || r.statType || r.stat || r.projectionType || r.type);
}

function getTier(r) {
  return String(r.oddsTier || r.specialTier || r.tier || "standard").toLowerCase();
}

function getSide(r) {
  return sideNorm(r.side || r.pick || r.direction || r.recommendation, getTier(r));
}

function getLine(r) {
  return num(r.line ?? r.lineScore ?? r.target ?? r.value ?? r.projection);
}

function key(r) {
  return [
    normName(getPlayer(r)),
    getMarket(r),
    getSide(r),
    String(getLine(r))
  ].join("|");
}

function modelProb(r) {
  const candidates = [
    r.prob,
    r.probability,
    r.modelProb,
    r.modelProbability,
    r.recommendedProb,
    r.pickProb,
    r.calibratedDistributionProb,
    r.contextAdjustedDistributionProb
  ];
  for (const v of candidates) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
}

function modelProbQuality(v) {
  if (v == null) return "NO_MODEL_PROB";
  if (v > 0 && v < 0.10) return "LOW_PLACEHOLDER_OR_NON_PROBABILITY";
  if (v >= 0.10 && v < 0.50) return "LOW_MODEL_PROBABILITY";
  if (v >= 0.50 && v <= 1) return "VALID_MODEL_PROBABILITY";
  return "INVALID_MODEL_PROBABILITY";
}

function isPitcherMarket(m) {
  return [
    "strikeouts",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score"
  ].includes(m);
}

const board = flatten(read(BOARD, []));
const prod = flatten(read(PROD, []));

const prodByKey = new Map();
for (const r of prod) prodByKey.set(key(r), r);

const pitcherBoard = board
  .filter(r => isPitcherMarket(getMarket(r)))
  .filter(r => !String(getPlayer(r)).includes("+"));

const rows = pitcherBoard.map(r => {
  const k = key(r);
  const p = prodByKey.get(k) || null;
  const boardProb = modelProb(r);
  const prodProb = p ? modelProb(p) : null;

  let status = "NOT_IN_PRODUCTION_CANDIDATES";
  if (p && modelProbQuality(prodProb) === "VALID_MODEL_PROBABILITY") status = "IN_PRODUCTION_WITH_VALID_MODEL_PROB";
  else if (p) status = "IN_PRODUCTION_WITH_WEAK_OR_MISSING_MODEL_PROB";

  return {
    key: k,
    player: getPlayer(r),
    team: r.team || r.teamAbbr || r.teamCode || null,
    market: getMarket(r),
    side: getSide(r),
    line: getLine(r),
    tier: getTier(r),
    status,
    boardProb,
    boardProbQuality: modelProbQuality(boardProb),
    productionProb: prodProb,
    productionProbQuality: modelProbQuality(prodProb),
    inProduction: Boolean(p),
    boardFields: {
      recommendedProb: r.recommendedProb ?? null,
      prob: r.prob ?? null,
      probability: r.probability ?? null,
      expectedValue: r.expectedValue ?? null,
      edge: r.edge ?? null,
      support: r.support ?? r.marketSupportFlag ?? null,
      grade: r.grade ?? r.qualityGrade ?? null
    },
    productionFields: p ? {
      prob: p.prob ?? null,
      probability: p.probability ?? null,
      recommendedProb: p.recommendedProb ?? null,
      edge: p.edge ?? null,
      support: p.support ?? p.marketSupportFlag ?? null,
      grade: p.grade ?? p.qualityGrade ?? null,
      class: p.class ?? null,
      reason: p.reason ?? p.blockedReason ?? null
    } : null
  };
});

const byStatus = {};
const byMarketStatus = {};
for (const r of rows) {
  byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const mk = `${r.market}:${r.status}`;
  byMarketStatus[mk] = (byMarketStatus[mk] || 0) + 1;
}

const summary = {
  boardPitcherRows: rows.length,
  productionPitcherRows: prod.filter(r => isPitcherMarket(getMarket(r))).length,
  byStatus,
  byMarketStatus
};

fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2) + "\n");

console.log("PRODUCTION PITCHER COVERAGE AUDIT");
console.log("=================================");
console.log(JSON.stringify(summary, null, 2));

console.log("\nTOP NOT IN PRODUCTION:");
for (const r of rows.filter(x => x.status === "NOT_IN_PRODUCTION_CANDIDATES").slice(0, 40)) {
  console.log(`${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | boardProbQuality=${r.boardProbQuality}`);
}

console.log(`\nsaved: ${OUT}`);
