const fs = require("fs");

const PLAYABLE_MARKETS = new Set([
  "strikeouts",
  "pitching_outs",
  "hits_allowed",
  "earned_runs_allowed",
  "walks_allowed",
  "hits",
  "bases",
  "hrr",
  "runs",
  "rbis",
  "walks",
  "singles",
  "home_runs",
  "hr"
]);

function marketFromBucket(bucket) {
  return String(bucket || "").split(/\s+/)[0].trim().toLowerCase();
}

const MIN_SAMPLE = 25;
const BOOST_HIT_RATE = 0.58;
const BOOST_ROI = 0.08;
const TIGHTEN_HIT_RATE = 0.48;
const TIGHTEN_ROI = -0.08;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function decide(bucket, row) {
  const count = Number(row.count || 0);
  const hitRate = Number(row.hitRate);
  const roi = Number(row.roi);

  if (count < MIN_SAMPLE) {
    return {
      bucket,
      action: "HOLD",
      reason: "insufficient_full_board_sample",
      thresholdAdjustment: 0,
      multiplier: 1,
      ...row
    };
  }

  if (hitRate >= BOOST_HIT_RATE && roi >= BOOST_ROI) {
    return {
      bucket,
      action: "WATCH_BOOST",
      reason: "positive_full_board_baseline",
      thresholdAdjustment: -0.01,
      multiplier: 1.03,
      ...row
    };
  }

  if (hitRate <= TIGHTEN_HIT_RATE || roi <= TIGHTEN_ROI) {
    return {
      bucket,
      action: "TIGHTEN",
      reason: "negative_full_board_baseline",
      thresholdAdjustment: 0.02,
      multiplier: 0.9,
      ...row
    };
  }

  return {
    bucket,
    action: "HOLD",
    reason: "neutral_full_board_baseline",
    thresholdAdjustment: 0,
    multiplier: 1,
    ...row
  };
}

const learning = read("data/learning/full-board-market-learning.json", {});
const marketSide = learning.byMarketSide || {};

const rawDecisions = Object.entries(marketSide)
  .map(([bucket, row]) => decide(bucket, row));

const excluded = rawDecisions
  .filter(d => !PLAYABLE_MARKETS.has(marketFromBucket(d.bucket)))
  .map(d => ({
    bucket: d.bucket,
    action: "EXCLUDED",
    reason: "market_not_approved_for_playable_promotion",
    count: d.count,
    hitRate: d.hitRate,
    roi: d.roi
  }));

const decisions = rawDecisions
  .filter(d => PLAYABLE_MARKETS.has(marketFromBucket(d.bucket)))
  .sort((a, b) => {
    const order = { WATCH_BOOST: 0, TIGHTEN: 1, HOLD: 2 };
    return (order[a.action] ?? 9) - (order[b.action] ?? 9) || b.count - a.count;
  });

const out = {
  generatedAt: new Date().toISOString(),
  source: "full_board_clean_consensus",
  mode: "learning_only",
  note: "Soft promotion/suppression recommendations only. Do not override playable gates from this file alone.",
  rules: {
    minSample: MIN_SAMPLE,
    boostHitRate: BOOST_HIT_RATE,
    boostRoi: BOOST_ROI,
    tightenHitRate: TIGHTEN_HIT_RATE,
    tightenRoi: TIGHTEN_ROI,
    maxBoostMultiplier: 1.03,
    maxThresholdRelax: -0.01,
    tightenMultiplier: 0.9,
    tightenThreshold: 0.02
  },
  approvedMarkets: [...PLAYABLE_MARKETS],
  excluded,
  decisions
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/full-board-market-promotion.json", JSON.stringify(out, null, 2));

console.log("FULL BOARD MARKET PROMOTION");
console.table(decisions.slice(0, 30).map(d => ({
  bucket: d.bucket,
  action: d.action,
  reason: d.reason,
  count: d.count,
  hitRate: d.hitRate,
  roi: d.roi,
  thresholdAdjustment: d.thresholdAdjustment,
  multiplier: d.multiplier
})));
console.log("Wrote data/learning/full-board-market-promotion.json");
