import fs from "fs";

const IN = "outputs/warehouse-calibration-report.json";
const OUT = "data/learning/book-support-trust.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeBucket(bucket) {
  return String(bucket || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace("+", "_plus")
    .trim();
}

function classify(row) {
  const count = Number(row.count || 0);
  const predicted = Number(row.avgProb ?? row.predicted ?? 0);
  const actual = Number(row.actualHitRate ?? row.actual ?? 0);
  const edge = actual - predicted;

  if (count < 10) return { trust: "unknown", adjustment: 0, suppressed: false, reason: "sample_too_small" };
  if (count >= 20 && edge <= -0.20) return { trust: "weak", adjustment: -0.04, suppressed: false, reason: "overconfident_book_bucket" };
  if (count >= 15 && edge <= -0.10) return { trust: "soft_weak", adjustment: -0.02, suppressed: false, reason: "mild_overconfidence" };
  if (count >= 20 && edge >= 0.08) return { trust: "strong", adjustment: 0.015, suppressed: false, reason: "book_bucket_outperforming" };
  return { trust: "neutral", adjustment: 0, suppressed: false, reason: "neutral" };
}

const report = read(IN, {});
const byBooks = report.byBookSupport || report.byBooks || report.books || [];

const out = {
  generatedAt: new Date().toISOString(),
  source: IN,
  byBookBucket: {}
};

for (const row of byBooks) {
  const bucket = row.bucket || row.bookSupport || row.books;
  if (!bucket) continue;

  const key = normalizeBucket(bucket);
  const count = Number(row.count || 0);
  const predicted = Number(row.avgProb ?? row.predicted ?? 0);
  const actual = Number(row.actualHitRate ?? row.actual ?? 0);
  const edge = actual - predicted;
  const cls = classify(row);

  out.byBookBucket[key] = {
    bucket,
    count,
    predicted: Number(predicted.toFixed(4)),
    actual: Number(actual.toFixed(4)),
    edge: Number(edge.toFixed(4)),
    ...cls
  };
}

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log(`Book support trust written: ${OUT}`);
console.table(Object.entries(out.byBookBucket).map(([key, v]) => ({
  key,
  count: v.count,
  predicted: v.predicted,
  actual: v.actual,
  edge: v.edge,
  trust: v.trust,
  adjustment: v.adjustment,
  reason: v.reason
})));
