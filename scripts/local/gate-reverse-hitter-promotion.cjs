const fs = require("fs");
const path = require("path");

const HIST = "outputs/history";
const OUT = "outputs/reverse-hitter-promotion-gate.json";
const TXT = "outputs/reverse-hitter-promotion-gate.txt";

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
function add(a, b) {
  for (const k of ["total", "hit", "miss", "push", "refund", "unmatched", "graded"]) {
    a[k] += Number(b?.[k] || 0);
  }
  return finalize(a);
}
function finalize(b) {
  b.hitRate = b.graded ? Number((b.hit / b.graded).toFixed(4)) : null;
  return b;
}
function pct(v) {
  return v === null || v === undefined ? "?" : `${(Number(v) * 100).toFixed(2)}%`;
}

const files = walk(HIST)
  .filter(f => /reverse-hitter-signal-graded\.json$/.test(f))
  .sort();

const daily = [];
const total = emptyBucket();
const bySignal = {};
const byMarket = {};

for (const file of files) {
  const data = readJson(file, null);
  if (!data || data.error) continue;

  const date = data.date || dateFromFile(file);
  const results = data.results || emptyBucket();

  daily.push({
    date,
    file,
    results,
    bySignal: data.bySignal || {},
    byMarket: data.byMarket || {}
  });

  add(total, results);

  for (const [k, b] of Object.entries(data.bySignal || {})) {
    bySignal[k] ||= emptyBucket();
    add(bySignal[k], b);
  }

  for (const [k, b] of Object.entries(data.byMarket || {})) {
    byMarket[k] ||= emptyBucket();
    add(byMarket[k], b);
  }
}

const thresholds = {
  minSampleForPromotionReview: 50,
  minHitRateForPromotionReview: 0.58,
  maxUnmatchedRateForPromotionReview: 0.10,
  minSampleForSuppression: 50,
  suppressBelowHitRate: 0.52
};

const unmatchedRate = total.total ? Number((total.unmatched / total.total).toFixed(4)) : null;
const reasons = [];
let status = "RESEARCH_ONLY";

if (total.graded < thresholds.minSampleForPromotionReview) {
  reasons.push("sample_below_50");
}
if (total.graded >= thresholds.minSampleForSuppression && total.hitRate !== null && total.hitRate < thresholds.suppressBelowHitRate) {
  status = "SUPPRESS";
  reasons.push("rolling_hit_rate_below_52_percent");
}
if (unmatchedRate !== null && unmatchedRate > thresholds.maxUnmatchedRateForPromotionReview) {
  reasons.push("unmatched_rate_above_10_percent");
}

if (
  total.graded >= thresholds.minSampleForPromotionReview &&
  total.hitRate >= thresholds.minHitRateForPromotionReview &&
  unmatchedRate <= thresholds.maxUnmatchedRateForPromotionReview
) {
  status = "PROMOTION_REVIEW";
  reasons.push("rolling_sample_and_hit_rate_clear_promotion_review_thresholds");
}

if (!reasons.length) reasons.push("insufficient_evidence_for_promotion");

const review = {
  generatedAt: new Date().toISOString(),
  lane: "reverse_hitter_signal",
  status,
  reasons,
  thresholds,
  daily,
  summary: {
    total,
    unmatchedRate,
    bySignal,
    byMarket
  },
  rule: "Reverse hitter signal cannot create official plays directly. It becomes candidate-eligible only after this rolling gate reaches PROMOTION_REVIEW and final-slip risk gates also pass."
};

const lines = [];
lines.push("REVERSE HITTER PROMOTION GATE");
lines.push("=============================");
lines.push(`status=${status}`);
lines.push(`reasons=${reasons.join(", ")}`);
lines.push(`dates=${daily.map(x => x.date).filter(Boolean).join(", ") || "none"}`);
lines.push(`all=${total.hit}/${total.graded} = ${pct(total.hitRate)} | total=${total.total} unmatched=${total.unmatched} unmatchedRate=${pct(unmatchedRate)}`);
lines.push("");
lines.push("BY SIGNAL");
lines.push("---------");
for (const [k, b] of Object.entries(bySignal)) {
  lines.push(`${k}: ${b.hit}/${b.graded} = ${pct(b.hitRate)} | total=${b.total} unmatched=${b.unmatched}`);
}
lines.push("");
lines.push("BY MARKET");
lines.push("---------");
for (const [k, b] of Object.entries(byMarket)) {
  lines.push(`${k}: ${b.hit}/${b.graded} = ${pct(b.hitRate)} | total=${b.total} unmatched=${b.unmatched}`);
}
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push(review.rule);

fs.writeFileSync(OUT, JSON.stringify(review, null, 2));
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: review.generatedAt,
  lane: review.lane,
  status: review.status,
  reasons: review.reasons,
  summary: review.summary.total,
  unmatchedRate
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
