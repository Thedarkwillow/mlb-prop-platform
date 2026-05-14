function poissonPmf(k, lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  let p = Math.exp(-lambda);
  if (k === 0) return p;
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function poissonProbMore(lambda, line) {
  const floor = Math.floor(Number(line));
  let cdf = 0;
  for (let k = 0; k <= floor; k++) cdf += poissonPmf(k, lambda);
  return Math.max(0, Math.min(1, 1 - cdf));
}

function estimateWalksMean(leg) {
  const candidates = [
    leg.walksProjection,
    leg.walkProjection,
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection,
    leg.ballparkProjection
  ].map(Number).filter(Number.isFinite);

  let mean = candidates[0];

  if (!Number.isFinite(mean)) {
    const line = Number(leg.line);
    mean = Number.isFinite(line) ? Math.max(0.22, line + 0.02) : 0.34;
  }

  const savant = String(leg.savantReportGrade || leg.savant || "").toUpperCase();

  // Better hitter quality usually means more walks.
  if (savant === "BOOST") mean += 0.035;
  if (savant === "DOWNGRADE") mean -= 0.035;

  return Math.max(0.05, mean);
}

function modelWalks(leg) {
  const mean = estimateWalksMean(leg);
  const line = Number(leg.line);
  const probMore = poissonProbMore(mean, line);
  const probLess = 1 - probMore;
  const best = Math.max(probMore, probLess);

  return {
    market: "walks",
    distribution: "poisson_walks_v1",
    mean: Number(mean.toFixed(3)),
    variance: Number(mean.toFixed(3)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: Number(mean.toFixed(3)),
    confidence:
      best >= 0.68 ? "HIGH" :
      best >= 0.58 ? "MEDIUM" :
      "LOW"
  };
}

module.exports = { modelWalks };
