const fs = require("fs");
const path = require("path");

function getDateArg() {
  const flagDate = process.argv.find(a => /^--date=/.test(a));
  if (flagDate) return flagDate.split("=")[1];
  const positional = process.argv.slice(2).find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  return positional || process.env.npm_config_date || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);
}

const date = getDateArg();
const BOARD = "outputs/priced-board.json";
const OUT = `outputs/context/pitch-type-real-coverage-reconcile-${date}.json`;
const LATEST = "outputs/context/pitch-type-real-coverage-reconcile-latest.json";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function pct(n, d) {
  if (!d) return "0.0%";
  return `${((Number(n || 0) / Number(d || 0)) * 100).toFixed(1)}%`;
}

function market(row) {
  return String(row.market || row.stat || row.stat_short || "").toLowerCase();
}

function player(row) {
  return row.player || row.playerName || row.name || row.description || null;
}

function tier(row) {
  return row.oddsTier || row.tier || row.projectionType || null;
}

function pitcher(row) {
  return (
    row.pitchTypeOpponentPitcher ||
    row.opposingPitcher ||
    row.opponentPitcher ||
    row.probablePitcher ||
    row.handednessContext?.opposingPitcher ||
    row.handednessAdjustment?.opposingPitcher ||
    null
  );
}

function inc(obj, key) {
  const k = String(key ?? "null");
  obj[k] = (obj[k] || 0) + 1;
}

function sample(row) {
  return {
    player: player(row),
    team: row.team || row.resolvedTeam || null,
    game: row.game || row.resolvedGame || null,
    market: market(row),
    side: row.side || null,
    line: row.line ?? row.projection ?? row.value ?? null,
    tier: tier(row),
    pitcher: pitcher(row),
    pitchTypeMatchupReady: row.pitchTypeMatchupReady ?? null,
    pitchTypeMatchupAvailable: row.pitchTypeMatchupAvailable ?? null,
    pitchTypeMatchupScored: row.pitchTypeMatchupScored ?? null,
    pitchTypeMatchupTier: row.pitchTypeMatchupTier ?? null,
    pitchTypeMatchupScore: row.pitchTypeMatchupScore ?? null,
    pitchTypeMatchupSource: row.pitchTypeMatchupSource ?? null,
    pitchTypeSource: row.pitchTypeSource ?? null,
    pitchTypeNeutralFallback: row.pitchTypeNeutralFallback ?? null,
    pitchTypePitcherArsenalReady: row.pitchTypePitcherArsenalReady ?? null,
    pitchTypePrimaryPitches: Array.isArray(row.pitchTypePrimaryPitches) ? row.pitchTypePrimaryPitches.slice(0, 5) : row.pitchTypePrimaryPitches ?? null,
    flags: Array.isArray(row.pitchTypeMatchupFlags) ? row.pitchTypeMatchupFlags.slice(0, 8) : row.pitchTypeMatchupFlags ?? null
  };
}

function isRealStrict(row) {
  if (row.pitchTypeNeutralFallback === true) return false;
  if (String(row.pitchTypeMatchupSource || row.pitchTypeSource || "").toUpperCase() === "NEUTRAL_FALLBACK") return false;
  if (row.pitchTypeMatchupScored === true) return true;
  if (row.pitchTypeMatchupReady === true && row.pitchTypePitcherArsenalReady === true) return true;
  return false;
}

function isRealCoverageScriptStyle(row) {
  if (row.pitchTypeNeutralFallback === true) return false;
  const tier = String(row.pitchTypeMatchupTier || "").toLowerCase();
  const source = String(row.pitchTypeSource || row.pitchTypeMatchupSource || "").toUpperCase();
  if (row.pitchTypeMatchupScored === true && tier !== "neutral" && tier !== "unknown") return true;
  if (row.pitchTypeMatchupReady === true && source !== "NEUTRAL_FALLBACK") return true;
  if (row.pitchTypePitcherArsenalReady === true && Array.isArray(row.pitchTypePrimaryPitches) && row.pitchTypePrimaryPitches.length) return true;
  return false;
}

const board = readJson(BOARD, []);
const rows = (Array.isArray(board) ? board : []).filter(r => !r.recordType || r.recordType === "merged_prop");

const bySource = {};
const byMatchupSource = {};
const byTier = {};
const byReasonFlag = {};
const byState = {};
const byMarketState = {};
const samples = {
  strictReal: [],
  coverageStyleReal: [],
  neutralFallback: [],
  scoredButNeutral: [],
  readyButNeutral: [],
  readyButNotScored: [],
  missingPitchType: [],
  arsenalReadyButNotReal: [],
  scoredButAuditWouldMiss: []
};

