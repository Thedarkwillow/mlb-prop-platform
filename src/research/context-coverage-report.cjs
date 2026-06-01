const fs = require("fs");
const path = require("path");

const date = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const BOARD = "outputs/priced-board.json";
const OUT = `outputs/context/context-coverage-report-${date}.json`;
const LATEST = "outputs/context/context-coverage-report-latest.json";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(n, d) {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function truthy(v) {
  return v === true || v === "true" || v === "READY" || v === "OK" || v === "GREEN" || Number(v) !== 0 && Number.isFinite(Number(v));
}

function hasAny(row, keys) {
  return keys.some(k => row[k] !== undefined && row[k] !== null && row[k] !== "");
}

const raw = readJson(BOARD, []);
const rows = (Array.isArray(raw) ? raw : [])
  .filter(r => r && typeof r === "object" && r.recordType !== "pricing_summary");

const totalRows = rows.length;

const coverage = {
  date,
  generatedAt: new Date().toISOString(),
  boardFile: BOARD,
  totalRows,

  lineupRows: rows.filter(r =>
    truthy(r.lineupStrengthReady) ||
    hasAny(r, ["lineupTier", "lineupStrength", "lineupHitters", "lineupAvgHits", "lineupAvgTB", "lineupAvgHRR"])
  ).length,

  bullpenRows: rows.filter(r =>
    truthy(r.ownBullpenFatigueReady) ||
    truthy(r.opponentBullpenFatigueReady) ||
    hasAny(r, ["ownBullpenFatigue", "opponentBullpenFatigue", "bullpenFatigue", "bullpenTier"])
  ).length,

  catcherRows: rows.filter(r =>
    truthy(r.opponentCatcherFramingReady) ||
    hasAny(r, ["opponentCatcher", "opponentCatcherFramingTier", "opponentCatcherFramingRunValue", "opponentCatcherFramingPct"])
  ).length,

  umpireRows: rows.filter(r =>
    truthy(r.umpireContextReady) ||
    truthy(r.umpireFramingAdjusted) ||
    hasAny(r, ["umpire", "plateUmpire", "umpireContext", "umpireFramingAdjustment", "umpireKFactor"])
  ).length,

  pitchTypeRows: rows.filter(r =>
    truthy(r.pitchTypeMatchupReady) ||
    hasAny(r, ["pitchTypeMatchup", "pitchTypeMatchupScore", "pitchTypeAdjustment", "arsenalMatchup", "pitchArsenal"])
  ).length,

  handednessRows: rows.filter(r =>
    truthy(r.handednessReady) ||
    truthy(r.handednessMatched) ||
    hasAny(r, ["handednessContext", "handednessAdjustment", "handednessMatchType"])
  ).length,

  contextAdjustedRows: rows.filter(r =>
    hasAny(r, ["contextAdjustedProjection", "contextAdjustment", "handednessAdjustment", "umpireFramingAdjustment"])
  ).length
};

coverage.percentages = {
  lineupCoverage: pct(coverage.lineupRows, totalRows),
  bullpenCoverage: pct(coverage.bullpenRows, totalRows),
  catcherCoverage: pct(coverage.catcherRows, totalRows),
  umpireCoverage: pct(coverage.umpireRows, totalRows),
  pitchTypeCoverage: pct(coverage.pitchTypeRows, totalRows),
  handednessCoverage: pct(coverage.handednessRows, totalRows),
  contextAdjustedCoverage: pct(coverage.contextAdjustedRows, totalRows)
};

coverage.warnings = [];
if (coverage.lineupRows === 0) coverage.warnings.push("lineup_context_missing_from_board");
if (coverage.bullpenRows === 0) coverage.warnings.push("bullpen_context_missing_from_board");
if (coverage.catcherRows === 0) coverage.warnings.push("catcher_framing_context_missing_from_board");
if (coverage.umpireRows === 0) coverage.warnings.push("umpire_context_missing_from_board");
if (coverage.pitchTypeRows === 0) coverage.warnings.push("pitch_type_context_missing_from_board");
if (coverage.handednessRows === 0) coverage.warnings.push("handedness_context_missing_from_board");
if (coverage.contextAdjustedRows === 0) coverage.warnings.push("no_context_adjusted_projection_fields_found");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(coverage, null, 2) + "\n");
fs.writeFileSync(LATEST, JSON.stringify(coverage, null, 2) + "\n");

console.log("CONTEXT COVERAGE REPORT");
console.log("-----------------------");
console.log("date:", date);
console.table([{
  totalRows,
  lineupRows: coverage.lineupRows,
  bullpenRows: coverage.bullpenRows,
  catcherRows: coverage.catcherRows,
  umpireRows: coverage.umpireRows,
  pitchTypeRows: coverage.pitchTypeRows,
  handednessRows: coverage.handednessRows,
  contextAdjustedRows: coverage.contextAdjustedRows,
  lineupCoverage: coverage.percentages.lineupCoverage,
  bullpenCoverage: coverage.percentages.bullpenCoverage,
  catcherCoverage: coverage.percentages.catcherCoverage,
  umpireCoverage: coverage.percentages.umpireCoverage,
  pitchTypeCoverage: coverage.percentages.pitchTypeCoverage,
  handednessCoverage: coverage.percentages.handednessCoverage,
  contextAdjustedCoverage: coverage.percentages.contextAdjustedCoverage
}]);
if (coverage.warnings.length) console.log("warnings:", coverage.warnings.join(", "));
console.log("saved:", OUT);
console.log("saved:", LATEST);
