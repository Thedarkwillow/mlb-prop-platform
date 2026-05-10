import fs from "fs";

const IN = "data/learning/market-learning.json";
const OUT = "data/learning/market-trust.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function trustLevel(v) {
  const sample = Number(v.sample || 0);
  const actual = Number(v.actual);
  const predicted = Number(v.predicted);
  const bias = Number(v.bias || 0);

  if (sample < 50) return "unknown";
  if (sample >= 100 && actual < 0.5) return "blocked";
  if (sample >= 100 && bias <= -0.08) return "weak";
  if (sample >= 100 && bias >= 0.05) return "strong";
  if (sample >= 250 && actual >= 0.58) return "strong";
  return "neutral";
}

function suppress(v, trust) {
  const sample = Number(v.sample || 0);
  const actual = Number(v.actual);
  const bias = Number(v.bias || 0);

  if (sample < 100) return false;
  if (trust === "blocked") return true;
  if (bias <= -0.10) return true;
  if (actual < 0.50) return true;
  return false;
}

const learning = read(IN, {});
const byMarketDirection = learning.byMarketDirection || {};
const out = {
  generatedAt: new Date().toISOString(),
  sourceFile: learning.sourceFile || IN,
  usableRows: learning.usableRows || 0,
  byMarketDirection: {}
};

for (const [key, v] of Object.entries(byMarketDirection)) {
  const trust = trustLevel(v);
  const suppressed = suppress(v, trust);
  out.byMarketDirection[key] = {
    sample: Number(v.sample || 0),
    predicted: Number(v.predicted ?? 0),
    actual: Number(v.actual ?? 0),
    bias: Number(v.bias ?? 0),
    adjustmentMultiplier: Number(v.adjustmentMultiplier ?? 1),
    trust,
    suppressed,
    reason: suppressed
      ? "historical_underperformance"
      : trust === "strong"
        ? "historical_outperformance"
        : "neutral_or_insufficient_edge"
  };
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
fs.writeFileSync("outputs/learning/market-trust.json", JSON.stringify(out, null, 2));

console.log(`Market trust written: ${OUT}`);
console.table(Object.entries(out.byMarketDirection).map(([k,v]) => ({
  market: k,
  sample: v.sample,
  predicted: v.predicted,
  actual: v.actual,
  bias: v.bias,
  mult: v.adjustmentMultiplier,
  trust: v.trust,
  suppressed: v.suppressed
})));
