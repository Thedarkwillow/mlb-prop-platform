const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function side(v) {
  return String(v || "").toUpperCase().trim();
}

function tier(v) {
  return String(v || "standard").toLowerCase().trim();
}

function result(row) {
  const r = String(row.result || row.grade || row.outcome || "").toUpperCase();
  if (["WIN", "WON", "HIT"].includes(r)) return "WIN";
  if (["LOSS", "LOST", "MISS"].includes(r)) return "LOSS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";
  return "UNKNOWN";
}

function prob(row) {
  return Number(row.calibratedDistributionProb ?? row.recommendedProb ?? row.prob ?? row.probability);
}

function edge(row) {
  return Number(row.sportsbookAdjustedEdge ?? row.adjustedEdge ?? row.sportsbookEdge ?? row.edge);
}

function add(map, key, row) {
  if (!map[key]) map[key] = [];
  map[key].push(row);
}

function summarize(rows) {
  const graded = rows.filter(r => ["WIN", "LOSS", "PUSH"].includes(result(r)));
  const wins = graded.filter(r => result(r) === "WIN").length;
  const losses = graded.filter(r => result(r) === "LOSS").length;
  const pushes = graded.filter(r => result(r) === "PUSH").length;
  const decisions = wins + losses;
  const probs = rows.map(prob).filter(Number.isFinite);
  const edges = rows.map(edge).filter(Number.isFinite);

  return {
    count: rows.length,
    graded: graded.length,
    wins,
    losses,
    pushes,
    hitRate: decisions ? Number((wins / decisions).toFixed(4)) : null,
    roi: decisions ? Number(((wins - losses) / decisions).toFixed(4)) : null,
    avgProb: probs.length ? Number((probs.reduce((a,b)=>a+b,0)/probs.length).toFixed(4)) : null,
    avgEdge: edges.length ? Number((edges.reduce((a,b)=>a+b,0)/edges.length).toFixed(4)) : null
  };
}

const history = [
  ...read("data/results/graded-leg-history.json", []),
  ...read("data/results/prop-warehouse.json", [])
];

const nearMiss = read("outputs/near-miss-tracking.json", []);

const byTier = {};
const byMarketSideTier = {};
const goblins = [];

for (const r of history) {
  const t = tier(r.oddsTier || r.tier);
  const market = norm(r.market || r.stat);
  const s = side(r.side || r.recommendedSide);
  if (!market || !s) continue;

  add(byTier, t, r);
  add(byMarketSideTier, `${market}_${s}_${t}`, r);

  if (t === "goblin") goblins.push(r);
}

const report = {
  generatedAt: new Date().toISOString(),
  note: "Goblin calibration is tracked separately. Do not auto-play goblins until graded sample is large enough.",
  sampleWarning: "Require 50+ graded goblin legs before changing final-gate behavior. Prefer 100+.",
  goblinSummary: summarize(goblins),
  byTier: Object.fromEntries(Object.entries(byTier).map(([k,v]) => [k, summarize(v)])),
  byMarketSideTier: Object.fromEntries(Object.entries(byMarketSideTier).map(([k,v]) => [k, summarize(v)])),
  nearMissGoblinCandidates: nearMiss.filter(r => tier(r.oddsTier || r.tier || "goblin") === "goblin")
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/goblin-calibration.json", JSON.stringify(report, null, 2));

console.log("GOBLIN CALIBRATION REPORT");
console.log("=========================");
console.log("Goblin summary:");
console.table([report.goblinSummary]);
console.log("By tier:");
console.table(Object.entries(report.byTier).map(([bucket, x]) => ({ bucket, ...x })));
console.log("Top market-side-tier buckets:");
console.table(Object.entries(report.byMarketSideTier).slice(0, 20).map(([bucket, x]) => ({ bucket, ...x })));
console.log("Near-miss goblin candidates:", report.nearMissGoblinCandidates.length);
console.log("Wrote data/learning/goblin-calibration.json");
