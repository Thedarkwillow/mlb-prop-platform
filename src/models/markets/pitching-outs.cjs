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

function estimatePitchingOutsMean(leg) {
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
  if (savant === "BOOST") mean += 0.35;
  if (savant === "DOWNGRADE") mean -= 0.35;

  return Math.max(3, Math.min(24, mean));
}

function modelPitchingOuts(leg) {
  const mean = estimatePitchingOutsMean(leg);
  const line = Number(leg.line);

  if (!Number.isFinite(mean) || !Number.isFinite(line)) {
    return {
      market: "pitching_outs",
      distribution: "poisson",
      mean: null,
      variance: null,
      probMore: null,
      probLess: null,
      fairLine: null,
      confidence: "UNKNOWN"
    };
  }

  const probMore = poissonProbMore(mean, line);
  const probLess = 1 - probMore;

  return {
    market: "pitching_outs",
    distribution: "poisson",
    mean: Number(mean.toFixed(3)),
    variance: Number(mean.toFixed(3)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: Number(mean.toFixed(3)),
    confidence:
      Math.max(probMore, probLess) >= 0.7 ? "HIGH" :
      Math.max(probMore, probLess) >= 0.58 ? "MEDIUM" :
      "LOW"
  };
}

module.exports = { modelPitchingOuts };
