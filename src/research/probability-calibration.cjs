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

function ruleAdjustment(rule, maxAbs) {
  if (!rule) return 0;

  const count = Number(rule.count || 0);
  const edge = Number(rule.calibrationEdge || 0);
  const direct = Number(rule.adjustment || 0);
  const action = String(rule.action || "").toLowerCase();

  if (count < 8 || action.includes("sample-too-small")) return 0;

  let adj = Number.isFinite(direct) ? direct : 0;

  // Convert calibration error into conservative probability shrink/boost.
  // Negative calibrationEdge means model is overconfident.
  if (count >= 15) adj += clamp(edge * 0.20, -maxAbs, maxAbs);
  else adj += clamp(edge * 0.10, -maxAbs / 2, maxAbs / 2);

  if (action.includes("medium") && edge < -0.10) adj -= 0.01;
  if (action.includes("large") && edge < -0.10) adj -= 0.02;

  return clamp(adj, -maxAbs, maxAbs);
}


function loadRollingRoi() {
  return readJson("data/results/rolling-roi-windows.json", null);
}

function findRollingBucket(report, windowKey, section, bucket) {
  const arr = report?.windows?.[windowKey]?.[section] || [];
  return arr.find(x => String(x.bucket || "").toLowerCase() === String(bucket || "").toLowerCase()) || null;
}

function rollingProbabilityAdjustment(leg = {}) {
  const report = loadRollingRoi();
  if (!report) {
    return {
      adjustment: 0,
      applied: false,
      reason: "no_rolling_roi_report",
      buckets: []
    };
  }

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
    let adj = 0;

    if (Number.isFinite(roi)) {
      if (roi <= -0.35) adj -= 0.035;
      else if (roi <= -0.20) adj -= 0.025;
      else if (roi < 0) adj -= 0.012;
      else if (roi >= 0.25 && Number.isFinite(hitRate) && hitRate >= 0.58) adj += 0.01;
    }

    if (Number.isFinite(hitRate) && hitRate < 0.45 && Number(row.count || 0) >= 5) {
      adj -= 0.015;
    }

    weighted += adj * c.weight;
    totalWeight += c.weight;

    buckets.push({
      window: c.window,
      bucket: marketSide,
      count: row.count,
      roi: row.roi,
      hitRate: row.hitRate,
      adjustment: Number(adj.toFixed(4))
    });
  }

  if (!totalWeight) {
    return {
      adjustment: 0,
      applied: false,
      reason: "insufficient_rolling_sample",
      buckets
    };
  }

  const adjustment = clamp(weighted / totalWeight, -0.035, 0.015);

  return {
    adjustment: Number(adjustment.toFixed(4)),
    applied: adjustment !== 0,
    reason: "rolling_roi",
    buckets
  };
}


function applyHistoricalCalibration(prob, leg = {}) {
  if (prob === null || prob === undefined || prob === "") {
    return {
      probability: prob,
      historicalCalibrationAdjustment: 0,
      historicalCalibration: {
        applied: false,
        reason: "no_probability"
      }
    };
  }

  const p = Number(prob);
  if (!Number.isFinite(p)) {
    return {
      probability: prob,
      historicalCalibrationAdjustment: 0,
      historicalCalibration: {
        applied: false,
        reason: "no_probability"
      }
    };
  }

  const rules = loadValidationRules();

  const market = normMarket(leg.market || leg.stat);
  const side = sideKey(leg);
  const marketBucket = `${market} ${side}`;
  const bucket = probBucket(p);

  const marketRule = findRule(rules, "market", marketBucket);
  const probabilityRule = findRule(rules, "probability", bucket);

  const marketAdj = ruleAdjustment(marketRule, 0.04);
  const probabilityAdj = ruleAdjustment(probabilityRule, 0.035);
  const rolling = rollingProbabilityAdjustment(leg);

  // Market rule is specific, probability rule is broad, rolling ROI adds recent-regime awareness.
  const adjustment = clamp(
    (marketAdj * 0.55) + (probabilityAdj * 0.30) + (rolling.adjustment * 0.15),
    -0.055,
    0.035
  );
  const probability = Number(clamp(p + adjustment, 0.02, 0.98).toFixed(4));

  return {
    probability,
    historicalCalibrationAdjustment: Number(adjustment.toFixed(4)),
    historicalCalibration: {
      applied: adjustment !== 0,
      marketBucket,
      probabilityBucket: bucket,
      marketRule: marketRule || null,
      probabilityRule: probabilityRule || null,
      rollingRoi: rolling,
      marketAdjustment: Number(marketAdj.toFixed(4)),
      probabilityAdjustment: Number(probabilityAdj.toFixed(4))
    }
  };
}

module.exports = {
  applyHistoricalCalibration
};
