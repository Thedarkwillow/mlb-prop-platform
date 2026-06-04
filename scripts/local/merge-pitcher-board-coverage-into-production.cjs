const fs = require("fs");
const cp = require("child_process");

const DATE = process.argv[2] || process.env.SLATE_DATE || process.env.npm_config_date ||
  cp.execSync("node scripts/local/board-slate-date.cjs").toString().trim();

const BOARD_FILE = "outputs/priced-board.json";
const PROD_FILE = "outputs/production-candidates.json";
const PROD_DATED_FILE = `outputs/production-candidates-${DATE}.json`;
const OUT_AUDIT = `outputs/pitcher-production-coverage-merge-${DATE}.json`;
const OUT_LATEST = "outputs/pitcher-production-coverage-merge-latest.json";

const PITCHER_MARKETS = new Set([
  "strikeouts",
  "hits_allowed",
  "earned_runs_allowed",
  "walks_allowed",
  "pitching_outs",
  "pitcher_fantasy_score",
  "pitches_thrown"
]);

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function write(file, data) {
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
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
    v.side || v.line || v.prob || v.probability || v.recommendedProb;

  if (hasProp) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const raw = norm(v).replace(/\s+/g, "_");
  const aliases = {
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
  return aliases[raw] || raw;
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase();
  if (s.includes("MORE") || s === "OVER") return "MORE";
  if (s.includes("LESS") || s === "UNDER") return "LESS";
  return s || "NA";
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function firstProb(row) {
  for (const v of [
    row.prob,
    row.probability,
    row.recommendedProb,
    row.pickProb,
    row.adjustedProb,
    row.calibratedDistributionProb,
    row.contextAdjustedDistributionProb,
    row.moreProb,
    row.lessProb
  ]) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return null;
}

function firstEdge(row) {
  for (const v of [
    row.edge,
    row.expectedValue,
    row.ev,
    row.adjustedEdge,
    row.sportsbookAdjustedEdge,
    row.trueEV,
    row.trueEv
  ]) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function tier(row) {
  return norm(row.oddsTier || row.specialTier || row.tier || "standard") || "standard";
}

function key(row) {
  return [
    norm(row.player || row.playerName || row.name || row.participantName),
    marketNorm(row.market || row.statType || row.stat || row.projectionType),
    sideNorm(row.side || row.pick || row.direction || row.recommendation),
    String(num(row.line ?? row.lineScore ?? row.target ?? row.value, "NA"))
  ].join("|");
}

function classify(row, prob, edge) {
  const market = marketNorm(row.market || row.statType || row.stat || row.projectionType);
  const t = tier(row);
  const side = sideNorm(row.side || row.pick || row.direction || row.recommendation);

  if (market === "pitcher_fantasy_score") {
    return {
      class: "RESEARCH",
      stakeGuidance: "track only / pitcher fantasy scale not production verified",
      reasons: ["PITCHER_FANTASY_TRACK_ONLY", "not_official", "not_slip_builder_allowed"]
    };
  }

  if (market === "pitches_thrown") {
    return {
      class: "RESEARCH",
      stakeGuidance: "secondary research only / pitch count volatility",
      reasons: ["PITCH_COUNT_SECONDARY_ONLY", "not_official", "not_slip_builder_allowed"]
    };
  }

  if (t === "demon") {
    return {
      class: "RESEARCH",
      stakeGuidance: "demon research only",
      reasons: ["DEMON_RESEARCH_ONLY", "not_official", "not_slip_builder_allowed"]
    };
  }

  if ((t === "goblin" || t === "demon") && side !== "MORE") {
    return {
      class: "BLOCKED",
      stakeGuidance: "blocked / special tier LESS not allowed",
      reasons: ["SPECIAL_TIER_LESS_BLOCKED"]
    };
  }

  if (prob >= 0.65 && edge !== null && edge > 0) {
    return {
      class: "WATCHLIST",
      stakeGuidance: "track only / pitcher production coverage candidate",
      reasons: ["PITCHER_BOARD_MODEL_PROB_VALID", "production_coverage_merge", "not_official"]
    };
  }

  if (prob >= 0.55) {
    return {
      class: "RESEARCH",
      stakeGuidance: "research only / probability below watch threshold",
      reasons: ["PITCHER_BOARD_MODEL_PROB_LOW", "not_official"]
    };
  }

  return {
    class: "SHADOW_BLOCKED",
    stakeGuidance: "blocked / model probability too low",
    reasons: ["PITCHER_MODEL_DISAGREES", "not_official"]
  };
}

const boardRows = flatten(read(BOARD_FILE, []));
const prodRaw = read(PROD_FILE, []);
const prodRows = Array.isArray(prodRaw) ? prodRaw : flatten(prodRaw);

const existing = new Set(prodRows.map(key));
const pitcherBoard = boardRows.filter(r => PITCHER_MARKETS.has(marketNorm(r.market || r.statType || r.stat || r.projectionType)));

const valid = [];
const missing = [];

for (const r of pitcherBoard) {
  const market = marketNorm(r.market || r.statType || r.stat || r.projectionType);
  const side = sideNorm(r.side || r.pick || r.direction || r.recommendation);
  const line = num(r.line ?? r.lineScore ?? r.target ?? r.value, null);
  const prob = firstProb(r);
  const edge = firstEdge(r);

  const base = {
    player: r.player || r.playerName || r.name || r.participantName || null,
    team: r.team || r.resolvedTeam || null,
    game: r.game || r.resolvedGame || null,
    market,
    side,
    line,
    oddsTier: tier(r),
    prob,
    edge,
    projection: num(r.projection ?? r.projectedValue ?? r.mean, null),
    support: r.support || r.marketSupportFlag || r.priceCoverageTier || "BOARD_ONLY",
    grade: r.grade || r.qualityGrade || "UNKNOWN",
    source: "PRICED_BOARD_PITCHER_COVERAGE",
    pitcherProductionCoverage: true,
    originalDisabledReason: r.disabledReason || r.reason || null
  };

  if (!base.player || !market || !side || line === null) continue;

  if (prob === null) {
    missing.push({
      ...base,
      reason: "NO_VALID_BOARD_MODEL_PROBABILITY"
    });
    continue;
  }

  const c = classify(r, prob, edge);
  const row = {
    class: c.class,
    stakeGuidance: c.stakeGuidance,
    reasons: c.reasons,
    ...base
  };

  if (!existing.has(key(row))) {
    valid.push(row);
    existing.add(key(row));
  }
}

const merged = prodRows.concat(valid);

write(PROD_FILE, merged);
write(PROD_DATED_FILE, merged);

const audit = {
  date: DATE,
  boardPitcherRows: pitcherBoard.length,
  existingProductionRows: prodRows.length,
  addedPitcherCoverageRows: valid.length,
  missingPitcherModelProbRows: missing.length,
  addedByMarket: valid.reduce((m, r) => {
    m[r.market] = (m[r.market] || 0) + 1;
    return m;
  }, {}),
  missingByMarket: missing.reduce((m, r) => {
    m[r.market] = (m[r.market] || 0) + 1;
    return m;
  }, {}),
  addedRows: valid,
  missingRows: missing.slice(0, 250)
};

write(OUT_AUDIT, audit);
write(OUT_LATEST, audit);

console.log("PITCHER PRODUCTION COVERAGE MERGE");
console.log("=================================");
console.log(JSON.stringify({
  date: audit.date,
  boardPitcherRows: audit.boardPitcherRows,
  existingProductionRows: audit.existingProductionRows,
  addedPitcherCoverageRows: audit.addedPitcherCoverageRows,
  missingPitcherModelProbRows: audit.missingPitcherModelProbRows,
  addedByMarket: audit.addedByMarket,
  missingByMarket: audit.missingByMarket
}, null, 2));
console.log(`saved: ${OUT_AUDIT}`);
console.log(`updated: ${PROD_FILE}`);
console.log(`updated: ${PROD_DATED_FILE}`);
