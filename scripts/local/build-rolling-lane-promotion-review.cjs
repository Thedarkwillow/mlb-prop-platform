const fs = require("fs");
const path = require("path");

const HIST = "outputs/history";
const OUT = "outputs/rolling-lane-promotion-review.json";
const TXT = "outputs/rolling-lane-promotion-review.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function dateFromFile(file) {
  const m = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
}
function emptyBucket() {
  return { total: 0, hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0, graded: 0, hitRate: null };
}
function addBucket(a, b) {
  for (const k of ["total", "hit", "miss", "push", "refund", "unmatched", "graded"]) {
    a[k] += Number(b?.[k] || 0);
  }
  a.hitRate = a.graded ? Number((a.hit / a.graded).toFixed(4)) : null;
  return a;
}
function pct(v) {
  return v === null || v === undefined ? "?" : `${(Number(v) * 100).toFixed(2)}%`;
}
function uniqueDates(files) {
  return [...new Set(files.map(dateFromFile).filter(Boolean))].sort();
}
function lastNDates(dates, n) {
  return dates.slice(Math.max(0, dates.length - n));
}
function decisionFor(bucket, opts = {}) {
  const minSample = opts.minSample || 50;
  const promoteAt = opts.promoteAt || 0.60;
  const suppressAt = opts.suppressAt || 0.48;

  if (!bucket || bucket.graded < minSample) {
    return { decision: "RESEARCH_ONLY", reasons: [`sample_below_${minSample}`] };
  }
  if (bucket.hitRate >= promoteAt) {
    return { decision: "PROMOTION_REVIEW", reasons: [`hit_rate_at_or_above_${promoteAt}`] };
  }
  if (bucket.hitRate <= suppressAt) {
    return { decision: "SUPPRESS", reasons: [`hit_rate_at_or_below_${suppressAt}`] };
  }
  return { decision: "WATCH", reasons: ["middle_band_needs_more_data"] };
}

function collectWatchlist(pattern, laneName) {
  const files = walk(HIST).filter(f => pattern.test(path.basename(f))).sort();
  const dates = uniqueDates(files);
  const rows = [];

  for (const file of files) {
    const date = dateFromFile(file);
    const data = readJson(file, {});
    rows.push({
      date,
      file,
      results: data.results || emptyBucket(),
      byStatus: data.byStatus || {},
      byType: data.byType || {},
      byMarket: data.byMarket || {}
    });
  }

  function summarizeForDates(dateSet) {
    const bucket = emptyBucket();
    const byStatus = {};
    const byType = {};
    const byMarket = {};

    for (const r of rows.filter(x => dateSet.includes(x.date))) {
      addBucket(bucket, r.results);

      for (const [k, v] of Object.entries(r.byStatus || {})) {
        byStatus[k] ||= emptyBucket();
        addBucket(byStatus[k], v);
      }
      for (const [k, v] of Object.entries(r.byType || {})) {
        byType[k] ||= emptyBucket();
        addBucket(byType[k], v);
      }
      for (const [k, v] of Object.entries(r.byMarket || {})) {
        byMarket[k] ||= emptyBucket();
        addBucket(byMarket[k], v);
      }
    }

    return { bucket, byStatus, byType, byMarket };
  }

  const windows = {
    last3: summarizeForDates(lastNDates(dates, 3)),
    last7: summarizeForDates(lastNDates(dates, 7)),
    all: summarizeForDates(dates)
  };

  const final = decisionFor(windows.all.bucket, { minSample: 50, promoteAt: 0.60, suppressAt: 0.48 });

  return {
    lane: laneName,
    files,
    dates,
    windows,
    decision: final.decision,
    reasons: final.reasons
  };
}

