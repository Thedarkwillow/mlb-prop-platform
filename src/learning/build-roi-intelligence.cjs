const fs = require("fs");

const OUT = "data/learning/roi-intelligence.json";

const INPUTS = [
  "outputs/all-markets-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  "outputs/slips-graded.json",
  "outputs/final-slips-graded.json",
  "outputs/official-slip-graded-2026-05-11.json",
  "outputs/playable-final-slips-graded-2026-05-11.json"
];

function read(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function flatten(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap(flatten);
  if (Array.isArray(x.legs)) return x.legs.flatMap(flatten);
  if (Array.isArray(x.slips)) return x.slips.flatMap(flatten);
  if (Array.isArray(x.rows)) return x.rows.flatMap(flatten);
  if (Array.isArray(x.results)) return x.results.flatMap(flatten);
  return [x];
}

function normMarket(x) {
  return String(x.market || x.stat || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function normSide(x) {
  return String(x.side || x.recommendedSide || x.pick || x.direction || "")
    .toUpperCase()
    .includes("LESS") ? "LESS" : "MORE";
}

function tier(x) {
  return String(x.oddsTier || x.tier || x.odds_tier || "standard").toLowerCase();
}

function conf(x) {
  return String(x.confidenceBucket || x.confidence || "unknown").toLowerCase();
}

function prob(x) {
  const v = Number(x.recommendedProb ?? x.probability ?? x.prob ?? x.calibratedDistributionProb);
  return Number.isFinite(v) ? Math.max(0.01, Math.min(0.99, v)) : null;
}

function edge(x) {
  const v = Number(x.expectedValue ?? x.edge ?? x.sportsbookEdge ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function edgeBucket(v) {
  if (v >= 1.25) return "1.25+";
  if (v >= 0.75) return "0.75-1.25";
  if (v >= 0.35) return "0.35-0.75";
  if (v >= 0.15) return "0.15-0.35";
  if (v >= 0.00) return "0.00-0.15";
  return "negative";
}

function result(x) {
  const r = String(x.result || x.outcome || x.gradeResult || x.status || "").toUpperCase();
  if (["WIN", "HIT", "WON"].includes(r)) return "WIN";
  if (["LOSS", "MISS", "LOST"].includes(r)) return "LOSS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";
  return null;
}

function init() {
  return {
    sample: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    stake: 0,
    profit: 0,
    predictedSum: 0,
    evSum: 0
  };
}

function add(map, key, row) {
  if (!map[key]) map[key] = init();

  const r = result(row);
  const p = prob(row);
  const ev = edge(row);

  map[key].sample += 1;
  map[key].wins += r === "WIN" ? 1 : 0;
  map[key].losses += r === "LOSS" ? 1 : 0;
  map[key].pushes += r === "PUSH" ? 1 : 0;
  map[key].stake += r === "PUSH" ? 0 : 1;
  map[key].profit += r === "WIN" ? 1 : r === "LOSS" ? -1 : 0;
  map[key].predictedSum += p ?? 0;
  map[key].evSum += ev;
}

function finalize(r) {
  const decisions = r.wins + r.losses;
  const hitRate = decisions ? r.wins / decisions : null;
  const roi = r.stake ? r.profit / r.stake : null;
  const avgPredicted = r.sample ? r.predictedSum / r.sample : null;
  const avgEV = r.sample ? r.evSum / r.sample : null;

  return {
    sample: r.sample,
    decisions,
    wins: r.wins,
    losses: r.losses,
    pushes: r.pushes,
    hitRate: hitRate == null ? null : Number(hitRate.toFixed(4)),
    roi: roi == null ? null : Number(roi.toFixed(4)),
    profit: Number(r.profit.toFixed(2)),
    avgPredicted: avgPredicted == null ? null : Number(avgPredicted.toFixed(4)),
    avgEV: avgEV == null ? null : Number(avgEV.toFixed(4))
  };
}

function finalizeMap(map) {
  return Object.fromEntries(
    Object.entries(map)
      .map(([k, v]) => [k, finalize(v)])
      .sort((a, b) => b[1].sample - a[1].sample)
  );
}

const rows = [];

for (const file of INPUTS) {
  const data = read(file);
  if (!data) continue;

  for (const row of flatten(data)) {
    const r = result(row);
    if (!r) continue;
    rows.push({ ...row, _sourceFile: file });
  }
}

const byMarket = {};
const byMarketDirection = {};
const byTier = {};
const byConfidence = {};
const byEdgeBucket = {};
const byMarketConfidence = {};
const byMarketEdge = {};

for (const row of rows) {
  const m = normMarket(row);
  const s = normSide(row);
  const t = tier(row);
  const c = conf(row);
  const e = edgeBucket(edge(row));

  add(byMarket, m, row);
  add(byMarketDirection, `${m}_${s}`, row);
  add(byTier, t, row);
  add(byConfidence, c, row);
  add(byEdgeBucket, e, row);
  add(byMarketConfidence, `${m}_${c}`, row);
  add(byMarketEdge, `${m}_${e}`, row);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: INPUTS.filter(fs.existsSync),
  usableRows: rows.length,
  byMarket: finalizeMap(byMarket),
  byMarketDirection: finalizeMap(byMarketDirection),
  byTier: finalizeMap(byTier),
  byConfidence: finalizeMap(byConfidence),
  byEdgeBucket: finalizeMap(byEdgeBucket),
  byMarketConfidence: finalizeMap(byMarketConfidence),
  byMarketEdge: finalizeMap(byMarketEdge)
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("ROI INTELLIGENCE");
console.log("================");
console.log(`Usable graded rows: ${rows.length}`);
console.log(`Wrote ${OUT}`);
console.log("");
console.log("By market:");
console.table(Object.entries(out.byMarket).slice(0, 12).map(([key, v]) => ({ key, ...v })));
console.log("");
console.log("By confidence:");
console.table(Object.entries(out.byConfidence).map(([key, v]) => ({ key, ...v })));
