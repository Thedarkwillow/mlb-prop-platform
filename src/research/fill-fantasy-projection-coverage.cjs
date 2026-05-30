const fs = require("fs");
const path = require("path");

const FILE = "outputs/priced-board.json";
const OUT = "outputs/fantasy-projection-coverage-fill-report.json";
const TXT = "outputs/fantasy-projection-coverage-fill-report.txt";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

function upper(v) {
  return String(v ?? "").trim().toUpperCase();
}

function isFantasy(row) {
  const raw = lower(row.market ?? row.stat ?? row.type ?? row.statType ?? "");
  return raw.includes("fantasy");
}

function marketOf(row) {
  const raw = lower(row.market ?? row.stat ?? row.type ?? row.statType ?? "");
  if (raw.includes("pitcher") && raw.includes("fantasy")) return "pitcher_fantasy_score";
  if (raw.includes("hitter") && raw.includes("fantasy")) return "hitter_fantasy_score";
  if (raw.includes("fantasy")) return "fantasy_score";
  return raw;
}

function hasExistingProjection(row) {
  const projection = num(row.projection, null);
  const prob = num(row.recommendedProb, null);
  const side = upper(row.recommendedSide ?? row.side ?? "");
  return projection !== null && projection !== 0 && prob !== null && ["MORE", "LESS"].includes(side);
}

