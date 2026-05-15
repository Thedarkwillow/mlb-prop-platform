const fs = require("fs");

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const RULES = read("data/learning/phase6-adaptive-rules.json", {});

function normalizedMarket(x) {
  return String(x.market || x.stat || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function sideKey(x) {
  return String(x.side || x.recommendedSide || "").toUpperCase();
}

function marketSideKey(x) {
  return `${normalizedMarket(x)}_${sideKey(x)}`;
}
function oddsTier(x) {
  return String(x.oddsTier || x.tier || "standard").toLowerCase().trim();
}
function marketSideTierKey(x) {
  return `${marketSideKey(x)}_${oddsTier(x)}`;
}

function probBucket(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p)) return "unknown";
  if (p < 0.55) return "<55";
  if (p < 0.60) return "55-60";
  if (p < 0.65) return "60-65";
  if (p < 0.70) return "65-70";
  if (p < 0.75) return "70-75";
  return "75+";
}

function edgeBucket(edge) {
  const e = Number(edge);
  if (!Number.isFinite(e)) return "unknown";
  if (e < 0.05) return "<5%";
  if (e < 0.10) return "5-10%";
  if (e < 0.15) return "10-15%";
  return "15%+";
}

function rulesFor(x, prob) {
  const edge = Number(x.sportsbookAdjustedEdge ?? x.adjustedEdge ?? x.sportsbookEdge ?? x.edge);
  const market = normalizedMarket(x);
  const marketSide = marketSideKey(x);
  const marketSideTier = marketSideTierKey(x);
  const pBucket = probBucket(prob);
  const eBucket = edgeBucket(edge);

  return [
    RULES.byMarket?.[market],
    RULES.byMarketSideTier?.[marketSideTier],
    RULES.byMarketSide?.[marketSide],
    RULES.byProbabilityBucket?.[pBucket],
    RULES.byEdgeBucket?.[eBucket]
  ].filter(Boolean);
}

function rulePressure(rule) {
  const action = String(rule?.action || "").toUpperCase();
  if (action === "TIGHTEN") return -0.08;
  if (action === "DOWNWEIGHT") return -0.04;
  if (action === "BOOST") return 0.025;
  return 0;
}

function applyPhase6ProbabilityFeedback(probability, leg) {
  const p = Number(probability);
  if (!Number.isFinite(p)) {
    return {
      probability,
      phase6ProbabilityFeedback: {
        applied: false,
        adjustment: 0,
        reason: "invalid_probability",
        rules: []
      }
    };
  }

  const rules = rulesFor(leg, p);
  const rawPressure = rules.reduce((sum, r) => sum + rulePressure(r), 0);

  // Low sample: keep very conservative.
  const sampleScale = RULES.sampleWarning ? 0.5 : 1;
  const cappedPressure = Math.max(-0.06, Math.min(0.03, rawPressure * sampleScale));

  // Move away/toward 50%, not a flat additive bump.
  const distance = p - 0.5;
  let adjusted = p;

  if (cappedPressure < 0) {
    adjusted = 0.5 + distance * (1 + cappedPressure);
  } else if (cappedPressure > 0) {
    adjusted = 0.5 + distance * (1 + cappedPressure);
  }

  adjusted = Math.max(0.02, Math.min(0.98, adjusted));

  return {
    probability: Number(adjusted.toFixed(4)),
    phase6ProbabilityFeedback: {
      applied: Number(adjusted.toFixed(4)) !== Number(p.toFixed(4)),
      originalProbability: Number(p.toFixed(4)),
      adjustedProbability: Number(adjusted.toFixed(4)),
      adjustment: Number((adjusted - p).toFixed(4)),
      pressure: Number(cappedPressure.toFixed(4)),
      rules: rules.map(r => ({
        bucket: r.bucket,
        action: r.action,
        multiplier: r.multiplier,
        thresholdAdjustment: r.thresholdAdjustment,
        graded: r.graded,
        hitRate: r.hitRate,
        roi: r.roi,
        reason: r.reason
      }))
    }
  };
}

module.exports = {
  applyPhase6ProbabilityFeedback
};
