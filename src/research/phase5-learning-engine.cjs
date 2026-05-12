const fs = require("fs");

function readJson(p, fallback) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function side(v) {
  return String(v || "").toUpperCase().includes("LESS") ? "LESS" : "MORE";
}

function marketOf(r) {
  return norm(r.market || r.stat || r.statKey);
}

function resultOf(r) {
  const raw = String(r.result || r.grade || r.outcome || r.status || "").toUpperCase();
  if (["WIN", "WON", "HIT", "CASH", "GREEN"].includes(raw)) return "WIN";
  if (["LOSS", "LOST", "MISS", "RED"].includes(raw)) return "LOSS";
  return null;
}

function probOf(r) {
  return Number(r.recommendedProb ?? r.prob ?? r.calibratedProb ?? r.modelProb ?? r.probability);
}

function edgeOf(r) {
  return Math.abs(Number(r.adjEdge ?? r.edge ?? r.expectedEdge ?? 0));
}

function bucketProb(p) {
  if (!Number.isFinite(p)) return "unknown";
  const low = Math.floor(p * 20) / 20;
  return `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
}

function bucketEdge(e) {
  if (!Number.isFinite(e)) return "unknown";
  if (e < 0.05) return "0.00-0.05";
  if (e < 0.10) return "0.05-0.10";
  if (e < 0.20) return "0.10-0.20";
  if (e < 0.35) return "0.20-0.35";
  return "0.35+";
}

const files = [
  "outputs/all-markets-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  "outputs/fantasy-graded.json"
];

const historyDir = "outputs/history";
if (fs.existsSync(historyDir)) {
  for (const f of fs.readdirSync(historyDir)) {
    if (f.endsWith(".json")) files.push(`${historyDir}/${f}`);
  }
}

const rows = [];
for (const file of files) {
  const raw = readJson(file, []);
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.rows) ? raw.rows : Object.values(raw || {});
  for (const r of arr) {
    const result = resultOf(r);
    const market = marketOf(r);
    if (!result || !market) continue;
    rows.push({ ...r, _result: result, _market: market, _side: side(r.side || r.recommendedSide) });
  }
}

const groups = {};
for (const r of rows) {
  const prob = probOf(r);
  const edge = edgeOf(r);
  const keys = [
    `market:${r._market}_${r._side}`,
    `prob:${r._market}_${r._side}_${bucketProb(prob)}`,
    `edge:${r._market}_${r._side}_${bucketEdge(edge)}`,
    `combo:${r._market}_${r._side}_${bucketEdge(edge)}_${bucketProb(prob)}`
  ];
  for (const k of keys) {
    groups[k] ||= { key: k, sample: 0, wins: 0, losses: 0 };
    groups[k].sample++;
    if (r._result === "WIN") groups[k].wins++;
    if (r._result === "LOSS") groups[k].losses++;
  }
}

for (const g of Object.values(groups)) {
  g.hitRate = g.sample ? +(g.wins / g.sample).toFixed(4) : null;
  if (g.sample >= 30 && g.hitRate < 0.48) g.action = "SUPPRESS";
  else if (g.sample >= 30 && g.hitRate < 0.52) g.action = "DOWNWEIGHT";
  else if (g.sample >= 30 && g.hitRate > 0.58) g.action = "BOOST";
  else g.action = "ALLOW";
  g.weight =
    g.action === "SUPPRESS" ? 0 :
    g.action === "DOWNWEIGHT" ? 0.75 :
    g.action === "BOOST" ? 1.08 :
    1;
}

const marketTrust = {};
const calibration = {
  createdAt: new Date().toISOString(),
  byMarketDirection: {},
  byMarketDirectionBucket: {},
  byBucket: {}
};
const edgeConfidence = {};
const autoMarkets = {};
const volatility = {};

for (const [k, g] of Object.entries(groups)) {
  if (k.startsWith("market:")) {
    const key = k.replace("market:", "");
    marketTrust[key] = g;
    autoMarkets[key] = { action: g.action, weight: g.weight, sample: g.sample, hitRate: g.hitRate };
    volatility[key] = {
      sample: g.sample,
      volatilityScore: +(1 - Math.abs((g.hitRate ?? 0.5) - 0.5) * 2).toFixed(4)
    };
    calibration.byMarketDirection[key] = {
      sample: g.sample,
      predicted: null,
      actual: g.hitRate,
      multiplier: g.sample >= 30 ? Math.max(0.7, Math.min(1.1, (g.hitRate || 0.5) / 0.55)) : 1,
      action: g.action
    };
  }
  if (k.startsWith("prob:")) {
    const key = k.replace("prob:", "");
    calibration.byMarketDirectionBucket[key] = {
      sample: g.sample,
      actual: g.hitRate,
      multiplier: g.sample >= 20 ? Math.max(0.65, Math.min(1.1, (g.hitRate || 0.5) / 0.6)) : 1,
      action: g.action
    };
  }
  if (k.startsWith("edge:") || k.startsWith("combo:")) {
    edgeConfidence[k] = g;
  }
}

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/phase5-market-trust.json", JSON.stringify({ createdAt: new Date().toISOString(), rows: marketTrust }, null, 2));
fs.writeFileSync("data/learning/confidence-calibration.json", JSON.stringify(calibration, null, 2));
fs.writeFileSync("data/learning/roi-edge-confidence.json", JSON.stringify({ createdAt: new Date().toISOString(), rows: edgeConfidence }, null, 2));
fs.writeFileSync("data/learning/auto-market-adjustments.json", JSON.stringify({ createdAt: new Date().toISOString(), rows: autoMarkets }, null, 2));
fs.writeFileSync("data/learning/market-volatility.json", JSON.stringify({ createdAt: new Date().toISOString(), rows: volatility }, null, 2));

console.log("PHASE 5 LEARNING BUILT");
console.log("graded rows:", rows.length);
console.log("market groups:", Object.keys(marketTrust).length);
console.table(Object.entries(marketTrust).slice(0, 20).map(([key, v]) => ({
  key, sample: v.sample, hitRate: v.hitRate, action: v.action, weight: v.weight
})));
