const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function normMarket(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function sideKey(x = {}) {
  return String(x.side || x.recommendedSide || "").toUpperCase();
}

function probBucket(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p)) return null;
  const lo = Math.floor(p * 20) / 20;
  const hi = lo + 0.05;
  return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
}

function loadValidationRules() {
  const raw = readJson("data/results/validation-rules.json", []);
  if (Array.isArray(raw)) return raw;

  return [
    ...(raw.byProbability || []),
    ...(raw.byMarket || []),
    ...(raw.byBooks || [])
  ];
}

function findRule(rules, type, bucket) {
  return rules.find(r =>
    String(r.type || "").toLowerCase() === String(type || "").toLowerCase() &&
    String(r.bucket || "").toLowerCase() === String(bucket || "").toLowerCase()
  ) || null;
}

function shrinkFromRule(rule) {
  if (!rule) return 1;

  const count = Number(rule.count || 0);
  const calibrationEdge = Number(rule.calibrationEdge || 0);
  const actual = Number(rule.actual);
  const action = String(rule.action || "").toLowerCase();

  if (count < 8 || action.includes("sample-too-small")) return 1;

  let multiplier = 1;

  // Overconfident bucket/market: shrink edge.
  if (calibrationEdge <= -0.20) multiplier *= 0.75;
  else if (calibrationEdge <= -0.12) multiplier *= 0.85;
  else if (calibrationEdge <= -0.07) multiplier *= 0.92;

  // Under 50% actual on meaningful sample gets extra shrink.
  if (count >= 20 && Number.isFinite(actual) && actual < 0.50) multiplier *= 0.85;

  // Avoid aggressive punishment on light sample.
  if (count < 15) multiplier = Math.max(multiplier, 0.90);

  return clamp(multiplier, 0.55, 1.05);
}


function loadRollingRoi() {
  return readJson("data/results/rolling-roi-windows.json", null);
}

function findRollingBucket(report, windowKey, section, bucket) {
  const arr = report?.windows?.[windowKey]?.[section] || [];
  return arr.find(x => String(x.bucket || "").toLowerCase() === String(bucket || "").toLowerCase()) || null;
}

function rollingRoiMultiplier(leg = {}) {
  const report = loadRollingRoi();
  if (!report) return {
    multiplier: 1,
    buckets: [],
    applied: false,
    reason: "no_rolling_roi_report"
  };

  const market = normMarket(leg.market || leg.stat);
  const side = sideKey(leg);
  const marketSide = `${market} ${side}`;

  const checks = [
    { window: "7d", weight: 0.50 },
    { window: "15d", weight: 0.30 },
    { window: "30d", weight: 0.20 }
  ];

  let weighted = 0;
  let totalWeight = 0;
  const buckets = [];

  for (const c of checks) {
    const row = findRollingBucket(report, c.window, "byMarketSide", marketSide);
    if (!row || Number(row.count || 0) < 3) continue;

    const roi = Number(row.roi);
    const hitRate = Number(row.hitRate);
    let mult = 1;

    if (Number.isFinite(roi)) {
      if (roi <= -0.35) mult *= 0.70;
      else if (roi <= -0.20) mult *= 0.80;
      else if (roi < 0) mult *= 0.92;
      else if (roi >= 0.25 && hitRate >= 0.58) mult *= 1.03;
    }

    if (Number.isFinite(hitRate) && hitRate < 0.45 && Number(row.count || 0) >= 5) {
      mult *= 0.88;
    }

    weighted += mult * c.weight;
    totalWeight += c.weight;
    buckets.push({
      window: c.window,
      bucket: marketSide,
      count: row.count,
      roi: row.roi,
      hitRate: row.hitRate,
      multiplier: Number(mult.toFixed(4))
    });
  }

  if (!totalWeight) {
    return {
      multiplier: 1,
      buckets,
      applied: false,
      reason: "insufficient_rolling_sample"
    };
  }

  const multiplier = clamp(weighted / totalWeight, 0.60, 1.04);

  return {
    multiplier: Number(multiplier.toFixed(4)),
    buckets,
    applied: multiplier !== 1,
    reason: "rolling_roi"
  };
}


function applyHistoricalEdgeShrinkage(edge, leg = {}) {
  const e = Number(edge);
  if (!Number.isFinite(e)) {
    return {
      edge,
      historicalEdgeMultiplier: 1,
      historicalEdgeAdjustment: 0,
      historicalEdgeShrinkage: {
        applied: false,
        reason: "no_edge"
      }
    };
  }

  const rules = loadValidationRules();

  const market = normMarket(leg.market || leg.stat);
  const side = sideKey(leg);
  const prob = Number(leg.calibratedDistributionProb ?? leg.recommendedProb ?? leg.probability ?? leg.prob);

  const marketBucket = `${market} ${side}`;
  const bucket = probBucket(prob);

  const marketRule = findRule(rules, "market", marketBucket);
  const probabilityRule = findRule(rules, "probability", bucket);

  const marketMult = shrinkFromRule(marketRule);
  const probabilityMult = shrinkFromRule(probabilityRule);
  const rolling = rollingRoiMultiplier(leg);

  // Market/side is most specific, probability bucket is broad, rolling ROI adds recent-regime awareness.
  const baseMultiplier = (marketMult * 0.60) + (probabilityMult * 0.25) + (rolling.multiplier * 0.15);
  const multiplier = clamp(baseMultiplier, 0.55, 1.05);
  const shrunkEdge = Number((e * multiplier).toFixed(4));

  return {
    edge: shrunkEdge,
    historicalEdgeMultiplier: Number(multiplier.toFixed(4)),
    historicalEdgeAdjustment: Number((shrunkEdge - e).toFixed(4)),
    historicalEdgeShrinkage: {
      applied: multiplier !== 1,
      marketBucket,
      probabilityBucket: bucket,
      marketRule: marketRule || null,
      probabilityRule: probabilityRule || null,
      rollingRoi: rolling,
      marketMultiplier: Number(marketMult.toFixed(4)),
      probabilityMultiplier: Number(probabilityMult.toFixed(4))
    }
  };
}

module.exports = {
  applyHistoricalEdgeShrinkage
};
