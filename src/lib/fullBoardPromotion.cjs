const fs = require("fs");

const PROMOTION_PATH = "data/learning/full-board-market-promotion.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normMarket(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function normSide(v) {
  const s = String(v || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function bucketFor(row) {
  return `${normMarket(row.market || row.stat)} ${normSide(row.side || row.recommendedSide)}`;
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
        reason: "no_full_board_signal"
      }
    };
  }

  const action = decision.action || "HOLD";
  const multiplier = capMultiplier(action, decision.multiplier);
  const thresholdAdjustment = capThreshold(action, decision.thresholdAdjustment);
  const originalScore = Number(row.finalScore ?? row.score);
  const adjustedScore = Number.isFinite(originalScore)
    ? Number((originalScore * multiplier).toFixed(6))
    : row.finalScore ?? row.score ?? null;

  return {
    ...row,
    finalScore: Number.isFinite(originalScore) ? adjustedScore : row.finalScore,
    score: Number.isFinite(Number(row.score)) ? Number((Number(row.score) * multiplier).toFixed(6)) : row.score,
    fullBoardPromotion: {
      bucket,
      action,
      applied: action !== "HOLD",
      multiplier,
      thresholdAdjustment,
      reason: decision.reason || null,
      count: decision.count ?? null,
      hitRate: decision.hitRate ?? null,
      roi: decision.roi ?? null
    }
  };
}

module.exports = {
  loadFullBoardPromotion,
  applyFullBoardPromotion
};
