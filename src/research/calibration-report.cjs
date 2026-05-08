const fs = require("fs");
const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);
const FILE = `outputs/playable-final-slips-graded-${DATE}.json`;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function bucket(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "unknown";
  const lo = Math.floor(n * 20) / 20;
  const hi = lo + 0.05;
  return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
}

const raw = read(FILE, []);
const slips = Array.isArray(raw) ? raw : (raw.slips || raw.results || []);
const legs = slips.flatMap(s => s.legs || [])
  .filter(l => ["HIT","MISS","PUSH"].includes(l.result));

const groups = new Map();

for (const l of legs) {
  const p = Number(l.prob ?? l.calibratedDistributionProb);
  const b = bucket(p);
  if (!groups.has(b)) groups.set(b, { bucket:b, count:0, hits:0, pushes:0, avgProb:0 });
  const g = groups.get(b);
  g.count++;
  g.hits += l.result === "HIT" ? 1 : 0;
  g.pushes += l.result === "PUSH" ? 1 : 0;
  g.avgProb += Number.isFinite(p) ? p : 0;
}

const rows = [...groups.values()].map(g => ({
  bucket: g.bucket,
  count: g.count,
  avgProb: Number((g.avgProb / g.count).toFixed(4)),
  actualHitRate: Number((g.hits / Math.max(1, g.count - g.pushes)).toFixed(4)),
  hits: g.hits,
  pushes: g.pushes
})).sort((a,b) => a.bucket.localeCompare(b.bucket));

fs.writeFileSync(`outputs/calibration-report-${DATE}.json`, JSON.stringify(rows, null, 2));

console.log(`CALIBRATION REPORT ${DATE}`);
console.log(`graded legs: ${legs.length}`);
console.table(rows);
