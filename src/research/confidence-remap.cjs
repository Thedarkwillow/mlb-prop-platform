function num(x, fallback = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function normMarket(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function remapConfidence(leg = {}) {
  const market = normMarket(leg.market || leg.stat);
  const prob = num(leg.calibratedDistributionProb ?? leg.recommendedProb ?? leg.probability ?? leg.prob);
  const edge = num(leg.sportsbookAdjustedEdge ?? leg.adjustedEdge ?? leg.sportsbookEdge ?? leg.edge);
  const books = num(leg.sportsbookBookCount ?? leg.books, 0);
  const distributionConfidence = String(leg.distributionModel?.confidence || leg.distributionConfidence || "").toUpperCase();

  const validation = leg.validationRule || {};
  const edgeShrink = leg.historicalEdgeShrinkage || {};
  const volatility = leg.volatilityAdjustment || {};
  const marketRule = validation.marketRule || null;
  const probRule = validation.probabilityRule || null;

  const notes = [];
  let score = 0;

  if (prob == null) {
    return {
      confidence: "unmodeled",
      score: 0,
      notes: ["no calibrated probability"]
    };
  }

  if (prob >= 0.72) score += 3;
  else if (prob >= 0.66) score += 2;
  else if (prob >= 0.60) score += 1;
  else if (prob < 0.55) score -= 2;

  if (edge != null && edge >= 0.18) score += 2;
  else if (edge != null && edge >= 0.10) score += 1;
  else if (edge != null && edge < 0.06) score -= 1;

  if (books >= 5) score += 1;
  else if (books <= 1) score -= 2;

  if (distributionConfidence === "HIGH") score += 1;
  if (distributionConfidence === "LOW") score -= 1;

  const marketActual = num(marketRule?.actual);
  const marketCount = num(marketRule?.count, 0);
  const marketCalEdge = num(marketRule?.calibrationEdge);

  if (marketRule && marketCount >= 20 && marketActual != null) {
    if (marketActual >= 0.58) {
      score += 1;
      notes.push("market validated");
    }
    if (marketActual < 0.50) {
      score -= 2;
      notes.push("market underperforming");
    }
  }

  if (probRule) {
    const probCalEdge = num(probRule.calibrationEdge);
    const probCount = num(probRule.count, 0);
    if (probCount >= 15 && probCalEdge != null && probCalEdge <= -0.12) {
      score -= 1;
      notes.push("probability bucket overconfident");
    }
  }

  const edgeMultiplier = num(edgeShrink.historicalEdgeMultiplier, 1);
  if (edgeMultiplier < 0.90) {
    score -= 1;
    notes.push("edge shrunk by history");
  }

  if (Number(volatility.penalty || 0) < 0) {
    score -= 1;
    notes.push(`${volatility.volatility || "volatile"} volatility`);
  }

  if (market === "runs" || market === "rbis" || market === "home_runs") {
    score -= 1;
    notes.push("volatile market");
  }

  if (leg.finalMarketGatePassed === false) {
    score -= 2;
    notes.push("failed final market gate");
  }

  let confidence = "weak";
  if (score >= 6) confidence = "elite";
  else if (score >= 4) confidence = "strong";
  else if (score >= 2) confidence = "playable";
  else if (score >= 0) confidence = "watchlist";

  return {
    confidence,
    score,
    notes
  };
}

module.exports = {
  remapConfidence
};
