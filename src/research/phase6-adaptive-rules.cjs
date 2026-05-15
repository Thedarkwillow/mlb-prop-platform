const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function actionFor(row) {
  const graded = Number(row.graded || 0);
  const roi = Number(row.roi);
  const hitRate = Number(row.hitRate);

  if (graded < 10) return {
    action: "TRACK",
    multiplier: 1,
    thresholdAdjustment: 0,
    reason: "low_sample"
  };

  if (roi <= -0.15 || hitRate < 0.45) return {
    action: "TIGHTEN",
    multiplier: 0.70,
    thresholdAdjustment: 0.04,
    reason: "negative_roi_or_low_hit_rate"
  };

  if (roi < 0 || hitRate < 0.52) return {
    action: "DOWNWEIGHT",
    multiplier: 0.85,
    thresholdAdjustment: 0.02,
    reason: "underperforming"
  };

  if (roi >= 0.15 && hitRate >= 0.58) return {
    action: "BOOST",
    multiplier: 1.08,
    thresholdAdjustment: -0.01,
    reason: "positive_roi_and_hit_rate"
  };

  return {
    action: "ALLOW",
    multiplier: 1,
    thresholdAdjustment: 0,
    reason: "neutral"
  };
}

const report = read("outputs/phase5-master-validation-report.json", null);
if (!report) throw new Error("Missing outputs/phase5-master-validation-report.json. Run phase5-master-validation-report.cjs first.");

function buildRules(rows) {
  const out = {};
  for (const r of rows || []) {
    out[r.bucket] = {
      bucket: r.bucket,
      graded: r.graded,
      hitRate: r.hitRate,
      roi: r.roi,
      avgProb: r.avgProb,
      avgEdge: r.avgEdge,
      ...actionFor(r)
    };
  }
  return out;
}

const rules = {
  generatedAt: new Date().toISOString(),
  source: "outputs/phase5-master-validation-report.json",
  sampleWarning: report.gradedRows < 200
    ? "LOW_SAMPLE: rules are conservative until 200+ graded legs."
    : null,
  byMarket: buildRules(report.roi.byMarket),
  byMarketSide: buildRules(report.roi.byMarketSide),
  byProbabilityBucket: buildRules(report.roi.byProbabilityBucket),
  byEdgeBucket: buildRules(report.roi.byEdgeBucket),
  byConfidence: buildRules(report.roi.byConfidence)
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/phase6-adaptive-rules.json", JSON.stringify(rules, null, 2));

console.log("PHASE 6 ADAPTIVE RULES");
console.log("======================");
console.log("sample warning:", rules.sampleWarning || "none");

console.log("\nMarket side rules");
console.table(Object.values(rules.byMarketSide));

console.log("\nProbability rules");
console.table(Object.values(rules.byProbabilityBucket));

console.log("\nEdge rules");
console.table(Object.values(rules.byEdgeBucket));

console.log("Wrote data/learning/phase6-adaptive-rules.json");
