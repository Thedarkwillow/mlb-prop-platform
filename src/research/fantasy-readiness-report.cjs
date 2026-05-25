const fs = require("fs");
const path = require("path");

const OUT = "outputs/fantasy-readiness-report.json";
const OUT_TXT = "outputs/fantasy-readiness-report.txt";

const SOURCES = [
  "outputs/fantasy-side-tracking.json",
  "outputs/fantasy-graded.json",
  "outputs/history/2026-05-24-fantasy-grades.json",
  "outputs/fantasy-tracking.json"
];

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

function norm(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return norm(v).toLowerCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resultOf(row) {
  const r = String(row.result ?? row.gradeResult ?? row.status ?? "").toUpperCase();
  if (["HIT", "MISS", "PUSH", "PENDING", "EXCLUDED"].includes(r)) return r;
  return "UNKNOWN";
}

function sideOf(row) {
  return String(row.side ?? row.pickSide ?? row.recommendedSide ?? "").toUpperCase();
}

function tierOf(row) {
  return lower(row.oddsTier ?? row.specialTier ?? row.tier ?? "standard") || "standard";
}

function marketOf(row) {
  const raw = lower(row.market ?? row.statType ?? row.stat ?? row.rawMarket ?? "");
  if (raw.includes("pitcher") && raw.includes("fantasy")) return "pitcher_fantasy_score";
  if (raw.includes("hitter") && raw.includes("fantasy")) return "hitter_fantasy_score";
  if (raw.includes("fantasy")) return "fantasy_score";
  return raw || "unknown";
}

function durationOf(row) {
  const d = lower(row.durationName ?? row.duration ?? row.inningWindow ?? row.window ?? row.period ?? "full_game");

  if (d.includes("1st") || d.includes("1 inning") || d === "1") return "1st_inning";
  if (d.includes("1-3") || d.includes("1+2+3") || d.includes("1 2 3")) return "1-3";
  if (d.includes("1-5") || d.includes("1+2+3+4+5") || d.includes("1 2 3 4 5")) return "1-5";
  if (d.includes("full")) return "full_game";

  return d || "full_game";
}

function lineBucket(row) {
  const line = num(row.line ?? row.ppLine ?? row.projectionLine, null);
  if (line === null) return "line_unknown";
  if (line < 3) return "<3";
  if (line < 5) return "3-4.5";
  if (line < 7) return "5-6.5";
  if (line < 9) return "7-8.5";
  if (line < 11) return "9-10.5";
  if (line < 13) return "11-12.5";
  return "13+";
}

function probBucket(row) {
  const p = num(row.prob ?? row.calibratedDistributionProb ?? row.recommendedProb ?? row.pickProb, null);
  if (p === null) return "prob_unknown";
  if (p < 0.50) return "<50";
  if (p < 0.55) return "50-55";
  if (p < 0.60) return "55-60";
  if (p < 0.65) return "60-65";
  if (p < 0.70) return "65-70";
  return "70+";
}

function edgeBucket(row) {
  const e = num(row.edge ?? row.adjustedEdge ?? row.sportsbookAdjustedEdge ?? row.expectedValue, null);
  if (e === null) return "edge_unknown";
  if (e < 0) return "<0";
  if (e < 0.03) return "0-3%";
  if (e < 0.06) return "3-6%";
  if (e < 0.10) return "6-10%";
  return "10%+";
}

function dateOf(row) {
  return String(row.date ?? row.slateDate ?? row.gameDate ?? row.createdDate ?? "").slice(0, 10);
}

function bucketKey(row) {
  return [
    marketOf(row),
    tierOf(row),
    sideOf(row) || "SIDE_UNKNOWN",
    durationOf(row),
    lineBucket(row),
    probBucket(row),
    edgeBucket(row)
  ].join(" | ");
}

function broadBucketKey(row) {
  return [
    marketOf(row),
    tierOf(row),
    sideOf(row) || "SIDE_UNKNOWN",
    durationOf(row)
  ].join(" | ");
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(resultOf(r)));
  const hits = graded.filter(r => resultOf(r) === "HIT").length;
  const misses = graded.filter(r => resultOf(r) === "MISS").length;
  const pushes = graded.filter(r => resultOf(r) === "PUSH").length;
  const decisions = hits + misses;
  const profit = hits - misses;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    pending: rows.filter(r => resultOf(r) === "PENDING").length,
    excluded: rows.filter(r => resultOf(r) === "EXCLUDED").length,
    unknown: rows.filter(r => resultOf(r) === "UNKNOWN").length,
    hitRate: decisions ? Number((hits / decisions).toFixed(4)) : null,
    roi: decisions ? Number((profit / decisions).toFixed(4)) : null
  };
}

function summarizeByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const d = dateOf(row) || "unknown";
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(row);
  }

  return [...map.entries()]
    .map(([date, dateRows]) => ({ date, ...summarize(dateRows) }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function recentSummary(rows, days) {
  const dated = rows
    .map(r => ({ row: r, date: dateOf(r) }))
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!dated.length) return { window: `${days}d`, available: false };

  const maxDate = dated[dated.length - 1].date;
  const cutoff = new Date(`${maxDate}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const windowRows = dated.filter(x => x.date >= cutoffStr).map(x => x.row);

  return {
    window: `${days}d`,
    startDate: cutoffStr,
    endDate: maxDate,
    available: true,
    ...summarize(windowRows)
  };
}

function classify(summary, recent7, recent15, recent30) {
  const hitRate = summary.hitRate ?? 0;
  const roi = summary.roi ?? -999;

  const hasRecent7 = recent7.available === true;
  const hasRecent15 = recent15.available === true;
  const hasRecent30 = recent30.available === true;

  const r7roi = hasRecent7 ? recent7.roi : null;
  const r15roi = hasRecent15 ? recent15.roi : null;
  const r30roi = hasRecent30 ? recent30.roi : null;

  const positiveWindows =
    hasRecent7 &&
    hasRecent15 &&
    hasRecent30 &&
    r7roi >= 0 &&
    r15roi >= 0 &&
    r30roi >= 0;

  if (summary.graded >= 300 && hitRate >= 0.57 && roi >= 0.10 && positiveWindows) {
    return {
      status: "OFFICIAL_READY",
      reason: "300+ graded, 57%+ hit rate, 10%+ ROI, positive 7/15/30d windows"
    };
  }

  if (summary.graded >= 100 && hitRate >= 0.55 && roi >= 0.08 && hasRecent7 && r7roi >= 0) {
    return {
      status: "ACTIONABLE_LEAN_READY",
      reason: "100+ graded, 55%+ hit rate, 8%+ ROI, positive 7d"
    };
  }

  if (summary.graded >= 100 && hitRate >= 0.55 && roi >= 0.08 && !hasRecent7) {
    return {
      status: "PROVISIONAL_LEAN_READY",
      reason: "strong historical bucket but missing dated 7d validation"
    };
  }

  if (summary.graded >= 50 && roi < -0.05) {
    return {
      status: "SUPPRESS",
      reason: "50+ graded with negative ROI worse than -5%"
    };
  }

  return {
    status: "TRACK_ONLY",
    reason: "insufficient sample or stability for promotion"
  };
}

const allRows = [];
for (const file of SOURCES) {
  const data = readJson(file, []);
  if (Array.isArray(data)) {
    for (const row of data) {
      const market = marketOf(row);
      if (market.includes("fantasy")) allRows.push({ ...row, sourceFile: file });
    }
  }
}

const exactMap = new Map();
const broadMap = new Map();

for (const row of allRows) {
  const exact = bucketKey(row);
  const broad = broadBucketKey(row);

  if (!exactMap.has(exact)) exactMap.set(exact, []);
  if (!broadMap.has(broad)) broadMap.set(broad, []);

  exactMap.get(exact).push(row);
  broadMap.get(broad).push(row);
}

function buildRows(map, level) {
  return [...map.entries()].map(([bucket, rows]) => {
    const summary = summarize(rows);
    const recent7 = recentSummary(rows, 7);
    const recent15 = recentSummary(rows, 15);
    const recent30 = recentSummary(rows, 30);
    const decision = classify(summary, recent7, recent15, recent30);

    return {
      level,
      bucket,
      ...summary,
      recent7,
      recent15,
      recent30,
      byDate: summarizeByDate(rows),
      promotionStatus: decision.status,
      promotionReason: decision.reason
    };
  }).sort((a, b) =>
    (b.promotionStatus === "OFFICIAL_READY") - (a.promotionStatus === "OFFICIAL_READY") ||
    (b.promotionStatus === "ACTIONABLE_LEAN_READY") - (a.promotionStatus === "ACTIONABLE_LEAN_READY") ||
    (b.roi ?? -999) - (a.roi ?? -999) ||
    b.graded - a.graded
  );
}

const exactBuckets = buildRows(exactMap, "exact");
const broadBuckets = buildRows(broadMap, "broad");

const report = {
  generatedAt: new Date().toISOString(),
  sources: SOURCES,
  totalFantasyRows: allRows.length,
  overall: summarize(allRows),
  byMarket: buildRows(new Map([
    ["hitter_fantasy_score", allRows.filter(r => marketOf(r) === "hitter_fantasy_score")],
    ["pitcher_fantasy_score", allRows.filter(r => marketOf(r) === "pitcher_fantasy_score")]
  ]), "market"),
  broadBuckets,
  exactBuckets,
  promoted: {
    officialReady: exactBuckets.filter(r => r.promotionStatus === "OFFICIAL_READY"),
    actionableLeanReady: exactBuckets.filter(r => r.promotionStatus === "ACTIONABLE_LEAN_READY"),\n    provisionalLeanReady: exactBuckets.filter(r => r.promotionStatus === "PROVISIONAL_LEAN_READY")
  },
  componentValidationRequired: {
    hitterFantasy: [
      "singles",
      "doubles_triples",
      "home_runs",
      "runs",
      "rbis",
      "walks",
      "hit_by_pitch",
      "stolen_bases"
    ],
    pitcherFantasy: [
      "strikeouts",
      "pitching_outs",
      "earned_runs",
      "win_probability",
      "quality_start_probability"
    ]
  }
};

writeJson(OUT, report);

const lines = [];
lines.push("FANTASY READINESS REPORT");
lines.push("========================");
lines.push(`generatedAt: ${report.generatedAt}`);
lines.push(`rows: ${report.totalFantasyRows}`);
lines.push("");
lines.push("OVERALL");
lines.push(JSON.stringify(report.overall, null, 2));
lines.push("");
lines.push("BROAD BUCKETS TOP 25");
for (const r of broadBuckets.slice(0, 25)) {
  lines.push(`${r.promotionStatus} | ${r.bucket} | graded=${r.graded} | hitRate=${r.hitRate} | roi=${r.roi} | ${r.promotionReason}`);
}
lines.push("");
lines.push("EXACT BUCKETS TOP 25");
for (const r of exactBuckets.slice(0, 25)) {
  lines.push(`${r.promotionStatus} | ${r.bucket} | graded=${r.graded} | hitRate=${r.hitRate} | roi=${r.roi} | ${r.promotionReason}`);
}
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log("");
console.log("saved:", OUT);
console.log("saved:", OUT_TXT);
