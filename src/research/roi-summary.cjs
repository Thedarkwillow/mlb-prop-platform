const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);
const FILE = `outputs/playable-final-slips-graded-${DATE}.json`;

function read(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return fallback; }
}

const slips = read(FILE, []);
const legs = slips.flatMap(s => (s.legs || []).map(l => ({ ...l, slip: s.name || s.slip, slipSize: s.size })))
  .filter(l => ["HIT", "MISS", "PUSH"].includes(l.result));

function bucketProb(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  if (p >= 0.70) return "70+";
  if (p >= 0.65) return "65-69";
  if (p >= 0.60) return "60-64";
  if (p >= 0.55) return "55-59";
  return "<55";
}

function bucketBooks(b) {
  b = Number(b || 0);
  if (b >= 4) return "4+ books";
  if (b >= 3) return "3 books";
  if (b >= 2) return "2 books";
  return "<2 books";
}

function summarize(label, keyFn) {
  const map = new Map();
  for (const l of legs) {
    const k = keyFn(l);
    if (!map.has(k)) map.set(k, { picks: 0, hits: 0, misses: 0, pushes: 0 });
    const x = map.get(k);
    x.picks++;
    if (l.result === "HIT") x.hits++;
    if (l.result === "MISS") x.misses++;
    if (l.result === "PUSH") x.pushes++;
  }

  console.log(`\n${label}`);
  console.table([...map.entries()].map(([k,v]) => ({
    bucket: k,
    picks: v.picks,
    hits: v.hits,
    misses: v.misses,
    pushes: v.pushes,
    hitRate: v.picks ? Number((v.hits / (v.hits + v.misses || 1)).toFixed(4)) : null
  })));
}

console.log(`ROI SUMMARY ${DATE}`);
console.log(`graded legs: ${legs.length}`);
summarize("BY MARKET", l => l.market || "unknown");
summarize("BY PROB BUCKET", l => bucketProb(l.prob ?? l.calibratedDistributionProb));
summarize("BY BOOK SUPPORT", l => bucketBooks(l.books));
summarize("BY SLIP SIZE", l => `${l.slipSize || "?"}-man`);
