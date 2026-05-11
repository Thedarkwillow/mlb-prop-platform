const fs = require("fs");

const OUT = "data/learning/adaptive-calibration.json";

const INPUTS = [
  "outputs/all-markets-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  "outputs/playable-final-slips-graded-2026-05-11.json",
  "outputs/official-slip-graded-2026-05-11.json"
];

function read(path, fallback = []) {
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
  if (Array.isArray(x.results)) return x.results.flatMap(flatten);
  if (Array.isArray(x.rows)) return x.rows.flatMap(flatten);
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
    .includes("LESS")
    ? "LESS"
    : "MORE";
}

function probOf(x) {
  const v = Number(
    x.calibratedDistributionProb ??
    x.recommendedProb ??
    x.probability ??
    x.prob ??
    x.rawProb
  );
  return Number.isFinite(v) ? Math.max(0.01, Math.min(0.99, v)) : null;
}

function resultOf(x) {
  const r = String(x.result || x.outcome || x.gradeResult || "").toUpperCase();
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

function add(map, key, row, prob, win) {
  if (!map[key]) map[key] = init();
  map[key].sample += 1;
  map[key].wins += win ? 1 : 0;
  map[key].losses += win ? 0 : 1;
  map[key].predictedSum += prob;
}

function finalizeRecord(r) {
  const sample = r.sample;
  const predicted = sample ? r.predictedSum / sample : null;
  const actual = sample ? r.wins / sample : null;
  const error = predicted != null && actual != null ? actual - predicted : null;

  let multiplier = 1;
  let action = "hold";

  if (sample >= 20 && predicted > 0) {
    const raw = actual / predicted;
    const shrink = sample >= 150 ? 0.75 : sample >= 75 ? 0.55 : sample >= 40 ? 0.35 : 0.2;
    multiplier = 1 + (raw - 1) * shrink;
    multiplier = Math.max(0.72, Math.min(1.12, multiplier));

    if (error <= -0.12 && sample >= 50) action = "downgrade";
    else if (error <= -0.07 && sample >= 30) action = "shrink";
    else if (error >= 0.07 && sample >= 50) action = "boost";
  } else {
    action = "sample-too-small";
  }

  return {
    sample,
    wins: r.wins,
    losses: r.losses,
    predicted: predicted == null ? null : Number(predicted.toFixed(4)),
    actual: actual == null ? null : Number(actual.toFixed(4)),
    error: error == null ? null : Number(error.toFixed(4)),
    multiplier: Number(multiplier.toFixed(4)),
    action
  };
}

const rows = [];

for (const file of INPUTS) {
  const data = read(file, null);
  if (!data) continue;
  for (const row of flatten(data)) {
    const prob = probOf(row);
    const result = resultOf(row);
    if (prob == null || result == null) continue;
    rows.push({ ...row, _sourceFile: file, _prob: prob, _win: result === "WIN" });
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
  const md = `${m}_${s}`;
  const mdb = `${m}_${s}_${b}`;

  add(byBucket, b, row, row._prob, row._win);
  add(byMarket, m, row, row._prob, row._win);
  add(byMarketDirection, md, row, row._prob, row._win);
  add(byMarketDirectionBucket, mdb, row, row._prob, row._win);
}

function finalizeMap(map) {
  return Object.fromEntries(
    Object.entries(map)
      .map(([k, v]) => [k, finalizeRecord(v)])
      .sort((a, b) => b[1].sample - a[1].sample)
  );
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: INPUTS.filter(fs.existsSync),
  usableRows: rows.length,
  rules: {
    minSampleToAdjust: 20,
    hardDowngradeSample: 50,
    multiplierFloor: 0.72,
    multiplierCeiling: 1.12
  },
  byBucket: finalizeMap(byBucket),
  byMarket: finalizeMap(byMarket),
  byMarketDirection: finalizeMap(byMarketDirection),
  byMarketDirectionBucket: finalizeMap(byMarketDirectionBucket)
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("ADAPTIVE CALIBRATION");
console.log("====================");
console.log(`Usable graded rows: ${rows.length}`);
console.log(`Wrote ${OUT}`);
console.log("");
console.log("Top bucket records:");
console.table(Object.entries(out.byBucket).slice(0, 12).map(([key, v]) => ({ key, ...v })));
console.log("");
console.log("Top market-direction records:");
console.table(Object.entries(out.byMarketDirection).slice(0, 12).map(([key, v]) => ({ key, ...v })));
