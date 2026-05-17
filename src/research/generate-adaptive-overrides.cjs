const fs = require("fs");
const path = require("path");

const INPUT = "data/learning/blocked-prop-learning.json";
const OUTPUT = "data/learning/adaptive-overrides.json";

const MIN_SAMPLES = Number(process.env.ADAPTIVE_MIN_SAMPLES || 3);
const MIN_ROI = Number(process.env.ADAPTIVE_MIN_ROI || 0.05);
const MIN_HITRATE = Number(process.env.ADAPTIVE_MIN_HITRATE || 0.55);

function read(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function addRulesFromBucketGroup(rules, groupName, buckets) {
  for (const [bucket, stats] of Object.entries(buckets || {})) {
    const graded = Number(stats.graded || 0);
    const hitRate = Number(stats.hitRate || 0);
    const roi = Number(stats.roi || 0);

    if (graded < MIN_SAMPLES) continue;
    if (hitRate < MIN_HITRATE) continue;
    if (roi < MIN_ROI) continue;

    rules.push({
      source: groupName,
      bucket,
      graded,
      hitRate,
      roi,
      action: "UNBLOCK",
      reason: "positive_blocked_prop_learning"
    });
  }
}

function main() {
  const data = read(INPUT, {});
  const rules = [];

  // Only market/side/tier rules are safe enough for automatic unblocking.
  // Reason and score-bucket rules are tracked but too broad for live slip inclusion.
  addRulesFromBucketGroup(rules, "byMarketSideTier", data.byMarketSideTier);

  const output = {
    last_updated: new Date().toISOString(),
    thresholds: {
      minSamples: MIN_SAMPLES,
      minHitRate: MIN_HITRATE,
      minRoi: MIN_ROI
    },
    rules
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));

  console.log("ADAPTIVE OVERRIDES GENERATED");
  console.log("rules:", rules.length);
  console.table(rules);
}

main();
