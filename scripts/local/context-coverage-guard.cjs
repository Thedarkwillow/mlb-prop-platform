const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const OUT_DIR = "outputs/context";
const STRICT = process.env.STRICT_CONTEXT_GUARD === "1";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(n, d) {
  return d ? `${(n / d * 100).toFixed(1)}%` : "0.0%";
}

function ratio(n, d) {
  return d ? n / d : 0;
}

function dateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function boardSlateDate(rows) {
  const counts = new Map();
  for (const r of rows) {
    const d = dateOnly(r.startTime || r.game_start || r.start_time || r.board_time || r.updated_at);
    if (!d) continue;
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function market(row) {
  return String(row.market || row.stat || "").toLowerCase().trim();
}

function isPitcherMarket(row) {
  const m = market(row);
  const st = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();
  const pos = String(row.position || row.playerPosition || "").toUpperCase();

  if (st === "pitcher" || pos === "P") return true;

  return [
    "strikeouts",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score",
    "hits_allowed",
    "earned_runs_allowed",
    "walks_allowed",
    "1st_inning_runs_allowed",
    "1st_inning_walks_allowed",
    "pitcher_strikeouts_(combo)"
  ].includes(m);
}

function hitterPitchEligible(row) {
  if (!row || row.recordType !== "merged_prop") return false;
  if (row.comboProp === true || row.contextEligible === false) return false;
  if (isPitcherMarket(row)) return false;

  return [
    "hitter_fantasy_score",
    "hrr",
    "bases",
    "hits",
    "singles",
    "doubles",
    "triples",
    "home_runs",
    "hr",
    "runs",
    "rbis",
    "walks",
    "stolen_bases",
    "hitter_strikeouts"
  ].includes(market(row));
}

function hasAny(row, keys) {
  return keys.some(k => {
    const v = k.split(".").reduce((acc, part) => acc?.[part], row);
    return v !== undefined && v !== null && v !== "" && v !== false;
  });
}

function main() {
  const board = readJson(BOARD, []);
  const rows = board.filter(r => r && r.recordType === "merged_prop");

  const slateDate =
    process.env.SLATE_DATE ||
    process.env.npm_config_date ||
    process.argv[2] ||
    boardSlateDate(rows);

  const slateRows = rows.filter(r => {
    const d = dateOnly(r.startTime || r.game_start || r.start_time || r.board_time || r.updated_at);
    return d === slateDate;
  });

  const hitterPitchRows = slateRows.filter(hitterPitchEligible);

  const cleanPitchRows = hitterPitchRows.filter(row => {
    const hasPitcher =
      !!(row.pitchTypeOpponentPitcher || row.opponentPitcher || row.handednessContext?.opposingPitcher);

    // Clean production denominator:
    // Count only rows pitch-type actually scored. Rows merely marked available/ready
    // are board alternates or unpriced/research rows and should not drag down coverage.
    const scoredByPitchType = row.pitchTypeMatchupScored === true;

    return hasPitcher && scoredByPitchType;
  });

  const realPitchRows = cleanPitchRows.filter(row =>
    row.pitchTypeMatchupScored === true &&
    row.pitchTypeMatchupSource === "REAL_HITTER_PITCH_TYPE_MATCHUP"
  );

  const neutralPitchRows = cleanPitchRows.filter(row =>
    row.pitchTypeMatchupScored === true &&
    String(row.pitchTypeMatchupSource || "").includes("NEUTRAL")
  );

  const unscoredPitchRows = cleanPitchRows.filter(row => row.pitchTypeMatchupScored !== true);

  const summary = {
    generatedAt: new Date().toISOString(),
    slateDate,
    totalBoardRows: board.length,
    mergedRows: rows.length,
    slateRows: slateRows.length,

    lineupStrengthRows: slateRows.filter(r =>
      r.lineupStrengthReady === true ||
      r.lineupStrength ||
      r.lineupContext ||
      r.contextLineupStrength
    ).length,

    confirmedLineupRows: slateRows.filter(r =>
      r.confirmedLineup === true ||
      r.confirmedLineupMatched === true ||
      r.confirmedLineupPlayer === true ||
      r.lineupConfirmed === true
    ).length,

    handednessRows: slateRows.filter(r =>
      r.handednessMatched === true ||
      r.handednessContext ||
      r.handednessAdjustment
    ).length,

    contextAdjustedRows: slateRows.filter(r =>
      r.contextAdjustedReady === true ||
      r.contextAdjusted === true ||
      r.contextAdjustment ||
      r.contextAdjustedProjection
    ).length,

    cleanPitchRows: cleanPitchRows.length,
    realPitchRows: realPitchRows.length,
    neutralPitchRows: neutralPitchRows.length,
    unscoredPitchRows: unscoredPitchRows.length,

    rates: {}
  };

  summary.rates = {
    lineupStrength: pct(summary.lineupStrengthRows, summary.slateRows),
    confirmedLineup: pct(summary.confirmedLineupRows, summary.slateRows),
    handedness: pct(summary.handednessRows, summary.slateRows),
    contextAdjusted: pct(summary.contextAdjustedRows, summary.slateRows),
    pitchTypeReal: pct(summary.realPitchRows, summary.cleanPitchRows),
    pitchTypeFallback: pct(summary.neutralPitchRows + summary.unscoredPitchRows, summary.cleanPitchRows),
    pitchTypeUnscored: pct(summary.unscoredPitchRows, summary.cleanPitchRows)
  };

  const thresholds = {
    pitchTypeRealMin: Number(process.env.MIN_REAL_PITCH_TYPE || 0.90),
    pitchTypeUnscoredMax: Number(process.env.MAX_UNSCORED_PITCH_TYPE || 0.02),
    handednessMin: Number(process.env.MIN_HANDEDNESS || 0.80),
    contextAdjustedMin: Number(process.env.MIN_CONTEXT_ADJUSTED || 0.70)
  };

  const checks = [
    {
      layer: "pitchTypeReal",
      value: ratio(summary.realPitchRows, summary.cleanPitchRows),
      threshold: thresholds.pitchTypeRealMin,
      status: ratio(summary.realPitchRows, summary.cleanPitchRows) >= thresholds.pitchTypeRealMin ? "PASS" : "WARN"
    },
    {
      layer: "pitchTypeUnscored",
      value: ratio(summary.unscoredPitchRows, summary.cleanPitchRows),
      threshold: thresholds.pitchTypeUnscoredMax,
      status: ratio(summary.unscoredPitchRows, summary.cleanPitchRows) <= thresholds.pitchTypeUnscoredMax ? "PASS" : "WARN"
    },
    {
      layer: "handedness",
      value: ratio(summary.handednessRows, summary.slateRows),
      threshold: thresholds.handednessMin,
      status: ratio(summary.handednessRows, summary.slateRows) >= thresholds.handednessMin ? "PASS" : "WARN"
    },
    {
      layer: "contextAdjusted",
      value: ratio(summary.contextAdjustedRows, summary.slateRows),
      threshold: thresholds.contextAdjustedMin,
      status: ratio(summary.contextAdjustedRows, summary.slateRows) >= thresholds.contextAdjustedMin ? "PASS" : "WARN"
    }
  ];

  const report = {
    summary,
    thresholds,
    checks,
    strict: STRICT,
    status: checks.some(c => c.status !== "PASS") ? (STRICT ? "FAIL" : "WARN") : "PASS"
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/context-coverage-${slateDate}.json`, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(`${OUT_DIR}/context-coverage-latest.json`, JSON.stringify(report, null, 2) + "\n");

  console.log("CONTEXT COVERAGE GUARD");
  console.log("======================");
  console.table([{
    slateDate,
    rows: summary.slateRows,
    lineupStrength: summary.rates.lineupStrength,
    confirmedLineup: summary.rates.confirmedLineup,
    handedness: summary.rates.handedness,
    contextAdjusted: summary.rates.contextAdjusted,
    pitchTypeReal: summary.rates.pitchTypeReal,
    pitchTypeFallback: summary.rates.pitchTypeFallback,
    pitchTypeUnscored: summary.rates.pitchTypeUnscored,
    status: report.status
  }]);

  console.table(checks.map(c => ({
    layer: c.layer,
    value: `${(c.value * 100).toFixed(1)}%`,
    threshold: `${(c.threshold * 100).toFixed(1)}%`,
    status: c.status
  })));

  console.log(`saved: ${OUT_DIR}/context-coverage-${slateDate}.json`);
  console.log(`saved: ${OUT_DIR}/context-coverage-latest.json`);

  if (report.status === "FAIL") {
    process.exit(1);
  }
}

main();