let strictReal = 0;
let coverageStyleReal = 0;
let neutralFallback = 0;
let scoredTrue = 0;
let readyTrue = 0;
let arsenalReady = 0;
let availableTrue = 0;

for (const row of rows) {
  const state = row.pitchTypeNeutralFallback === true
    ? "NEUTRAL_FALLBACK"
    : isRealCoverageScriptStyle(row)
      ? "REAL_COVERAGE_STYLE"
      : isRealStrict(row)
        ? "REAL_STRICT"
        : "MISSING_OR_UNSCORED";

  if (isRealStrict(row)) strictReal++;
  if (isRealCoverageScriptStyle(row)) coverageStyleReal++;
  if (row.pitchTypeNeutralFallback === true) neutralFallback++;
  if (row.pitchTypeMatchupScored === true) scoredTrue++;
  if (row.pitchTypeMatchupReady === true) readyTrue++;
  if (row.pitchTypePitcherArsenalReady === true) arsenalReady++;
  if (row.pitchTypeMatchupAvailable === true) availableTrue++;

  inc(bySource, row.pitchTypeSource);
  inc(byMatchupSource, row.pitchTypeMatchupSource);
  inc(byTier, row.pitchTypeMatchupTier);
  inc(byState, state);
  inc(byMarketState, `${market(row)}|${state}`);

  for (const f of row.pitchTypeMatchupFlags || []) inc(byReasonFlag, f);

  if (isRealStrict(row) && samples.strictReal.length < 8) samples.strictReal.push(sample(row));
  if (isRealCoverageScriptStyle(row) && samples.coverageStyleReal.length < 8) samples.coverageStyleReal.push(sample(row));
  if (row.pitchTypeNeutralFallback === true && samples.neutralFallback.length < 8) samples.neutralFallback.push(sample(row));
  if (row.pitchTypeMatchupScored === true && row.pitchTypeNeutralFallback === true && samples.scoredButNeutral.length < 8) samples.scoredButNeutral.push(sample(row));
  if (row.pitchTypeMatchupReady === true && row.pitchTypeNeutralFallback === true && samples.readyButNeutral.length < 8) samples.readyButNeutral.push(sample(row));
  if (row.pitchTypeMatchupReady === true && row.pitchTypeMatchupScored !== true && row.pitchTypeNeutralFallback !== true && samples.readyButNotScored.length < 8) samples.readyButNotScored.push(sample(row));
  if (!isRealCoverageScriptStyle(row) && row.pitchTypeNeutralFallback !== true && samples.missingPitchType.length < 8) samples.missingPitchType.push(sample(row));
  if (row.pitchTypePitcherArsenalReady === true && !isRealCoverageScriptStyle(row) && samples.arsenalReadyButNotReal.length < 8) samples.arsenalReadyButNotReal.push(sample(row));
  if (row.pitchTypeMatchupScored === true && !isRealCoverageScriptStyle(row) && samples.scoredButAuditWouldMiss.length < 8) samples.scoredButAuditWouldMiss.push(sample(row));
}

function top(obj, n = 20) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

const report = {
  date,
  generatedAt: new Date().toISOString(),
  rows: rows.length,
  summary: {
    rows: rows.length,
    strictReal,
    strictRealPct: pct(strictReal, rows.length),
    coverageStyleReal,
    coverageStyleRealPct: pct(coverageStyleReal, rows.length),
    neutralFallback,
    neutralFallbackPct: pct(neutralFallback, rows.length),
    scoredTrue,
    readyTrue,
    availableTrue,
    arsenalReady
  },
  byState: top(byState, 20),
  bySource: top(bySource, 30),
  byMatchupSource: top(byMatchupSource, 30),
  byTier: top(byTier, 30),
  topFlags: top(byReasonFlag, 30),
  byMarketState: top(byMarketState, 50),
  samples
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("PITCH TYPE REAL COVERAGE RECONCILE");
console.log("----------------------------------");
console.table([report.summary]);
console.log("\nBy state:");
console.table(report.byState);
console.log("\nBy source:");
console.table(report.bySource);
console.log("\nBy matchup source:");
console.table(report.byMatchupSource);
console.log("\nBy tier:");
console.table(report.byTier);
console.log("\nTop flags:");
console.table(report.topFlags);
console.log("\nTop market/state:");
console.table(report.byMarketState.slice(0, 25));

for (const [name, arr] of Object.entries(samples)) {
  console.log(`\nSample: ${name}`);
  console.table(arr);
}

console.log(`saved: ${OUT}`);
console.log(`saved: ${LATEST}`);
