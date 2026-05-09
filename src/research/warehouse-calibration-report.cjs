const fs = require("fs");

const WAREHOUSE = "data/results/prop-warehouse.json";
const OUT = "outputs/warehouse-calibration-report.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(x) {
  if (!Number.isFinite(Number(x))) return "n/a";
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function bucketProb(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  const low = Math.floor(p * 20) / 20;
  return `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
}

function group(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }

  return [...m.entries()].map(([bucket, arr]) => {
    const graded = arr.filter(x => ["HIT", "MISS"].includes(x.result));
    const hits = graded.filter(x => x.result === "HIT").length;
    const avgProb = graded.reduce((a, x) => a + Number(x.probability || 0), 0) / Math.max(1, graded.length);
    const actualHitRate = graded.length ? hits / graded.length : 0;
    return {
      bucket,
      count: graded.length,
      avgProb: Number(avgProb.toFixed(4)),
      predicted: pct(avgProb),
      actualHitRate: Number(actualHitRate.toFixed(4)),
      actual: pct(actualHitRate),
      error: pct(Math.abs(avgProb - actualHitRate)),
      hits,
      misses: graded.length - hits
    };
  }).filter(x => x.count > 0);
}

const rows = read(WAREHOUSE, []).filter(r =>
  ["HIT", "MISS"].includes(r.result) &&
  Number.isFinite(Number(r.probability))
);

const byProb = group(rows, r => bucketProb(r.probability));
const byMarket = group(rows, r => `${r.market || "unknown"} ${r.side || ""}`.trim());
const byBooks = group(rows, r => {
  const b = Number(r.books || 0);
  if (b >= 4) return "4+ books";
  if (b === 3) return "3 books";
  if (b === 2) return "2 books";
  return "0-1 books";
});

const report = {
  createdAt: new Date().toISOString(),
  source: WAREHOUSE,
  gradedRows: rows.length,
  byProb,
  byMarket,
  byBooks
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log("WAREHOUSE CALIBRATION REPORT");
console.log(`graded rows: ${rows.length}`);
console.log("BY PROBABILITY");
console.table(byProb);
console.log("BY MARKET");
console.table(byMarket);
console.log("BY BOOK SUPPORT");
console.table(byBooks);
console.log(`Wrote ${OUT}`);
