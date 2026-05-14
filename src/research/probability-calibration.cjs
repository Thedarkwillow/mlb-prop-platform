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

  // Market rule is more specific, probability rule is broader.
  const adjustment = clamp((marketAdj * 0.65) + (probabilityAdj * 0.35), -0.05, 0.035);
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
      marketAdjustment: Number(marketAdj.toFixed(4)),
      probabilityAdjustment: Number(probabilityAdj.toFixed(4))
    }
  };
}

module.exports = {
  applyHistoricalCalibration
};