function blend(season, recent, seasonWeight = 0.45, recentWeight = 0.55) {
  const s = num(season, null);
  const r = num(recent, null);

  if (s !== null && r !== null) return (s * seasonWeight) + (r * recentWeight);
  if (r !== null) return r;
  if (s !== null) return s;
  return null;
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function expectedValue(prob) {
  return Number(((prob * 2) - 1).toFixed(4));
}

function deriveSideProbEv(projection, line, market) {
  const diff = projection - line;

  if (!Number.isFinite(diff) || Math.abs(diff) < 0.0001) {
    return {
      recommendedSide: null,
      recommendedProb: null,
      expectedValue: null,
      sideStatus: "projection_equals_line"
    };
  }

  const side = diff > 0 ? "MORE" : "LESS";

  /*
    Conservative distribution widths.
    These are not official model probabilities.
    They are used only to make fallback fantasy rows trackable.
  */
  const sd = market === "pitcher_fantasy_score" ? 7.5 : 5.5;
  const probMore = sigmoid(diff / sd);
  const selectedProb = side === "MORE" ? probMore : 1 - probMore;
  const prob = clamp(selectedProb, 0.01, 0.99);

  return {
    recommendedSide: side,
    recommendedProb: Number(prob.toFixed(4)),
    expectedValue: expectedValue(prob),
    sideStatus: "fallback_side_from_projection"
  };
}

function pitcherFantasyFallback(row) {
  const outs = blend(row.pitcherSeasonOutsPerGame, row.pitcherLast5OutsPerGame);
  const strikeouts = blend(row.pitcherSeasonStrikeoutsPerGame, row.pitcherLast5StrikeoutsPerGame);
  const earnedRuns = blend(row.pitcherSeasonEarnedRunsPerGame, row.pitcherLast5EarnedRunsPerGame);
  const qualityStartRate = blend(row.pitcherSeasonQualityStartRate, row.pitcherLast5QualityStartRate);

  const hasCore =
    num(outs, null) !== null ||
    num(strikeouts, null) !== null ||
    num(earnedRuns, null) !== null;

  if (!hasCore) return null;

  const projection =
    num(outs, 0) +
    (num(strikeouts, 0) * 3) -
    (num(earnedRuns, 0) * 3) +
    (num(qualityStartRate, 0) * 4);

  if (!Number.isFinite(projection) || projection <= 0) return null;

  return {
    projection: Number(projection.toFixed(3)),
    projectionSource: "fantasy_fallback_pitcher_components",
    projectionConfidence: (
      num(outs, null) !== null &&
      num(strikeouts, null) !== null &&
      num(earnedRuns, null) !== null
    ) ? "MEDIUM" : "LOW",
    componentInputs: {
      outs,
      strikeouts,
      earnedRuns,
      qualityStartRate
    }
  };
}

function hitterFantasyFallback(row) {
  const hits = blend(row.hitterSeasonHitsPerGame, row.hitterLast15HitsPerGame);
  const totalBases = blend(row.hitterSeasonTotalBasesPerGame, row.hitterLast15TotalBasesPerGame);
  const hrr = blend(row.hitterSeasonHrrPerGame, row.hitterLast15HrrPerGame);

  const hasCore =
    num(hits, null) !== null &&
    num(totalBases, null) !== null &&
    num(hrr, null) !== null;

  if (!hasCore) return null;

  const h = Math.max(0, num(hits, 0));
  const tb = Math.max(h, num(totalBases, 0));
  const hrrVal = Math.max(h, num(hrr, 0));

  /*
    Conservative hitter fantasy fallback:
    - single baseline: 3 points per hit
    - extra bases: +2 per extra base above hits
    - runs + RBI proxy: HRR - hits, worth 2 each
    This intentionally excludes HBP/SB and undercounts HR/triple upside.
  */
  const hitBasePoints = (h * 3) + (Math.max(0, tb - h) * 2);
  const runRbiPoints = Math.max(0, hrrVal - h) * 2;
  const projection = hitBasePoints + runRbiPoints;

  if (!Number.isFinite(projection) || projection <= 0) return null;

  return {
    projection: Number(projection.toFixed(3)),
    projectionSource: "fantasy_fallback_hitter_partial_components",
    projectionConfidence: "LOW",
    componentInputs: {
      hits,
      totalBases,
      hrr
    }
  };
}

function fallbackProjection(row) {
  const market = marketOf(row);

  if (market === "pitcher_fantasy_score") return pitcherFantasyFallback(row);
  if (market === "hitter_fantasy_score") return hitterFantasyFallback(row);

  return null;
}

const board = readJson(FILE, []);
if (!Array.isArray(board)) {
  throw new Error(`${FILE} must be an array`);
}

const before = {
  fantasyRows: 0,
  existingProjected: 0,
  missingProjection: 0,
  sideUnknown: 0
};

const filled = [];
const stillMissing = [];

for (const row of board) {
  if (!isFantasy(row)) continue;

  before.fantasyRows += 1;
  if (hasExistingProjection(row)) before.existingProjected += 1;
  else before.missingProjection += 1;

  const currentSide = upper(row.recommendedSide ?? row.side ?? "");
  if (!["MORE", "LESS"].includes(currentSide)) before.sideUnknown += 1;

  if (hasExistingProjection(row)) continue;

  const market = marketOf(row);
  const line = num(row.line, null);
  const fallback = fallbackProjection(row);

  if (!fallback || line === null) {
    stillMissing.push({
      player: row.player ?? null,
      team: row.team ?? null,
      market,
      line,
      oddsTier: row.oddsTier ?? row.tier ?? null,
      reason: !fallback ? "missing_component_projection" : "missing_line"
    });
    continue;
  }

  const sideProb = deriveSideProbEv(fallback.projection, line, market);

  row.projection = fallback.projection;
  row.recommendedSide = sideProb.recommendedSide;
  row.recommendedProb = sideProb.recommendedProb;
  row.expectedValue = sideProb.expectedValue;

  row.fantasyProjectionCoverageStatus = "fallback_filled_track_only";
  row.fantasyProjectionSource = fallback.projectionSource;
  row.fantasyProjectionConfidence = fallback.projectionConfidence;
  row.fantasyProjectionComponentInputs = fallback.componentInputs;
  row.fantasyFallbackTrackOnly = true;

  /*
    Safety guard:
    fallback fantasy projections are for coverage/tracking only.
    They should not become official/core slip candidates until validated.
  */
  row.rankEligible = false;
  row.disabledReason = row.disabledReason || "fantasy_fallback_projection_track_only";

  filled.push({
    player: row.player ?? null,
    team: row.team ?? null,
    market,
    side: row.recommendedSide,
    line,
    oddsTier: row.oddsTier ?? row.tier ?? null,
    projection: row.projection,
    recommendedProb: row.recommendedProb,
    expectedValue: row.expectedValue,
    source: row.fantasyProjectionSource,
    confidence: row.fantasyProjectionConfidence
  });
}

writeJson(FILE, board);

const afterFantasy = board.filter(isFantasy);
const after = {
  fantasyRows: afterFantasy.length,
  projected: afterFantasy.filter(hasExistingProjection).length,
  sideKnown: afterFantasy.filter(r => ["MORE", "LESS"].includes(upper(r.recommendedSide ?? r.side ?? ""))).length,
  sideUnknown: afterFantasy.filter(r => !["MORE", "LESS"].includes(upper(r.recommendedSide ?? r.side ?? ""))).length,
  fallbackFilled: filled.length,
  stillMissing: stillMissing.length
};

const report = {
  generatedAt: new Date().toISOString(),
  file: FILE,
  policy: {
    trackOnly: true,
    rankEligible: false,
    note: "Fallback fantasy projections are for coverage and validation tracking only, not official slips."
  },
  before,
  after,
  filled,
  stillMissing: stillMissing.slice(0, 100)
};

writeJson(OUT, report);

const lines = [];
lines.push("FANTASY PROJECTION COVERAGE FILL REPORT");
lines.push("=======================================");
lines.push(`generatedAt: ${report.generatedAt}`);
lines.push("");
lines.push("BEFORE");
lines.push("------");
lines.push(`fantasy rows: ${before.fantasyRows}`);
lines.push(`existing projected: ${before.existingProjected}`);
lines.push(`missing projection: ${before.missingProjection}`);
lines.push(`side unknown: ${before.sideUnknown}`);
lines.push("");
lines.push("AFTER");
lines.push("-----");
lines.push(`fantasy rows: ${after.fantasyRows}`);
lines.push(`projected: ${after.projected}`);
lines.push(`side known: ${after.sideKnown}`);
lines.push(`side unknown: ${after.sideUnknown}`);
lines.push(`fallback filled: ${after.fallbackFilled}`);
lines.push(`still missing: ${after.stillMissing}`);
lines.push("");
lines.push("FILLED SAMPLE");
lines.push("-------------");
for (const r of filled.slice(0, 40)) {
  lines.push(`- ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.oddsTier} | proj=${r.projection} | prob=${r.recommendedProb} | ev=${r.expectedValue} | ${r.source} | ${r.confidence}`);
}
lines.push("");
lines.push("STILL MISSING SAMPLE");
lines.push("--------------------");
for (const r of stillMissing.slice(0, 40)) {
  lines.push(`- ${r.player} | ${r.market} ${r.line} | ${r.oddsTier} | ${r.reason}`);
}

writeText(TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("updated:", FILE);
console.log("saved:", OUT);
console.log("saved:", TXT);
