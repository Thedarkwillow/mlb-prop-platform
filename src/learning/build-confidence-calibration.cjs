const fs = require("fs");

const OUT = "data/learning/confidence-calibration.json";

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

function probOf(x) {
  const v = Number(
    x.recommendedProb ??
    x.probability ??
    x.prob ??
    x.calibratedDistributionProb ??
    x.rawProb
  );
  return Number.isFinite(v) ? Math.max(0.01, Math.min(0.99, v)) : null;
}

function resultOf(x) {
  const r = String(x.result || x.outcome || x.gradeResult || x.status || "").toUpperCase();
  if (["WIN", "HIT", "WON"].includes(r)) return "WIN";
  if (["LOSS", "MISS", "LOST"].includes(r)) return "LOSS";
  return null;
}

function bucket(prob) {
  const low = Math.floor(prob * 20) / 20;
  const high = low + 0.05;
  return `${low.toFixed(2)}-${high.toFixed(2)}`;
}

function init() {
  return {
    sample: 0,
    wins: 0,
    losses: 0,
    predictedSum: 0
  };
}

function add(map, key, prob, win) {
  if (!map[key]) map[key] = init();
  map[key].sample += 1;
  map[key].wins += win ? 1 : 0;
  map[key].losses += win ? 0 : 1;
  map[key].predictedSum += prob;
}

function finalizeRecord(r) {
  const predicted = r.sample ? r.predictedSum / r.sample : null;
  const actual = r.sample ? r.wins / r.sample : null;
  const error = predicted != null && actual != null ? actual - predicted : null;

  let multiplier = 1;
  let action = "hold";

  if (r.sample >= 20 && predicted > 0) {
    const raw = actual / predicted;

    const shrink =
      r.sample >= 200 ? 0.80 :
      r.sample >= 100 ? 0.60 :
      r.sample >= 50 ? 0.40 :
      0.20;

    multiplier = 1 + (raw - 1) * shrink;
    multiplier = Math.max(0.74, Math.min(1.10, multiplier));

    if (error <= -0.10 && r.sample >= 50) action = "strong_shrink";
    else if (error <= -0.06 && r.sample >= 30) action = "shrink";
    else if (error >= 0.07 && r.sample >= 50) action = "boost";
  } else {
    action = "sample_too_small";
  }

  return {
    sample: r.sample,
    wins: r.wins,
    losses: r.losses,
    predicted: predicted == null ? null : Number(predicted.toFixed(4)),
    actual: actual == null ? null : Number(actual.toFixed(4)),
    error: error == null ? null : Number(error.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4)),
    action
  };
}

function finalizeMap(map) {
  return Object.fromEntries(
    Object.entries(map)
      .map(([k, v]) => [k, finalizeRecord(v)])
      .sort((a, b) => b[1].sample - a[1].sample)
  );
}

const rows = [];

for (const file of INPUTS) {
  const data = read(file);
  if (!data) continue;

  for (const row of flatten(data)) {
    const p = probOf(row);
    const r = resultOf(row);
    if (p == null || r == null) continue;
    rows.push({ ...row, _prob: p, _win: r === "WIN", _sourceFile: file });
  }
}

const byBucket = {};
const byMarket = {};
const byMarketDirection = {};
const byMarketDirectionBucket = {};

for (const row of rows) {
  const b = bucket(row._prob);
  const m = normMarket(row);
  const s = normSide(row);

  add(byBucket, b, row._prob, row._win);
  add(byMarket, m, row._prob, row._win);
  add(byMarketDirection, `${m}_${s}`, row._prob, row._win);
  add(byMarketDirectionBucket, `${m}_${s}_${b}`, row._prob, row._win);
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: INPUTS.filter(fs.existsSync),
  usableRows: rows.length,
  rules: {
    minSampleToAdjust: 20,
    multiplierFloor: 0.74,
    multiplierCeiling: 1.10,
    note: "Used by probabilityEngine.js before market volatility/auto-market adjustments."
  },
  byBucket: finalizeMap(byBucket),
  byMarket: finalizeMap(byMarket),
  byMarketDirection: finalizeMap(byMarketDirection),
  byMarketDirectionBucket: finalizeMap(byMarketDirectionBucket)
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("CONFIDENCE CALIBRATION");
console.log("======================");
console.log(`Usable graded rows: ${rows.length}`);
console.log(`Wrote ${OUT}`);
console.log("");
console.log("By bucket:");
console.table(Object.entries(out.byBucket).slice(0, 12).map(([key, v]) => ({ key, ...v })));
console.log("");
console.log("By market-direction:");
console.table(Object.entries(out.byMarketDirection).slice(0, 12).map(([key, v]) => ({ key, ...v })));
