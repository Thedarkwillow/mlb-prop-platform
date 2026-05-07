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

function estimateRbisMean(leg) {
  const candidates = [
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection,
    leg.ballparkProjection,
    leg.sportsbookLine,
    leg.line
  ].map(Number).filter(Number.isFinite);

  let mean = candidates[0] || Number(leg.line) + 0.32;

  const savant = String(leg.savantReportGrade || leg.savant || "").toUpperCase();
  if (savant === "BOOST") mean += 0.13;
  if (savant === "DOWNGRADE") mean -= 0.11;

  return Math.max(0.05, mean);
}

function modelRbis(leg) {
  const mean = estimateRbisMean(leg);
  const probMore = poissonProbMore(mean, leg.line);
  return {
    market: "rbis",
    distribution: "poisson",
    mean: Number(mean.toFixed(3)),
    variance: Number(mean.toFixed(3)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number((1 - probMore).toFixed(4)),
    fairLine: Number(mean.toFixed(3)),
    confidence: mean >= 1.2 ? "HIGH" : "MEDIUM"
  };
}

module.exports = { modelRbis };
