const fs = require("fs");
const path = require("path");

const IN = "outputs/manual/manual-model-compare.json";
const OUT_JSON = "outputs/manual/protected-bucket-tracker.json";
const OUT_TXT = "outputs/manual/protected-bucket-tracker.txt";

const PROTECTED_BUCKETS = [
  {
    id: "GOBLIN_BASES_MORE_MODEL_LEAN",
    modelClass: "MODEL_LEAN",
    market: "bases",
    side: "MORE",
    tier: "goblin",
    minLeanSample: 20,
    leanSupportHitRate: 70,
    promotionReviewHitRate: 75
  },
  {
    id: "GOBLIN_STRIKEOUTS_MORE_MODEL_MISSING_WATCH",
    modelClass: "MODEL_MISSING",
    market: "strikeouts",
    side: "MORE",
    tier: "goblin",
    minLeanSample: 20,
    leanSupportHitRate: 70,
    promotionReviewHitRate: 75
  }
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function extractRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.manualRows)) return raw.manualRows;
  if (Array.isArray(raw.comparisons)) return raw.comparisons;
  if (Array.isArray(raw.results)) return raw.results;
  return flatten(raw).filter(r =>
    (r.player || r.playerName) &&
    r.market &&
    r.side &&
    r.line !== undefined &&
    r.result
  );
}

function sameBucket(row, bucket) {
  return String(row.modelClass || "") === bucket.modelClass &&
    String(row.market || "").toLowerCase() === bucket.market &&
    String(row.side || "").toUpperCase() === bucket.side &&
    String(row.tier || "").toLowerCase() === bucket.tier;
}

function pct(hits, graded) {
  if (!graded) return null;
  return Number(((hits / graded) * 100).toFixed(2));
}

function statusFor(bucket, graded, hitRate) {
  if (graded < bucket.minLeanSample) return "TRACK_ONLY_SAMPLE_TOO_SMALL";
  if (hitRate >= bucket.promotionReviewHitRate) return "PROMOTION_REVIEW_NOT_AUTO_OFFICIAL";
  if (hitRate >= bucket.leanSupportHitRate) return "LEAN_SUPPORT_ALLOWED_NOT_OFFICIAL";
  return "FAILED_PROTECTED_BUCKET_THRESHOLD";
}

const raw = readJson(IN, null);
if (!raw) throw new Error(`Missing ${IN}. Run npm run manual first.`);

const rows = extractRows(raw);
const reports = [];

for (const bucket of PROTECTED_BUCKETS) {
  const bucketRows = rows.filter(r => sameBucket(r, bucket));
  const gradedRows = bucketRows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));

  const hits = gradedRows.filter(r => String(r.result || "").toUpperCase() === "HIT").length;
  const misses = gradedRows.filter(r => String(r.result || "").toUpperCase() === "MISS").length;
  const pushes = gradedRows.filter(r => String(r.result || "").toUpperCase() === "PUSH").length;
  const hitRate = pct(hits, gradedRows.length);

  reports.push({
    id: bucket.id,
    modelClass: bucket.modelClass,
    market: bucket.market,
    side: bucket.side,
    tier: bucket.tier,
    totalRows: bucketRows.length,
    graded: gradedRows.length,
    hits,
    misses,
    pushes,
    hitRate,
    status: statusFor(bucket, gradedRows.length, hitRate ?? 0),
    rule: {
      minLeanSample: bucket.minLeanSample,
      leanSupportHitRate: bucket.leanSupportHitRate,
      promotionReviewHitRate: bucket.promotionReviewHitRate,
      officialPromotion: "disabled"
    },
    rows: bucketRows.map(r => ({
      date: r.date || null,
      player: r.player || r.playerName || null,
      market: r.market || null,
      side: r.side || null,
      line: r.line ?? null,
      tier: r.tier || null,
      result: r.result || null,
      actual: r.actual ?? null,
      modelClass: r.modelClass || null
    }))
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  source: IN,
  mode: "TRACK_ONLY_NO_OFFICIAL_PROMOTION",
  reports
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + "\n");

const lines = [];
lines.push("PROTECTED BUCKET TRACKER");
lines.push("========================");
lines.push("mode: TRACK_ONLY_NO_OFFICIAL_PROMOTION");
lines.push("");
for (const r of reports) {
  lines.push(r.id);
  lines.push("-".repeat(r.id.length));
  lines.push(`bucket: ${r.modelClass} | ${r.market} | ${r.side} | ${r.tier}`);
  lines.push(`record: ${r.hits}-${r.misses}-${r.pushes}`);
  lines.push(`graded: ${r.graded}`);
  lines.push(`hitRate: ${r.hitRate === null ? "n/a" : `${r.hitRate}%`}`);
  lines.push(`status: ${r.status}`);
  lines.push("");
}

fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log("saved:", OUT_JSON);
console.log("saved:", OUT_TXT);
