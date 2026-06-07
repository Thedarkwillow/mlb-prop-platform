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
const REPAIRED = `outputs/history/${DATE}-goblin-hrr-controlled-repaired.json`;
const GUARD = `outputs/history/${DATE}-goblin-hrr-controlled-official-guard.json`;
const OUT = `outputs/history/${DATE}-goblin-hrr-controlled-suppression.json`;
const TXT = `outputs/history/${DATE}-goblin-hrr-controlled-suppression.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function pct(v) {
  return v === null || v === undefined ? "?" : `${(Number(v) * 100).toFixed(2)}%`;
}

fs.mkdirSync("outputs/history", { recursive: true });

const repaired = readJson(REPAIRED, null);
const guard = readJson(GUARD, null);

const hrr = repaired?.summary?.byMarket?.hrr || {};
const er = repaired?.summary?.byMarket?.earned_runs_allowed || {};
const slips = repaired?.summary?.slips || {};
const legs = repaired?.summary?.legs || {};

const reasons = [];

if (!repaired) reasons.push("missing_repaired_grade_file");
if (!guard) reasons.push("missing_official_guard_file");

if ((hrr.graded || 0) < 25) reasons.push("insufficient_hrr_anchor_sample");
if (hrr.hitRate === null || hrr.hitRate === undefined || hrr.hitRate < 0.58) {
  reasons.push("hrr_anchor_hit_rate_below_58_percent");
}
if ((slips.graded || 0) < 10) reasons.push("insufficient_full_slip_sample");
if (slips.hitRate === null || slips.hitRate === undefined || slips.hitRate < 0.20) {
  reasons.push("full_slip_hit_rate_below_profitability_floor");
}
if ((er.total || 0) > 0 && (er.unmatched || 0) > 0) reasons.push("pitcher_filler_unmatched");
if ((legs.unmatched || 0) > 0) reasons.push("unmatched_legs_remain");

const status = reasons.length ? "SUPPRESS_GOBLIN_HRR_CONTROLLED" : "ELIGIBLE_FOR_RESEARCH_PROMOTION_REVIEW";

const payload = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  lane: "goblin_hrr_controlled",
  status,
  reasons,
  thresholds: {
    minHrrAnchorSample: 25,
    minHrrAnchorHitRate: 0.58,
    minFullSlipSample: 10,
    minFullSlipHitRate: 0.20,
    requireNoUnmatchedPitcherFiller: true
  },
  sourceFiles: {
    repaired: REPAIRED,
    guard: GUARD
  },
  summary: {
    hrrAnchors: hrr,
    pitcherEarnedRunsFiller: er,
    allLegs: legs,
    fullSlips: slips
  }
};

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

const lines = [];
lines.push("GOBLIN HRR CONTROLLED SUPPRESSION");
lines.push("=================================");
lines.push(`date=${DATE}`);
lines.push(`status=${status}`);
lines.push(`reasons=${reasons.length ? reasons.join(", ") : "none"}`);
lines.push("");
lines.push("SUMMARY");
lines.push("-------");
lines.push(`HRR anchors: ${hrr.hit || 0}/${hrr.graded || 0} = ${pct(hrr.hitRate)}`);
lines.push(`Pitcher ER filler: ${er.hit || 0}/${er.graded || 0} = ${pct(er.hitRate)} unmatched=${er.unmatched || 0}`);
lines.push(`All legs: ${legs.hit || 0}/${legs.graded || 0} = ${pct(legs.hitRate)} unmatched=${legs.unmatched || 0}`);
lines.push(`Full slips: ${slips.hit || 0}/${slips.graded || 0} = ${pct(slips.hitRate)} unmatched=${slips.unmatched || 0}`);
lines.push("");
lines.push(JSON.stringify(payload, null, 2));

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(payload);
