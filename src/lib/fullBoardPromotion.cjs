const fs = require("fs");

const PROMOTION_PATH = "data/learning/full-board-market-promotion.json";
const MIN_PROMOTION_SAMPLE = 100;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanMarket(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/plate_appearances(_plate_appearances)+/g, "plate_appearances")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim();
}

function normSide(v) {
  const s = String(v || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function bucketFor(row) {
  return `${cleanMarket(row.market || row.stat)} ${normSide(row.side || row.recommendedSide)}`;
}

function loadFullBoardPromotion() {
  const data = read(PROMOTION_PATH, {});
  const decisions = Array.isArray(data.decisions) ? data.decisions : [];
  const byBucket = new Map();

  for (const d of decisions) {
    if (!d || !d.bucket) continue;
    byBucket.set(String(d.bucket).toLowerCase(), d);
  }

  return byBucket;
}

function gatedAction(decision) {
  const count = Number(decision?.count || 0);
  if (count < MIN_PROMOTION_SAMPLE) return "HOLD";
  return decision?.action || "HOLD";
}

function capMultiplier(action, multiplier) {
  const m = Number(multiplier);
  if (!Number.isFinite(m)) return 1;
  if (action === "WATCH_BOOST") return Math.min(1.03, Math.max(1, m));
  if (action === "TIGHTEN") return Math.max(0.9, Math.min(1, m));
  return 1;
}

function capThreshold(action, adjustment) {
  const a = Number(adjustment);
  if (!Number.isFinite(a)) return 0;
  if (action === "WATCH_BOOST") return Math.max(-0.01, Math.min(0, a));
  if (action === "TIGHTEN") return Math.min(0.02, Math.max(0, a));
  return 0;
}

function adjustNumber(value, delta, min = -Infinity, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Number(Math.min(max, Math.max(min, n + delta)).toFixed(6));
}

function applyFullBoardPromotion(row, promotionMap = loadFullBoardPromotion()) {
  const bucket = bucketFor(row).toLowerCase();
  const decision = promotionMap.get(bucket);

  if (!decision) {
    return {
      ...row,
      fullBoardPromotion: {
        bucket,
        action: "NONE",
        applied: false,
        multiplier: 1,
        thresholdAdjustment: 0,
        reason: "no_full_board_signal",
        count: null,
        hitRate: null,
        roi: null
      }
    };
  }

  const rawAction = decision.action || "HOLD";
  const action = gatedAction(decision);
  const gated = rawAction !== action;
  const multiplier = capMultiplier(action, decision.multiplier);
  const thresholdAdjustment = capThreshold(action, decision.thresholdAdjustment);

  const prePromotionScore = Number(row.finalScore ?? row.score);
  const postPromotionScore = Number.isFinite(prePromotionScore)
    ? Number((prePromotionScore * multiplier).toFixed(6))
    : row.finalScore ?? row.score ?? null;

  const probDelta = action === "WATCH_BOOST" ? 0.005 : action === "TIGHTEN" ? -0.005 : 0;
  const edgeDelta = action === "WATCH_BOOST" ? 0.01 : action === "TIGHTEN" ? -0.01 : 0;

  const out = {
    ...row,
    market: cleanMarket(row.market || row.stat),
    prePromotionScore: Number.isFinite(prePromotionScore) ? prePromotionScore : null,
    postPromotionScore,
    promotionDelta: Number.isFinite(prePromotionScore) && Number.isFinite(Number(postPromotionScore))
      ? Number((Number(postPromotionScore) - prePromotionScore).toFixed(6))
      : 0,
    calibratedDistributionProb: adjustNumber(row.calibratedDistributionProb, probDelta, 0.01, 0.99),
    edge: adjustNumber(row.edge, edgeDelta),
    adjustedEdge: adjustNumber(row.adjustedEdge, edgeDelta),
    fullBoardPromotion: {
      bucket,
      rawAction,
      action,
      applied: action !== "HOLD",
      gated,
      multiplier,
      thresholdAdjustment,
      reason: gated ? "low_sample_size" : decision.reason || null,
      count: decision.count ?? null,
      hitRate: decision.hitRate ?? null,
      roi: decision.roi ?? null,
      probDelta,
      edgeDelta
    }
  };

  if (Number.isFinite(prePromotionScore)) {
    out.finalScore = postPromotionScore;
    if (Number.isFinite(Number(row.score))) {
      out.score = Number((Number(row.score) * multiplier).toFixed(6));
    }
  }

  return out;
}

module.exports = {
  cleanMarket,
  loadFullBoardPromotion,
  applyFullBoardPromotion
};
