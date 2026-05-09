const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const FILE = `outputs/playable-final-slips-graded-${DATE}.json`;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function probBucket(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  return `${Math.floor(p * 100 / 5) * 5}-${Math.floor(p * 100 / 5) * 5 + 4}`;
}

function bookBucket(b) {
  b = Number(b);
  if (b >= 4) return "4+ books";
  if (b === 3) return "3 books";
  if (b === 2) return "2 books";
  return "0-1 books";
}

function group(rows, fn) {
  const m = new Map();
  for (const row of rows) {
    const k = fn(row);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }

  return [...m.entries()].map(([bucket, arr]) => {
    const hits = arr.filter(x => x.result === "HIT").length;
    const misses = arr.filter(x => x.result === "MISS").length;
    const pushes = arr.filter(x => x.result === "PUSH").length;
    const graded = hits + misses;
    const unitProfit = hits - misses;
    return {
      bucket,
      picks: arr.length,
      hits,
      misses,
      pushes,
      hitRate: graded ? Number((hits / graded).toFixed(4)) : 0,
      roi: arr.length ? Number((unitProfit / arr.length).toFixed(4)) : 0
    };
  });
}

const raw = read(FILE, []);
const slips = Array.isArray(raw) ? raw : (raw.slips || raw.results || []);
const legs = slips.flatMap(s => (s.legs || []).map(l => ({
  ...l,
  slip: s.name || s.slip,
  slipSize: s.size
}))).filter(l => ["HIT", "MISS", "PUSH"].includes(l.result));

const byMarket = group(legs, l => l.market);
const byProbBucket = group(legs, l => probBucket(l.prob ?? l.calibratedDistributionProb));
const byBookSupport = group(legs, l => bookBucket(l.books ?? l.sportsbookBookCount));
const bySlipSize = group(legs, l => `${l.slipSize}-man`);

const report = {
  date: DATE,
  gradedLegs: legs.length,
  byMarket: Object.fromEntries(byMarket.map(r => [r.bucket, r])),
  byProbBucket: Object.fromEntries(byProbBucket.map(r => [r.bucket, r])),
  byBookSupport: Object.fromEntries(byBookSupport.map(r => [r.bucket, r])),
  bySlipSize: Object.fromEntries(bySlipSize.map(r => [r.bucket, r]))
};

console.log(`ROI SUMMARY ${DATE}`);
console.log(`graded legs: ${legs.length}`);
console.log("BY MARKET");
console.table(byMarket);
console.log("BY PROB BUCKET");
console.table(byProbBucket);
console.log("BY BOOK SUPPORT");
console.table(byBookSupport);
console.log("BY SLIP SIZE");
console.table(bySlipSize);

fs.writeFileSync(`outputs/roi-summary-${DATE}.json`, JSON.stringify(report, null, 2));
fs.writeFileSync("outputs/roi-summary.json", JSON.stringify(report, null, 2));
console.log(`Wrote outputs/roi-summary-${DATE}.json`);
console.log("Wrote outputs/roi-summary.json");
