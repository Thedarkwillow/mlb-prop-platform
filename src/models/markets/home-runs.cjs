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

function estimateHomeRunsMean(leg) {
  const candidates = [
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection,
    leg.ballparkProjection,
    leg.sportsbookLine
  ].map(Number).filter(Number.isFinite);

  let mean = candidates[0] || 0.18;

  const savant = String(leg.savantReportGrade || leg.savant || "").toUpperCase();

  if (savant === "BOOST") mean *= 1.22;
  if (savant === "DOWNGRADE") mean *= 0.82;

  return Math.max(0.02, Math.min(1.25, mean));
}

function modelHomeRuns(leg) {
  const mean = estimateHomeRunsMean(leg);
  const probMore = poissonProbMore(mean, leg.line);
  const probLess = 1 - probMore;

  return {
    market: "home_runs",
    distribution: "poisson",
    mean: Number(mean.toFixed(3)),
    variance: Number(mean.toFixed(3)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: Number(mean.toFixed(3)),
    confidence:
      Math.max(probMore, probLess) >= 0.62 ? "HIGH" :
      Math.max(probMore, probLess) >= 0.56 ? "MEDIUM" :
      "LOW"
  };
}

module.exports = { modelHomeRuns };
