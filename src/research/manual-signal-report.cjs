const fs = require("fs");
const path = require("path");

const ledgerFile = "data/manual/manual-research-ledger.json";
const outJson = "outputs/manual/manual-signal-report.json";
const outTxt = "outputs/manual/manual-signal-report.txt";

function readJson(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function pct(v) {
  const x = n(v);
  if (x === null) return null;
  return x > 1 ? +(x / 100).toFixed(4) : x;
}

function normMarket(m) {
  const x = String(m || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (["total_bases", "bases", "tb"].includes(x)) return "bases";
  if (["hitter_fantasy_score", "hitter_fs", "fantasy"].includes(x)) return "hitter_fantasy_score";
  if (["hits_runs_rbis", "hrr"].includes(x)) return "hrr";
  return x;
}

function isHitterMarket(m) {
  return [
    "hitter_fantasy_score",
    "hrr",
    "bases",
    "singles",
    "runs",
    "walks",
    "hitter_strikeouts",
    "ks_plus_total_bases"
  ].includes(normMarket(m));
}

function rateScore(rate) {
  const r = pct(rate);
  if (r === null) return { score: 0, label: "missing" };
  if (r >= 0.7) return { score: 2.0, label: "elite_70_plus" };
  if (r >= 0.65) return { score: 1.5, label: "very_strong_65_plus" };
  if (r >= 0.6) return { score: 1.0, label: "strong_60_plus" };
  if (r >= 0.55) return { score: 0.6, label: "solid_55_plus" };
  if (r >= 0.5) return { score: 0.25, label: "positive_50_plus" };
  return { score: -0.75, label: "below_50" };
}

function avgScore(avg, line) {
  const a = n(avg);
  const l = n(line);
  if (a === null || l === null || l === 0) return { score: 0, label: "missing" };

  const ratio = a / l;

  if (ratio >= 1.75) return { score: 1.0, label: "avg_far_above_line" };
  if (ratio >= 1.4) return { score: 0.75, label: "avg_well_above_line" };
  if (ratio >= 1.15) return { score: 0.5, label: "avg_above_line" };
  if (ratio >= 1.0) return { score: 0.25, label: "avg_slightly_above_line" };
  return { score: -0.5, label: "avg_below_line" };
}

function resultBucket(row) {
  const result = String(row.result || "").toUpperCase();
  if (result === "HIT" || result === "WIN") return "hit";
  if (result === "MISS" || result === "LOSS") return "miss";
  if (result === "PUSH") return "push";
  if (result === "REFUND" || result === "DNP") return "refund";
  return "pending";
}

function scoreManualSignal(row) {
  const market = normMarket(row.market);
  const line = n(row.line);
  const reasons = [];
  const warnings = [];
  let score = 0;
  let positiveRateSplits = 0;
  let strongRateSplits = 0;
  let avgAboveLineSplits = 0;
  let availableRateSplits = 0;
  let availableAvgSplits = 0;

  if (!isHitterMarket(market)) {
    return {
      score: 0,
      class: "NOT_HITTER_SIGNAL",
      reasons: ["not_hitter_market"],
      warnings: [],
      positiveRateSplits: 0,
      strongRateSplits: 0,
      avgAboveLineSplits: 0,
      availableRateSplits: 0,
      availableAvgSplits: 0
    };
  }

  const rateFields = [
    ["last5HitRate", "L5"],
    ["last10HitRate", "L10"],
    ["last15HitRate", "L15"],
    ["seasonHitRate", "season"],
    ["homeAwayHitRate", "home_away"],
    ["handednessHitRate", "handedness"],
    ["homeAwayHandHitRate", "home_away_hand"],
    ["vsPitcherHitRate", "vs_pitcher"]
  ];

  const avgFields = [
    ["last5Avg", "L5_avg"],
    ["last10Avg", "L10_avg"],
    ["last15Avg", "L15_avg"],
    ["seasonAvg", "season_avg"],
    ["homeAwayAvg", "home_away_avg"],
    ["handednessAvg", "handedness_avg"],
    ["homeAwayHandAvg", "home_away_hand_avg"],
    ["vsPitcherAvg", "vs_pitcher_avg"]
  ];

  for (const [field, label] of rateFields) {
    if (row[field] === undefined || row[field] === null || row[field] === "") continue;

    availableRateSplits++;
    const rs = rateScore(row[field]);
    score += rs.score;

    const r = pct(row[field]);
    if (r !== null && r >= 0.5) positiveRateSplits++;
    if (r !== null && r >= 0.6) strongRateSplits++;

    reasons.push(`${label}:${rs.label}:${r === null ? "n/a" : (r * 100).toFixed(1) + "%"}`);
  }

  for (const [field, label] of avgFields) {
    if (row[field] === undefined || row[field] === null || row[field] === "") continue;

    availableAvgSplits++;
    const as = avgScore(row[field], line);
    score += as.score;

    const a = n(row[field]);
    if (a !== null && line !== null && a >= line) avgAboveLineSplits++;

    reasons.push(`${label}:${as.label}:${a === null ? "n/a" : a}`);
  }

  const vsPitcherSample = n(row.vsPitcherSample);
  if (row.vsPitcherHitRate !== undefined && row.vsPitcherHitRate !== null && row.vsPitcherHitRate !== "") {
    if (vsPitcherSample !== null && vsPitcherSample < 3) {
      warnings.push(`vs_pitcher_small_sample:${vsPitcherSample}`);
      score -= 0.25;
    } else if (vsPitcherSample !== null && vsPitcherSample >= 3) {
      reasons.push(`vs_pitcher_sample_ok:${vsPitcherSample}`);
      score += 0.25;
    }
  }

  if (String(row.tier || "").toLowerCase() === "goblin" && market === "bases" && String(row.side || "").toUpperCase() === "MORE" && Number(row.line) === 0.5) {
    reasons.push("goblin_bases_more_0_5_manual_lane");
    score += 0.5;
  }

  if (market === "hrr" && String(row.side || "").toUpperCase() === "MORE") {
    warnings.push("manual_hrr_more_bucket_has_been_weak");
    score -= 0.5;
  }

  if (market === "hitter_fantasy_score" && String(row.side || "").toUpperCase() === "MORE") {
    reasons.push("hitter_fantasy_more_manual_lane");
    score += 0.25;
  }

  let cls = "WEAK";
  if (score >= 7 && positiveRateSplits >= 4 && avgAboveLineSplits >= 3) cls = "ELITE_MANUAL_SIGNAL";
  else if (score >= 5 && positiveRateSplits >= 3 && avgAboveLineSplits >= 2) cls = "STRONG_MANUAL_SIGNAL";
  else if (score >= 3 && positiveRateSplits >= 2) cls = "GOOD_MANUAL_SIGNAL";
  else if (score >= 1) cls = "WATCH_MANUAL_SIGNAL";

  return {
    score: +score.toFixed(3),
    class: cls,
    reasons,
    warnings,
    positiveRateSplits,
    strongRateSplits,
    avgAboveLineSplits,
    availableRateSplits,
    availableAvgSplits
  };
}

function emptyBucket(key) {
  return {
    key,
    total: 0,
    graded: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    refunds: 0,
    pending: 0,
    hitRate: null
  };
}

function addBucket(bucket, row) {
  const rb = resultBucket(row);
  bucket.total++;

  if (rb === "hit") {
    bucket.graded++;
    bucket.hits++;
  } else if (rb === "miss") {
    bucket.graded++;
    bucket.misses++;
  } else if (rb === "push") {
    bucket.graded++;
    bucket.pushes++;
  } else if (rb === "refund") {
    bucket.refunds++;
  } else {
    bucket.pending++;
  }

  bucket.hitRate = bucket.graded ? +(bucket.hits / bucket.graded).toFixed(4) : null;
}

function summarize(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) map.set(key, emptyBucket(key));
    addBucket(map.get(key), row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || (b.hitRate || 0) - (a.hitRate || 0));
}

const rows = readJson(ledgerFile, []);
const scored = rows.map(row => {
  const signal = scoreManualSignal(row);
  return {
    ...row,
    normalizedMarket: normMarket(row.market),
    manualSignalScore: signal.score,
    manualSignalClass: signal.class,
    manualSignalReasons: signal.reasons,
    manualSignalWarnings: signal.warnings,
    positiveRateSplits: signal.positiveRateSplits,
    strongRateSplits: signal.strongRateSplits,
    avgAboveLineSplits: signal.avgAboveLineSplits,
    availableRateSplits: signal.availableRateSplits,
    availableAvgSplits: signal.availableAvgSplits
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  inputFile: ledgerFile,
  rowCount: scored.length,
  hitterRows: scored.filter(r => isHitterMarket(r.market)).length,
  bySignalClass: summarize(scored, r => r.manualSignalClass),
  byMarketSignalClass: summarize(scored, r => `${r.normalizedMarket} ${r.side} | ${r.manualSignalClass}`),
  rows: scored
};

writeJson(outJson, summary);

const lines = [];
lines.push("MANUAL HITTER SIGNAL REPORT");
lines.push("===========================");
lines.push(`rows: ${summary.rowCount}`);
lines.push(`hitter rows: ${summary.hitterRows}`);
lines.push("");

lines.push("BY SIGNAL CLASS");
lines.push("---------------");
for (const b of summary.bySignalClass) {
  const hr = b.hitRate == null ? "n/a" : `${(b.hitRate * 100).toFixed(2)}%`;
  lines.push(`- ${b.key}: total=${b.total} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} refunds=${b.refunds} pending=${b.pending} hitRate=${hr}`);
}
lines.push("");

lines.push("BY MARKET + SIGNAL CLASS");
lines.push("------------------------");
for (const b of summary.byMarketSignalClass.slice(0, 60)) {
  const hr = b.hitRate == null ? "n/a" : `${(b.hitRate * 100).toFixed(2)}%`;
  lines.push(`- ${b.key}: total=${b.total} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} refunds=${b.refunds} pending=${b.pending} hitRate=${hr}`);
}
lines.push("");

lines.push("TOP MANUAL SIGNAL ROWS");
lines.push("----------------------");
for (const r of scored
  .filter(r => !["NOT_HITTER_SIGNAL", "WEAK"].includes(r.manualSignalClass))
  .sort((a, b) => b.manualSignalScore - a.manualSignalScore)
  .slice(0, 40)
) {
  lines.push(`- ${r.date} | ${r.player} | ${r.normalizedMarket} ${r.side} ${r.line} | ${r.tier} | signal=${r.manualSignalClass} score=${r.manualSignalScore} | result=${r.result} actual=${r.actual ?? "n/a"}`);
  if (r.manualSignalReasons?.length) lines.push(`  reasons: ${r.manualSignalReasons.slice(0, 8).join(", ")}`);
  if (r.manualSignalWarnings?.length) lines.push(`  warnings: ${r.manualSignalWarnings.join(", ")}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${outJson}`);
console.log(`saved: ${outTxt}`);
