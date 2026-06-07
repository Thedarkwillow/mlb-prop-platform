const fs = require("fs");

function getDate() {
  const arg = process.argv.find(x => /^--date=/.test(x));
  if (arg) return arg.replace(/^--date=/, "");
  const bare = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (bare) return bare;
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();
const OUT = `outputs/history/${DATE}-lane-promotion-review.json`;
const TXT = `outputs/history/${DATE}-lane-promotion-review.txt`;

const FILES = {
  standardHitterBridge: `outputs/history/${DATE}-standard-hitter-bridge-watchlist-graded.json`,
  lessBatterWatchlist: `outputs/history/${DATE}-less-batter-watchlist-graded.json`,
  goblinHrrControlled: `outputs/history/${DATE}-goblin-hrr-controlled-suppression.json`,
  rookiePitcherRisk: `outputs/rookie-pitcher-risk-audit.json`,
  fullBoard: `outputs/history/${DATE}-full-board-graded.json`,
  hrr: `outputs/history/${DATE}-hrr-graded.json`,
  pitcherActuals: `outputs/history/${DATE}-pitcher-actuals.json`
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function pct(v) {
  return v === null || v === undefined ? "?" : `${(Number(v) * 100).toFixed(2)}%`;
}

function bucketStatus(summary, rules = {}) {
  const hitRate = summary?.hitRate;
  const graded = summary?.graded || 0;
  const unmatched = summary?.unmatched || 0;

  if (!summary) return { decision: "MISSING", reasons: ["missing_summary"] };
  if (graded < (rules.minSample || 20)) {
    return { decision: "RESEARCH_ONLY", reasons: [`sample_below_${rules.minSample || 20}`] };
  }
  if (unmatched > 0 && rules.requireNoUnmatched) {
    return { decision: "RESEARCH_ONLY", reasons: ["unmatched_rows_remain"] };
  }
  if (hitRate >= (rules.promoteAt || 0.60)) {
    return { decision: "PROMOTION_REVIEW", reasons: [`hit_rate_at_or_above_${rules.promoteAt || 0.60}`] };
  }
  if (hitRate <= (rules.suppressAt || 0.48)) {
    return { decision: "SUPPRESS", reasons: [`hit_rate_at_or_below_${rules.suppressAt || 0.48}`] };
  }
  return { decision: "WATCH", reasons: ["middle_band_needs_more_slates"] };
}

function summarizeWatchlist(name, file, rules) {
  const data = readJson(file);
  const summary = data?.results || null;
  const status = bucketStatus(summary, rules);
  return {
    lane: name,
    file,
    exists: !!data,
    decision: status.decision,
    reasons: status.reasons,
    summary,
    byStatus: data?.byStatus || null,
    byType: data?.byType || null,
    byMarket: data?.byMarket || null,
    notes: []
  };
}

function summarizeGoblinHrr(file) {
  const data = readJson(file);
  const status = data?.status || "MISSING";
  return {
    lane: "goblin_hrr_controlled",
    file,
    exists: !!data,
    decision: status === "SUPPRESS_GOBLIN_HRR_CONTROLLED" ? "SUPPRESS" : "WATCH",
    reasons: data?.reasons || ["missing_suppression_file"],
    summary: data?.summary || null,
    notes: [
      "This lane is only eligible if HRR anchors and full-slip performance both clear thresholds.",
      "Pitcher ER filler grading is now fixed, so suppressions here are performance-based, not missing-data-based."
    ]
  };
}

function summarizeRookiePitcher(file) {
  const data = readJson(file);
  const hardBlocks = data?.totals?.hardBlocks ?? null;
  const officialBlocks = data?.totals?.officialPlayableHardBlocks ?? null;
  const status = hardBlocks === null ? "MISSING" : "KEEP_GUARD_ACTIVE";
  return {
    lane: "rookie_debut_pitcher_risk",
    file,
    exists: !!data,
    decision: status,
    reasons: data ? [
      "protects_against_extreme_probabilities_with_missing_or_low_mlb_pitcher_sample",
      "keep_active_until_sample_status_is_carried_canonically_into_final_slip_logic"
    ] : ["missing_rookie_pitcher_audit"],
    summary: data?.totals || null,
    notes: [
      "This is a safety guard, not a promotion lane.",
      "A rookie/debut pitcher with strong probability should stay capped/research-only unless sample/context is trusted."
    ]
  };
}

const standard = summarizeWatchlist("standard_hitter_bridge_watchlist", FILES.standardHitterBridge, {
  minSample: 25,
  promoteAt: 0.60,
  suppressAt: 0.48,
  requireNoUnmatched: false
});

const less = summarizeWatchlist("less_batter_watchlist", FILES.lessBatterWatchlist, {
  minSample: 25,
  promoteAt: 0.60,
  suppressAt: 0.48,
  requireNoUnmatched: false
});

const goblin = summarizeGoblinHrr(FILES.goblinHrrControlled);
const rookie = summarizeRookiePitcher(FILES.rookiePitcherRisk);

const lanes = [standard, less, goblin, rookie];

const payload = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  mode: "lane_promotion_suppression_review",
  rules: {
    watchlistMinSample: 25,
    promoteAtHitRate: 0.60,
    suppressAtHitRate: 0.48,
    note: "One slate is not enough for automatic promotion. PROMOTION_REVIEW means keep tracking and consider controlled exposure only after multiple slates confirm."
  },
  sourceFiles: FILES,
  lanes,
  finalRecommendations: lanes.map(x => ({
    lane: x.lane,
    decision: x.decision,
    reasons: x.reasons
  }))
};

fs.mkdirSync("outputs/history", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

const lines = [];
lines.push("LANE PROMOTION / SUPPRESSION REVIEW");
lines.push("===================================");
lines.push(`date=${DATE}`);
lines.push("");

for (const lane of lanes) {
  lines.push(`${lane.lane}`);
  lines.push("-".repeat(lane.lane.length));
  lines.push(`decision=${lane.decision}`);
  lines.push(`reasons=${lane.reasons.join(", ")}`);
  if (lane.summary) {
    if (lane.summary.hitRate !== undefined) {
      lines.push(`summary=${lane.summary.hit || 0}/${lane.summary.graded || 0} = ${pct(lane.summary.hitRate)} | unmatched=${lane.summary.unmatched || 0}`);
    } else {
      lines.push(`summary=${JSON.stringify(lane.summary)}`);
    }
  } else {
    lines.push("summary=missing");
  }
  if (lane.byStatus) lines.push(`byStatus=${JSON.stringify(lane.byStatus)}`);
  if (lane.byType) lines.push(`byType=${JSON.stringify(lane.byType)}`);
  if (lane.byMarket) lines.push(`byMarket=${JSON.stringify(lane.byMarket)}`);
  if (lane.notes?.length) {
    lines.push("notes:");
    for (const n of lane.notes) lines.push(`- ${n}`);
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
  date: DATE,
  recommendations: payload.finalRecommendations
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
