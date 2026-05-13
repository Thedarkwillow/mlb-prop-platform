const fs = require("fs");

function readJson(p, fallback = []) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function writeJson(p, data) {
  fs.mkdirSync(require("path").dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function side(v) {
  return String(v || "").toUpperCase().includes("LESS") ? "LESS" : "MORE";
}

function resultOf(r) {
  const raw = String(r.result || r.grade || r.outcome || r.status || "").toUpperCase();
  if (["WIN", "WON", "HIT", "CASH", "GREEN"].includes(raw)) return "WIN";
  if (["LOSS", "LOST", "MISS", "RED"].includes(raw)) return "LOSS";
  return null;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

const files = [
  "outputs/all-markets-graded.json",
  "outputs/fantasy-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  ...fs.existsSync("outputs/history")
    ? fs.readdirSync("outputs/history").filter(f => f.endsWith(".json")).map(f => `outputs/history/${f}`)
    : []
];

const rows = files.flatMap(f => {
  const x = readJson(f, []);
  return Array.isArray(x) ? x : Array.isArray(x.rows) ? x.rows : [];
}).filter(r => resultOf(r));

const groups = new Map();

function addFeature(name, value, r) {
  if (value === undefined || value === null || value === "") return;
  const key = `${name}:${norm(value)}`;
  const g = groups.get(key) || { feature: name, value: String(value), sample: 0, wins: 0, losses: 0, avgProb: 0, avgEdge: 0 };
  const res = resultOf(r);
  const prob = n(r.recommendedProb ?? r.prob ?? r.calibratedProb ?? r.calibratedDistributionProb);
  const edge = n(r.edge ?? r.sportsbookEdge ?? r.sportsbookAdjustedEdge ?? r.expectedValue);
  g.sample++;
  if (res === "WIN") g.wins++;
  if (res === "LOSS") g.losses++;
  if (prob !== null) g.avgProb += prob;
  if (edge !== null) g.avgEdge += edge;
  groups.set(key, g);
}

for (const r of rows) {
  const market = norm(r.market || r.stat || r.statKey);
  const s = side(r.side || r.recommendedSide || r.pick || r.direction);
  addFeature("market_side", `${market}_${s}`, r);
  addFeature("market", market, r);
  addFeature("side", s, r);
  addFeature("confidence", r.confidenceBucket || r.confidence || r.distributionConfidence, r);
  addFeature("savant", r.savantReportGrade || r.savantGrade || r.savant, r);
  addFeature("book_support", r.marketSupportFlag || r.support, r);
  addFeature("match_type", r.sportsbookMatchType || r.match, r);
  addFeature("line_type", r.sportsbookExactLine ? "exact" : r.sportsbookMatchType, r);
  addFeature("distribution_confidence", r.distributionModel?.confidence || r.distributionConfidence, r);

  const books = n(r.sportsbookBookCount ?? r.books);
  if (books !== null) {
    addFeature("book_count_bucket", books >= 8 ? "8+" : books >= 5 ? "5-7" : books >= 3 ? "3-4" : books >= 2 ? "2" : "0-1", r);
  }

  const prob = n(r.recommendedProb ?? r.prob ?? r.calibratedProb ?? r.calibratedDistributionProb);
  if (prob !== null) {
    addFeature("prob_bucket", prob >= .75 ? ".75+" : prob >= .70 ? ".70-.75" : prob >= .65 ? ".65-.70" : prob >= .60 ? ".60-.65" : prob >= .55 ? ".55-.60" : "<.55", r);
  }
}

const outputRows = [...groups.values()].map(g => {
  const hitRate = g.sample ? g.wins / g.sample : null;
  const avgProb = g.sample ? g.avgProb / g.sample : null;
  const avgEdge = g.sample ? g.avgEdge / g.sample : null;
  let action = "IGNORE_SAMPLE";
  let weight = 1;
  if (g.sample >= 75) {
    if (hitRate >= 0.62) { action = "BOOST"; weight = 1.06; }
    else if (hitRate >= 0.54) { action = "ALLOW"; weight = 1; }
    else if (hitRate >= 0.48) { action = "DOWNWEIGHT"; weight = 0.88; }
    else { action = "SUPPRESS_FEATURE"; weight = 0.7; }
  } else if (g.sample >= 25) {
    if (hitRate >= 0.65) { action = "WATCH_BOOST"; weight = 1.03; }
    else if (hitRate < 0.42) { action = "WATCH_DOWN"; weight = 0.9; }
    else { action = "ALLOW"; weight = 1; }
  }
  return {
    ...g,
    hitRate: hitRate === null ? null : Number(hitRate.toFixed(4)),
    avgProb: avgProb === null ? null : Number(avgProb.toFixed(4)),
    avgEdge: avgEdge === null ? null : Number(avgEdge.toFixed(4)),
    action,
    weight
  };
}).sort((a,b) => b.sample - a.sample);

const out = {
  createdAt: new Date().toISOString(),
  gradedRows: rows.length,
  samplePolicy: {
    minWatch: 25,
    minTrusted: 75,
    note: "Small samples are tracked but not allowed to strongly control slip selection."
  },
  rows: Object.fromEntries(outputRows.map(r => [`${r.feature}:${norm(r.value)}`, r])),
  topNegative: outputRows.filter(r => r.sample >= 25).sort((a,b) => a.hitRate - b.hitRate).slice(0, 20),
  topPositive: outputRows.filter(r => r.sample >= 25).sort((a,b) => b.hitRate - a.hitRate).slice(0, 20)
};

writeJson("data/learning/phase6-feature-attribution.json", out);

console.log("PHASE 6 FEATURE ATTRIBUTION BUILT");
console.log("graded rows:", rows.length);
console.table(outputRows.filter(r => r.sample >= 25).slice(0, 25).map(r => ({
  feature: r.feature,
  value: r.value,
  sample: r.sample,
  hitRate: r.hitRate,
  action: r.action,
  weight: r.weight
})));
