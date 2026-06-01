function resolveDateArg() {
  const args = process.argv.slice(2);
  const dateEq = args.find(a => /^--date=/.test(a));
  if (dateEq) return dateEq.split("=")[1];
  const dateFlagIndex = args.findIndex(a => a === "--date");
  if (dateFlagIndex >= 0 && args[dateFlagIndex + 1]) return args[dateFlagIndex + 1];
  const positional = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  return (
    positional ||
    process.env.npm_config_date ||
    process.env.DATE ||
    new Date().toISOString().slice(0, 10)
  );
}

const fs = require("fs");

const DATE = resolveDateArg();

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const report = read(`outputs/shadow-roi-${DATE}.json`, read("outputs/shadow-roi-latest.json", null));
if (!report) {
  console.error("Missing shadow ROI report. Run npm run shadow:roi first.");
  process.exit(1);
}

const adjustments = {
  date: DATE,
  rules: []
};

for (const [bucket, x] of Object.entries(report.shadow.byMarketSide || {})) {
  if (!x || x.picks < 3) {
    adjustments.rules.push({
      bucket,
      action: "HOLD",
      reason: "insufficient_shadow_sample",
      picks: x?.picks || 0,
      hitRate: x?.hitRate ?? null,
      roi: x?.roi ?? null,
      thresholdAdjustment: 0,
      multiplier: 1
    });
    continue;
  }

  if (x.roi <= -0.15 || x.hitRate < 0.45) {
    adjustments.rules.push({
      bucket,
      action: "TIGHTEN",
      reason: "negative_shadow_roi",
      picks: x.picks,
      hitRate: x.hitRate,
      roi: x.roi,
      thresholdAdjustment: 0.02,
      multiplier: 0.9
    });
  } else if (x.roi >= 0.1 && x.hitRate >= 0.55) {
    adjustments.rules.push({
      bucket,
      action: "WATCH_BOOST",
      reason: "positive_shadow_roi",
      picks: x.picks,
      hitRate: x.hitRate,
      roi: x.roi,
      thresholdAdjustment: -0.01,
      multiplier: 1.03
    });
  } else {
    adjustments.rules.push({
      bucket,
      action: "HOLD",
      reason: "neutral_shadow_roi",
      picks: x.picks,
      hitRate: x.hitRate,
      roi: x.roi,
      thresholdAdjustment: 0,
      multiplier: 1
    });
  }
}

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(`data/learning/shadow-threshold-adjustments-${DATE}.json`, JSON.stringify(adjustments, null, 2));
fs.writeFileSync("data/learning/shadow-threshold-adjustments.json", JSON.stringify(adjustments, null, 2));

console.log(`SHADOW THRESHOLD ADJUSTMENTS ${DATE}`);
console.table(adjustments.rules);
