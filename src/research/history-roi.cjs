const fs = require("fs");

const FILE = "data/results/graded-leg-history.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()].map(([bucket, xs]) => {
    const units = xs.reduce((a, x) => a + Number(x.unitResult || 0), 0);
    return {
      bucket,
      count: xs.length,
      hits: xs.filter(x => x.result === "HIT").length,
      misses: xs.filter(x => x.result === "MISS").length,
      pushes: xs.filter(x => x.result === "PUSH").length,
      roi: Number((units / xs.length).toFixed(4))
    };
  }).sort((a,b) => b.count - a.count);
}

function probBucket(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  return `${Math.floor(p * 20) / 20}-${Math.floor(p * 20) / 20 + 0.05}`;
}

function bookBucket(b) {
  b = Number(b);
  if (!Number.isFinite(b)) return "unknown";
  if (b >= 4) return "4+ books";
  return `${b} books`;
}

const rows = read(FILE, []);

console.log("HISTORICAL ROI REPORT");
console.log("graded legs:", rows.length);

console.log("\nBY MARKET");
console.table(group(rows, r => r.market));

console.log("\nBY PROBABILITY BUCKET");
console.table(group(rows, r => probBucket(r.probability)));

console.log("\nBY BOOK SUPPORT");
console.table(group(rows, r => bookBucket(r.books)));

console.log("\nBY SLIP SIZE");
console.table(group(rows, r => `${r.slipSize}-leg`));
