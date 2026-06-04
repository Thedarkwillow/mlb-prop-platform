const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const PROD = "outputs/production-candidates.json";
const PHASE8 = "outputs/phase8-candidate-audit.json";
const OUT = "outputs/current-pitcher-projection-gap-audit.json";

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
    v.side || v.line || v.projection || v.recommendedProb;
  if (hasProp) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    pitcher_strikeouts: "strikeouts",
    strikeouts: "strikeouts",
    k: "strikeouts",
    ks: "strikeouts",
    hits_allowed: "hits_allowed",
    pitcher_hits_allowed: "hits_allowed",
    walks_allowed: "walks_allowed",
    pitcher_walks_allowed: "walks_allowed",
    earned_runs_allowed: "earned_runs_allowed",
    pitcher_earned_runs_allowed: "earned_runs_allowed",
    runs_allowed: "runs_allowed",
    pitching_outs: "pitching_outs",
    outs: "pitching_outs",
    pitches_thrown: "pitches_thrown",
    pitcher_fantasy_score: "pitcher_fantasy_score"
  };
  return map[s] || s;
}

function isPitcherMarket(m) {
  return [
    "strikeouts",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "runs_allowed",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score"
  ].includes(marketNorm(m));
}

function sideOf(r) {
  return String(r.side || r.pick || r.direction || r.recommendedSide || "NA").toUpperCase();
}

function playerOf(r) {
  return r.player || r.playerName || r.name || r.participantName || "NA";
}

function lineOf(r) {
  const n = Number(r.line ?? r.lineScore ?? r.target);
  return Number.isFinite(n) ? n : null;
}

function probOf(r) {
  const n = Number(
    r.prob ??
    r.probability ??
    r.recommendedProb ??
    r.pickProb ??
    r.calibratedDistributionProb ??
    r.contextAdjustedDistributionProb
  );
  return Number.isFinite(n) ? n : null;
}

function projectionOf(r) {
  const n = Number(
    r.projection ??
    r.contextAdjustedProjection ??
    r.adjustedProjection ??
    r.mean ??
    r.projected
  );
  return Number.isFinite(n) ? n : null;
}

function key(r) {
  return [
    norm(playerOf(r)),
    marketNorm(r.market || r.statType || r.stat || r.projectionType),
    sideOf(r),
    String(lineOf(r))
  ].join("|");
}

function countBy(rows, fn) {
  const out = {};
  for (const r of rows) {
    const k = fn(r);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

const board = flatten(read(BOARD, []));
const prod = flatten(read(PROD, []));
const phase8 = flatten(read(PHASE8, []));

const boardPitchers = board.filter(r => isPitcherMarket(r.market || r.statType || r.stat || r.projectionType));
const prodPitchers = prod.filter(r => isPitcherMarket(r.market || r.statType || r.stat || r.projectionType));
const phase8Pitchers = phase8.filter(r => isPitcherMarket(r.market || r.statType || r.stat || r.projectionType));

const prodKeys = new Set(prodPitchers.map(key));
const phase8Keys = new Set(phase8Pitchers.map(key));

const rows = boardPitchers.map(r => {
  const projection = projectionOf(r);
  const prob = probOf(r);
  const k = key(r);
  return {
    player: playerOf(r),
    team: r.team || r.teamAbbr || r.resolvedTeam || null,
    market: marketNorm(r.market || r.statType || r.stat || r.projectionType),
    stat: r.stat || r.statType || null,
    side: sideOf(r),
    line: lineOf(r),
    tier: r.oddsTier || r.tier || r.specialTier || "standard",
    projection,
    prob,
    edge: r.edge ?? r.expectedValue ?? r.ev ?? null,
    disabledReason: r.disabledReason || r.reason || null,
    hasValidProjection: projection !== null && projection > 0,
    hasValidProb: prob !== null && prob >= 0.1 && prob <= 1,
    inProductionCandidates: prodKeys.has(k),
    inPhase8Audit: phase8Keys.has(k)
  };
});

const summary = {
  boardPitcherRows: boardPitchers.length,
  productionPitcherRows: prodPitchers.length,
  phase8PitcherRows: phase8Pitchers.length,
  boardWithValidProjection: rows.filter(r => r.hasValidProjection).length,
  boardWithValidProb: rows.filter(r => r.hasValidProb).length,
  boardInProductionCandidates: rows.filter(r => r.inProductionCandidates).length,
  boardInPhase8Audit: rows.filter(r => r.inPhase8Audit).length,
  byMarket: countBy(rows, r => r.market),
  byMarketValidProjection: countBy(rows.filter(r => r.hasValidProjection), r => r.market),
  byMarketValidProb: countBy(rows.filter(r => r.hasValidProb), r => r.market),
  byDisabledReason: countBy(rows, r => r.disabledReason || "none"),
  byMarketDisabledReason: countBy(rows, r => `${r.market}:${r.disabledReason || "none"}`)
};

const missingProjection = rows.filter(r => !r.hasValidProjection);
const missingProb = rows.filter(r => !r.hasValidProb);

const out = {
  summary,
  missingProjection: missingProjection.slice(0, 200),
  missingProb: missingProb.slice(0, 200),
  productionPitcherSample: prodPitchers.slice(0, 50).map(r => ({
    player: playerOf(r),
    market: marketNorm(r.market || r.statType || r.stat || r.projectionType),
    side: sideOf(r),
    line: lineOf(r),
    prob: probOf(r),
    projection: projectionOf(r),
    source: r.source || null,
    phase8Imported: r.phase8Imported || false,
    phase8Status: r.phase8Status || null
  })),
  phase8PitcherSample: phase8Pitchers.slice(0, 50).map(r => ({
    player: playerOf(r),
    market: marketNorm(r.market || r.statType || r.stat || r.projectionType),
    side: sideOf(r),
    line: lineOf(r),
    prob: probOf(r),
    projection: projectionOf(r),
    source: r.source || null,
    phase8Status: r.phase8Status || null
  }))
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("CURRENT PITCHER PROJECTION GAP AUDIT");
console.log("====================================");
console.log(JSON.stringify(summary, null, 2));

console.log("");
console.log("TOP MISSING PROJECTION");
console.log("----------------------");
for (const r of missingProjection.slice(0, 40)) {
  console.log(`${r.player} | ${r.market} ${r.side} ${r.line} | tier=${r.tier} | projection=${r.projection} | prob=${r.prob} | reason=${r.disabledReason || "none"} | inProd=${r.inProductionCandidates} | inPhase8=${r.inPhase8Audit}`);
}

console.log("");
console.log("saved:", OUT);
