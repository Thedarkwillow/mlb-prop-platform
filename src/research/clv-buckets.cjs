const fs = require("fs");
const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);
const FILE = `outputs/clv-report-${DATE}.json`;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function bucket(c) {
  c = Number(c);
  if (!Number.isFinite(c)) return "unknown";
  if (c <= -20) return "<= -20";
  if (c <= -10) return "-20 to -10";
  if (c < 0) return "-10 to 0";
  if (c === 0) return "0";
  if (c < 10) return "0 to +10";
  if (c < 20) return "+10 to +20";
  return ">= +20";
}

const rows = read(FILE, []);
const groups = new Map();

for (const r of rows) {
  const b = bucket(r.clv);
  if (!groups.has(b)) groups.set(b, { bucket:b, count:0, avgClv:0, beatClose:0 });
  const g = groups.get(b);
  g.count++;
  g.avgClv += Number(r.clv || 0);
  g.beatClose += r.beatClose ? 1 : 0;
}

const out = [...groups.values()].map(g => ({
  bucket: g.bucket,
  count: g.count,
  avgClv: Number((g.avgClv / g.count).toFixed(2)),
  beatCloseRate: Number((g.beatClose / g.count).toFixed(4))
}));

fs.writeFileSync(`outputs/clv-buckets-${DATE}.json`, JSON.stringify(out, null, 2));

console.log(`CLV BUCKET REPORT ${DATE}`);
console.table(out);
