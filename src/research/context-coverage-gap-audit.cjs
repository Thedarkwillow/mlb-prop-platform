const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BOARD = "outputs/priced-board.json";
const COVERAGE = "outputs/context/context-coverage-report-latest.json";
const OUT = `outputs/context/context-coverage-gap-audit-${date}.json`;
const LATEST = "outputs/context/context-coverage-gap-audit-latest.json";

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
  return `${((n / d) * 100).toFixed(1)}%`;
}

function normTeam(v) {
  return String(v || "").toUpperCase().trim();
}

function cleanGame(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function inferOpponent(row) {
  const team = normTeam(row.resolvedTeam || row.team);
  const raw = cleanGame(row.resolvedGame || row.game);
  if (!team || !raw.includes("@")) return "";
  const [away, home] = raw.split("@").map(normTeam);
  if (away === team) return home;
  if (home === team) return away;
  return "";
}

function realRows(board) {
  return (Array.isArray(board) ? board : []).filter(r => r && r.recordType === "merged_prop");
}

function hasPitchType(row) {
  return row.pitchTypeMatchupReady === true;
}

function hasCatcher(row) {
  return row.opponentCatcherFramingReady === true ||
    row.catcherFramingReady === true ||
    row.opponentCatcher ||
    row.opponentCatcherFramingTier ||
    row.opponentCatcherFramingRunValue !== undefined ||
    row.opponentCatcherFramingPct !== undefined;
}

function hasUmpire(row) {
  return row.umpireContextReady === true ||
    row.umpireFramingAdjusted === true ||
    row.umpire ||
    row.umpireName ||
    row.umpireKFactor !== undefined ||
    row.umpireFramingAdjustment !== undefined;
}

function hasContextAdjusted(row) {
  return row.contextAdjustedProjection !== undefined ||
    row.contextAdjustment !== undefined ||
    row.handednessAdjustment !== undefined ||
    row.umpireFramingAdjustment !== undefined ||
    row.context?.flags?.length ||
    row.context?.projectionDeltaPct !== undefined ||
    row.context?.probDelta !== undefined;
}

function sample(rows, limit = 20) {
  return rows.slice(0, limit).map(r => ({
    player: r.player || r.playerName || r.name,
    team: r.team || r.resolvedTeam,
    opponent: r.opponent || r.resolvedOpponent || inferOpponent(r),
    game: r.resolvedGame || r.game,
    market: r.market,
    side: r.side || r.recommendedSide,
    line: r.line,
    oddsTier: r.oddsTier || r.tier,
    pitcher: r.opponentPitcher || r.probablePitcher || r.opposingPitcher || r.pitchTypeOpponentPitcher || null
  }));
}

const board = realRows(readJson(BOARD, []));
const coverage = readJson(COVERAGE, {});
const total = board.length;
const target = Math.ceil(total * 0.99);

const layers = [
  ["pitchType", hasPitchType],
  ["catcherFraming", hasCatcher],
  ["umpire", hasUmpire],
  ["contextAdjusted", hasContextAdjusted]
].map(([layer, fn]) => {
  const ready = board.filter(fn);
  const missing = board.filter(r => !fn(r));
  const needFor99 = Math.max(0, target - ready.length);

  const missingByMarket = {};
  const missingByGame = {};
  const missingByTeam = {};
  for (const r of missing) {
    const market = String(r.market || "unknown");
    const game = String(r.resolvedGame || r.game || "unknown");
    const team = String(r.team || r.resolvedTeam || "unknown");
    missingByMarket[market] = (missingByMarket[market] || 0) + 1;
    missingByGame[game] = (missingByGame[game] || 0) + 1;
    missingByTeam[team] = (missingByTeam[team] || 0) + 1;
  }

  function top(obj) {
    return Object.entries(obj)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }

  return {
    layer,
    total,
    ready: ready.length,
    missing: missing.length,
    coverage: pct(ready.length, total),
    target99Rows: target,
    needFor99,
    topMissingMarkets: top(missingByMarket),
    topMissingGames: top(missingByGame),
    topMissingTeams: top(missingByTeam),
    sampleMissing: sample(missing, 25)
  };
});

const report = {
  date,
  generatedAt: new Date().toISOString(),
  sourceBoard: BOARD,
  sourceCoverage: COVERAGE,
  totalRows: total,
  targetCoverage: "99.0%",
  targetRows: target,
  layers,
  currentCoverageReport: coverage.percentages || coverage
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("CONTEXT COVERAGE GAP AUDIT");
console.log("--------------------------");
console.log("date:", date);
console.log("total rows:", total);
console.log("target rows for 99%:", target);
console.table(layers.map(l => ({
  layer: l.layer,
  ready: l.ready,
  missing: l.missing,
  coverage: l.coverage,
  needFor99: l.needFor99
})));

for (const l of layers) {
  console.log("");
  console.log(`=== ${l.layer.toUpperCase()} TOP MISSING MARKETS ===`);
  console.table(l.topMissingMarkets.slice(0, 10));
  console.log(`=== ${l.layer.toUpperCase()} SAMPLE MISSING ===`);
  console.table(l.sampleMissing.slice(0, 10));
}

console.log("saved:", OUT);
console.log("saved:", LATEST);