function collectGoblinHrrControlled() {
  const files = walk(HIST).filter(f => /goblin-hrr-controlled-suppression\.json$/.test(path.basename(f))).sort();
  const dates = uniqueDates(files);
  const agg = {
    hrrAnchors: emptyBucket(),
    pitcherEarnedRunsFiller: emptyBucket(),
    allLegs: emptyBucket(),
    fullSlips: emptyBucket()
  };

  const rows = [];
  for (const file of files) {
    const date = dateFromFile(file);
    const data = readJson(file, {});
    rows.push({ date, file, status: data.status, reasons: data.reasons || [], summary: data.summary || {} });

    for (const k of Object.keys(agg)) {
      addBucket(agg[k], data.summary?.[k]);
    }
  }

  const suppressReasons = [];
  if ((agg.hrrAnchors.graded || 0) >= 25 && (agg.hrrAnchors.hitRate || 0) < 0.58) {
    suppressReasons.push("rolling_hrr_anchor_hit_rate_below_58_percent");
  }
  if ((agg.fullSlips.graded || 0) >= 10 && (agg.fullSlips.hitRate || 0) < 0.20) {
    suppressReasons.push("rolling_full_slip_hit_rate_below_profitability_floor");
  }
  if ((agg.pitcherEarnedRunsFiller.unmatched || 0) > 0) {
    suppressReasons.push("pitcher_filler_unmatched_rows_remain");
  }

  return {
    lane: "goblin_hrr_controlled",
    files,
    dates,
    summary: agg,
    decision: suppressReasons.length ? "SUPPRESS" : "WATCH",
    reasons: suppressReasons.length ? suppressReasons : ["needs_more_confirming_slates"]
  };
}

const standard = collectWatchlist(/standard-hitter-bridge-watchlist-graded\.json$/, "standard_hitter_bridge_watchlist");
const less = collectWatchlist(/less-batter-watchlist-graded\.json$/, "less_batter_watchlist");
const goblin = collectGoblinHrrControlled();

const payload = {
  generatedAt: new Date().toISOString(),
  mode: "rolling_lane_promotion_review",
  rules: {
    watchlistMinSample: 50,
    promoteAtHitRate: 0.60,
    suppressAtHitRate: 0.48,
    goblinHrrAnchorMinHitRate: 0.58,
    goblinFullSlipMinHitRate: 0.20
  },
  lanes: [standard, less, goblin],
  finalRecommendations: [standard, less, goblin].map(x => ({
    lane: x.lane,
    decision: x.decision,
    reasons: x.reasons,
    dates: x.dates
  }))
};

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

const lines = [];
lines.push("ROLLING LANE PROMOTION REVIEW");
lines.push("=============================");
lines.push(`generatedAt=${payload.generatedAt}`);
lines.push("");

for (const lane of payload.lanes) {
  lines.push(lane.lane);
  lines.push("-".repeat(lane.lane.length));
  lines.push(`decision=${lane.decision}`);
  lines.push(`reasons=${lane.reasons.join(", ")}`);
  lines.push(`dates=${lane.dates.join(", ") || "none"}`);

  if (lane.windows) {
    for (const [win, val] of Object.entries(lane.windows)) {
      const b = val.bucket;
      lines.push(`${win}: ${b.hit}/${b.graded} = ${pct(b.hitRate)} | total=${b.total} unmatched=${b.unmatched}`);
    }
    lines.push(`byMarket_all=${JSON.stringify(lane.windows.all.byMarket)}`);
    lines.push(`byStatus_all=${JSON.stringify(lane.windows.all.byStatus)}`);
    if (Object.keys(lane.windows.all.byType || {}).length) {
      lines.push(`byType_all=${JSON.stringify(lane.windows.all.byType)}`);
    }
  } else if (lane.summary) {
    lines.push(`HRR anchors: ${lane.summary.hrrAnchors.hit}/${lane.summary.hrrAnchors.graded} = ${pct(lane.summary.hrrAnchors.hitRate)}`);
    lines.push(`Pitcher ER filler: ${lane.summary.pitcherEarnedRunsFiller.hit}/${lane.summary.pitcherEarnedRunsFiller.graded} = ${pct(lane.summary.pitcherEarnedRunsFiller.hitRate)} unmatched=${lane.summary.pitcherEarnedRunsFiller.unmatched}`);
    lines.push(`All legs: ${lane.summary.allLegs.hit}/${lane.summary.allLegs.graded} = ${pct(lane.summary.allLegs.hitRate)}`);
    lines.push(`Full slips: ${lane.summary.fullSlips.hit}/${lane.summary.fullSlips.graded} = ${pct(lane.summary.fullSlips.hitRate)}`);
  }

  lines.push("");
}

lines.push("FINAL RECOMMENDATIONS");
lines.push("---------------------");
for (const r of payload.finalRecommendations) {
  lines.push(`${r.lane}: ${r.decision} — ${r.reasons.join(", ")}`);
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: payload.generatedAt,
  recommendations: payload.finalRecommendations
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
