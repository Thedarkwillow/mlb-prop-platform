const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function flatten(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.props)) return data.props;
  if (Array.isArray(data.legs)) return data.legs;
  if (Array.isArray(data.slips)) return data.slips.flatMap(s => s.legs || []);
  return [];
}

function bucketLine(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 0.5) return "<=0.5";
  if (n <= 1.5) return "1.0-1.5";
  if (n <= 2.5) return "2.0-2.5";
  if (n <= 3.5) return "3.0-3.5";
  if (n <= 5.5) return "4.0-5.5";
  if (n <= 7.5) return "6.0-7.5";
  return "8.0+";
}

function resultOf(r) {
  return String(r.result || r.grade || r.outcome || "").toUpperCase();
}

function add(map, key, row) {
  if (!key || key.includes("undefined")) return;

  if (!map.has(key)) {
    map.set(key, {
      key,
      total: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      hitRate: null,
      roi: null,
      avgProb: null,
      avgEV: null
    });
  }

  const x = map.get(key);
  x.total++;

  const res = resultOf(row);
  if (["WIN", "HIT", "W"].includes(res)) x.wins++;
  else if (["LOSS", "MISS", "L"].includes(res)) x.losses++;
  else x.pushes++;

  const prob = Number(row.recommendedProb ?? row.probability ?? row.prob);
  const ev = Number(row.expectedValue ?? row.ev);

  x._probs ||= [];
  x._evs ||= [];

  if (Number.isFinite(prob)) x._probs.push(prob);
  if (Number.isFinite(ev)) x._evs.push(ev);
}

function finish(x) {
  const decided = x.wins + x.losses;
  x.hitRate = decided ? +(x.wins / decided).toFixed(4) : null;
  x.roi = decided ? +((x.wins - x.losses) / decided).toFixed(4) : null;
  x.avgProb = x._probs.length ? +(x._probs.reduce((a,b)=>a+b,0) / x._probs.length).toFixed(4) : null;
  x.avgEV = x._evs.length ? +(x._evs.reduce((a,b)=>a+b,0) / x._evs.length).toFixed(4) : null;
  delete x._probs;
  delete x._evs;
  return x;
}

const files = [
  "outputs/all-markets-graded.json",
  "outputs/playable-final-slips-graded.json",
  "data/results/prop-warehouse.json"
];

let rows = [];

for (const f of files) {
  rows.push(...flatten(readJson(f, [])));
}

rows = rows.filter(r => r && (r.player || r.playerName) && r.market);

const groups = new Map();

for (const r of rows) {
  const market = String(r.market || "").toLowerCase();
  const side = String(r.recommendedSide || r.side || "").toUpperCase();
  const bucket = bucketLine(r.line);

  add(groups, `market:${market}`, r);
  add(groups, `market_side:${market}_${side}`, r);
  add(groups, `line_bucket:${bucket}`, r);
  add(groups, `market_line:${market}_${bucket}`, r);
  add(groups, `market_side_line:${market}_${side}_${bucket}`, r);
}

const report = Array.from(groups.values())
  .map(finish)
  .filter(x => x.total >= 3)
  .sort((a, b) => {
    const ar = a.roi ?? -999;
    const br = b.roi ?? -999;
    return br - ar || b.total - a.total;
  });

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/line-bucket-roi-report.json", JSON.stringify(report, null, 2));

console.log("LINE BUCKET ROI REPORT");
console.log("======================");
console.log({ gradedRows: rows.length, groups: report.length });
console.table(report.slice(0, 40));
console.log("Wrote outputs/line-bucket-roi-report.json");
