const fs = require("fs");

const HISTORY = "data/results/graded-leg-history.json";

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

function roi(rows) {
  if (!rows.length) return 0;
  return rows.reduce((a, x) => a + Number(x.unitResult || 0), 0) / rows.length;
}

function hitRate(rows) {
  if (!rows.length) return 0;
  return rows.filter(x => x.result === "HIT").length / rows.length;
}

function probBucket(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  const low = Math.floor(p * 20) / 20;
  return `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
}

function edgeBucket(e) {
  e = Number(e);
  if (!Number.isFinite(e)) return "unknown";
  if (e < 0.03) return "<0.03";
  if (e < 0.06) return "0.03-0.06";
  if (e < 0.09) return "0.06-0.09";
  if (e < 0.12) return "0.09-0.12";
  if (e < 0.18) return "0.12-0.18";
  return ">=0.18";
}

function booksBucket(b) {
  b = Number(b);
  if (!Number.isFinite(b)) return "unknown";
  if (b <= 2) return "books <=2";
  if (b === 3) return "books 3";
  if (b === 4) return "books 4";
  return "books >=5";
}

function summarize(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }

  return [...map.entries()]
    .map(([bucket, rs]) => ({
      bucket,
      legs: rs.length,
      roi: Number(roi(rs).toFixed(4)),
      roiPct: pct(roi(rs)),
      hitRate: pct(hitRate(rs)),
      avgProb: Number((rs.reduce((a, x) => a + Number(x.probability || x.prob || 0), 0) / rs.length).toFixed(4)),
      avgEdge: Number((rs.reduce((a, x) => a + Number(x.edge || 0), 0) / rs.length).toFixed(4)),
      avgBooks: Number((rs.reduce((a, x) => a + Number(x.books || 0), 0) / rs.length).toFixed(2))
    }))
    .sort((a, b) => b.legs - a.legs || b.roi - a.roi);
}

const rows = read(HISTORY, []).filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));

console.log("MARKET INTELLIGENCE");
console.log("===================");
console.log(`graded legs: ${rows.length}`);

if (!rows.length) {
  console.log("No graded history yet. Run after games finish:");
  console.log("npm run postgame-cycle --date=YYYY-MM-DD");
  process.exit(0);
}

console.log("");
console.log("ROI BY MARKET + SIDE");
console.table(summarize(rows, r => `${r.market} ${r.side}`));

console.log("");
console.log("ROI BY BOOK SUPPORT");
console.table(summarize(rows, r => booksBucket(r.books)));

console.log("");
console.log("ROI BY PROBABILITY BUCKET");
console.table(summarize(rows, r => probBucket(r.probability ?? r.prob)));

console.log("");
console.log("ROI BY EDGE BUCKET");
console.table(summarize(rows, r => edgeBucket(r.edge)));

console.log("");
console.log("ROI BY SLIP SIZE");
console.table(summarize(rows, r => `${r.slipSize || "unknown"}-leg`));

const out = {
  createdAt: new Date().toISOString(),
  gradedLegs: rows.length,
  byMarketSide: summarize(rows, r => `${r.market} ${r.side}`),
  byBooks: summarize(rows, r => booksBucket(r.books)),
  byProbability: summarize(rows, r => probBucket(r.probability ?? r.prob)),
  byEdge: summarize(rows, r => edgeBucket(r.edge)),
  bySlipSize: summarize(rows, r => `${r.slipSize || "unknown"}-leg`)
};

fs.writeFileSync("outputs/market-intelligence.json", JSON.stringify(out, null, 2));
