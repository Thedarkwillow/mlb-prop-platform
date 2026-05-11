const fs = require("fs");

const OUT = "data/learning/market-volatility.json";

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

function resultOf(x) {
  const r = String(x.result || x.outcome || x.gradeResult || x.status || "").toUpperCase();
  if (["WIN", "HIT", "WON"].includes(r)) return 1;
  if (["LOSS", "MISS", "LOST"].includes(r)) return 0;
  return null;
}

function dateOf(x) {
  return String(
    x.date ||
    x.slateDate ||
    x.gameDate ||
    x.gradedDate ||
    x.createdAt ||
    x._sourceFile ||
    "unknown"
  ).slice(0, 10);
}

function init() {
  return {
    sample: 0,
    wins: 0,
    losses: 0,
    daily: {}
  };
}

function add(map, key, row, win) {
  if (!map[key]) map[key] = init();
  const d = dateOf(row);

  map[key].sample += 1;
  map[key].wins += win ? 1 : 0;
  map[key].losses += win ? 0 : 1;

  if (!map[key].daily[d]) {
    map[key].daily[d] = { sample: 0, wins: 0, losses: 0 };
  }

  map[key].daily[d].sample += 1;
  map[key].daily[d].wins += win ? 1 : 0;
  map[key].daily[d].losses += win ? 0 : 1;
}

function stddev(values) {
  if (values.length <= 1) return 0;
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  const variance = values.reduce((s, x) => s + Math.pow(x - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function finalize(r) {
  const dailyRates = Object.values(r.daily)
    .filter(d => d.sample >= 3)
    .map(d => d.wins / Math.max(1, d.wins + d.losses));

  const hitRate = r.sample ? r.wins / r.sample : null;
  const dailyStdDev = stddev(dailyRates);
  const lossRate = r.sample ? r.losses / r.sample : 0;

  let volatilityScore = 0;

  volatilityScore += Math.min(0.45, dailyStdDev * 1.35);

  if (r.sample < 25) volatilityScore += 0.25;
  else if (r.sample < 75) volatilityScore += 0.12;

  if (lossRate >= 0.45) volatilityScore += 0.2;
  if (lossRate >= 0.55) volatilityScore += 0.3;

  volatilityScore = Math.max(0, Math.min(1, volatilityScore));

  let riskTier = "stable";
  if (volatilityScore >= 0.75) riskTier = "extreme";
  else if (volatilityScore >= 0.55) riskTier = "high";
  else if (volatilityScore >= 0.35) riskTier = "medium";

  return {
    sample: r.sample,
    wins: r.wins,
    losses: r.losses,
    hitRate: hitRate == null ? null : Number(hitRate.toFixed(4)),
    dailyWindows: dailyRates.length,
    dailyStdDev: Number(dailyStdDev.toFixed(4)),
    volatilityScore: Number(volatilityScore.toFixed(4)),
    riskTier
  };
}

function finalizeMap(map) {
  return Object.fromEntries(
    Object.entries(map)
      .map(([k, v]) => [k, finalize(v)])
      .sort((a, b) => b[1].volatilityScore - a[1].volatilityScore)
  );
}

const rows = [];

for (const file of INPUTS) {
  const data = read(file);
  if (!data) continue;

  for (const row of flatten(data)) {
    const win = resultOf(row);
    if (win == null) continue;
    rows.push({ ...row, _sourceFile: file });
  }
}

const byMarket = {};
const byMarketDirection = {};

for (const row of rows) {
  const m = normMarket(row);
  const s = normSide(row);
  const win = resultOf(row);

  add(byMarket, m, row, win);
  add(byMarketDirection, `${m}_${s}`, row, win);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: INPUTS.filter(fs.existsSync),
  usableRows: rows.length,
  rules: {
    mediumVolatility: 0.35,
    highVolatility: 0.55,
    extremeVolatility: 0.75,
    note: "Used by probabilityEngine.js to shrink unstable markets before slip building."
  },
  byMarket: finalizeMap(byMarket),
  byMarketDirection: finalizeMap(byMarketDirection)
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("MARKET VOLATILITY");
console.log("=================");
console.log(`Usable graded rows: ${rows.length}`);
console.log(`Wrote ${OUT}`);
console.log("");
console.log("By market:");
console.table(Object.entries(out.byMarket).map(([key, v]) => ({ key, ...v })));
console.log("");
console.log("By market-direction:");
console.table(Object.entries(out.byMarketDirection).map(([key, v]) => ({ key, ...v })));
