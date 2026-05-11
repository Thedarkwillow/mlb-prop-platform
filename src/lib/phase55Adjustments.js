import fs from "fs";

const MODEL_PATH = "data/model/phase55-risk-calibration.json";

function readModel() {
  if (!fs.existsSync(MODEL_PATH)) return null;
  return JSON.parse(fs.readFileSync(MODEL_PATH, "utf8"));
}

function normMarket(v) {
  return String(v || "unknown").toLowerCase().trim();
}

function normSide(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "UNKNOWN";
}

function bucketProb(p) {
  if (p >= 0.80) return "80+";
  if (p >= 0.75) return "75-79";
  if (p >= 0.70) return "70-74";
  if (p >= 0.65) return "65-69";
  if (p >= 0.60) return "60-64";
  return "<60";
}

export function applyPhase55RiskAdjustments(row) {
  const model = readModel();
  if (!model) return row;

  const market = normMarket(row.market ?? row.statType ?? row.stat ?? row.projectionType);
  const side = normSide(row.side ?? row.pick ?? row.direction);
  const marketSideKey = `${market}:${side}`;

  let probability = Number(row.probability ?? row.prob ?? row.modelProbability ?? 0);
  let confidence = String(row.confidence ?? row.confidenceTier ?? "unknown");

  const reasons = [];

  const probBucket = bucketProb(probability);
  const remap = model.confidenceRemap?.[probBucket];

  if (remap?.multiplier) {
    probability *= remap.multiplier;
    reasons.push(`confidence_remap_${probBucket}_${remap.multiplier}`);
  }

  const trust = model.marketTrust?.[market] ?? 0.5;
  const trustPenalty = 1 - Math.max(0, 0.5 - trust) * 0.35;

  probability *= trustPenalty;

  if (trust < 0.45) {
    reasons.push(`low_market_trust_${trust}`);
  }

  const volRule = model.volatilityRules?.[market];
  if (volRule?.basePenalty) {
    probability -= volRule.basePenalty;
    reasons.push(`volatility_penalty_${volRule.basePenalty}`);
  }

  const marketSuppression = model.marketSuppression?.[market];
  const sideSuppression = model.marketSideSuppression?.[marketSideKey];

  let suppressed = false;

  for (const level of [marketSuppression, sideSuppression]) {
    if (level === "hard_suppress") {
      probability -= 0.12;
      confidence = "suppressed";
      suppressed = true;
      reasons.push("hard_suppress");
    } else if (level === "soft_suppress") {
      probability -= 0.06;
      if (confidence === "elite") confidence = "strong";
      if (confidence === "strong") confidence = "standard";
      reasons.push("soft_suppress");
    } else if (level === "watch") {
      probability -= 0.025;
      reasons.push("watch_market");
    }
  }

  probability = Math.max(0.01, Math.min(0.99, +probability.toFixed(4)));

  return {
    ...row,
    probability,
    prob: probability,
    confidence,
    phase55: {
      applied: true,
      marketTrust: trust,
      marketSuppression,
      sideSuppression,
      suppressed,
      reasons
    }
  };
}
