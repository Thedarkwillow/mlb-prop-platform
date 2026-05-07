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

function estimateEarnedRunsAllowedMean(leg) {
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

  let mean = candidates[0] || Number(leg.line);
  const savant = String(leg.savantReportGrade || leg.savant || "").toUpperCase();

  if (savant === "BOOST") mean *= 0.92;
  if (savant === "DOWNGRADE") mean *= 1.08;

  mean = Math.max(0.4, Math.min(7.5, mean));

  return Number(mean.toFixed(3));
}

function modelEarnedRunsAllowed(leg) {
  const mean = estimateEarnedRunsAllowedMean(leg);
  const probMore = poissonProbMore(mean, leg.line);
  const probLess = 1 - probMore;

  return {
    market: "earned_runs_allowed",
    distribution: "poisson",
    mean,
    variance: mean,
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: mean,
    confidence: mean >= 1 ? "MEDIUM" : "LOW"
  };
}

module.exports = { modelEarnedRunsAllowed };
