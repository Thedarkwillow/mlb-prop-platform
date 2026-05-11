const fs = require("fs");

const ROI_FILE = "data/learning/roi-intelligence.json";
const CAL_FILE = "data/learning/confidence-calibration.json";
const VOL_FILE = "data/learning/market-volatility.json";
const OUT = "data/learning/auto-market-adjustments.json";

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const roi = read(ROI_FILE, {});
const cal = read(CAL_FILE, {});
const vol = read(VOL_FILE, {});

function decide(key, roiRec = {}, calRec = {}, volRec = {}) {
  const sample = Math.max(
    Number(roiRec.sample || 0),
    Number(calRec.sample || 0),
    Number(volRec.sample || 0)
  );

  const hitRate = roiRec.hitRate ?? volRec.hitRate ?? calRec.actual ?? null;
  const roiValue = roiRec.roi ?? null;
  const calError = calRec.error ?? null;
  const volatilityScore = Number(volRec.volatilityScore || 0);

  let action = "hold";
  let reason = "no strong signal";
  let multiplier = 1;

  if (sample < 30) {
    action = "hold";
    reason = "sample too small";
    multiplier = 1;
  } else if (
    sample >= 75 &&
    (
      roiValue <= -0.08 ||
      calError <= -0.10 ||
      volatilityScore >= 0.75
    )
  ) {
    action = "suppress";
    reason = "negative ROI/calibration or extreme volatility";
    multiplier = 0.75;
  } else if (
    sample >= 50 &&
    (
      roiValue <= -0.03 ||
      calError <= -0.06 ||
      volatilityScore >= 0.55
    )
  ) {
    action = "downgrade";
    reason = "weak ROI/calibration or high volatility";
    multiplier = 0.86;
  } else if (
    sample >= 75 &&
    roiValue >= 0.08 &&
    calError >= 0.04 &&
    volatilityScore < 0.45
  ) {
    action = "boost";
    reason = "positive ROI plus underconfident calibration";
    multiplier = 1.04;
  }

  return {
    key,
    sample,
    action,
    reason,
    multiplier,
    hitRate,
    roi: roiValue,
    calibrationError: calError,
    volatilityScore,
    generatedAt: new Date().toISOString()
  };
}

function build(keys, roiMap = {}, calMap = {}, volMap = {}) {
  const allKeys = new Set([
    ...Object.keys(roiMap || {}),
    ...Object.keys(calMap || {}),
    ...Object.keys(volMap || {})
  ]);

  const out = {};

  for (const key of allKeys) {
    out[key] = decide(
      key,
      roiMap[key] || {},
      calMap[key] || {},
      volMap[key] || {}
    );
  }

  return Object.fromEntries(
    Object.entries(out).sort((a, b) => {
      const order = { suppress: 0, downgrade: 1, boost: 2, hold: 3 };
      return (order[a[1].action] ?? 9) - (order[b[1].action] ?? 9) || b[1].sample - a[1].sample;
    })
  );
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: [ROI_FILE, CAL_FILE, VOL_FILE].filter(fs.existsSync),
  rules: {
    suppress: "sample>=75 and ROI<=-8% or calibration error<=-10% or volatility>=0.75",
    downgrade: "sample>=50 and ROI<=-3% or calibration error<=-6% or volatility>=0.55",
    boost: "sample>=75 and ROI>=8% and calibration error>=4% and volatility<0.45",
    note: "Used by probabilityEngine.js after calibration and volatility scoring."
  },
  byMarket: build(
    "market",
    roi.byMarket || {},
    cal.byMarket || {},
    vol.byMarket || {}
  ),
  byMarketDirection: build(
    "marketDirection",
    roi.byMarketDirection || {},
    cal.byMarketDirection || {},
    vol.byMarketDirection || {}
  )
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("AUTO MARKET ADJUSTMENTS");
console.log("=======================");
console.log(`Wrote ${OUT}`);
console.log("");
console.log("By market:");
console.table(Object.entries(out.byMarket).map(([key, v]) => ({ key, ...v })));
console.log("");
console.log("By market-direction:");
console.table(Object.entries(out.byMarketDirection).map(([key, v]) => ({ key, ...v })));
