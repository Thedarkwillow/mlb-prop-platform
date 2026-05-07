function factorial(n) {
  if (n <= 1) return 1;
  let out = 1;
  for (let i = 2; i <= n; i++) out *= i;
  return out;
}

function poissonPmf(k, lambda) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function poissonProbMore(lambda, line) {
  const floor = Math.floor(Number(line));
  let cdf = 0;
  for (let k = 0; k <= floor; k++) cdf += poissonPmf(k, lambda);
  return Math.max(0, Math.min(1, 1 - cdf));
}

function poissonProbLess(lambda, line) {
  return 1 - poissonProbMore(lambda, line);
}

function estimateStrikeoutMean(leg) {
  const candidates = [
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection,
    leg.ballparkProjection,
    leg.line
  ];

  for (const x of candidates) {
    const n = Number(x);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

function modelStrikeouts(leg) {
  const mean = estimateStrikeoutMean(leg);
  const line = Number(leg.line);

  if (!Number.isFinite(mean) || !Number.isFinite(line)) {
    return {
      market: "strikeouts",
      distribution: "poisson",
      mean: null,
      variance: null,
      probMore: null,
      probLess: null,
      fairLine: null,
      confidence: "UNKNOWN"
    };
  }

  const probMore = Number(poissonProbMore(mean, line).toFixed(4));
  const probLess = Number(poissonProbLess(mean, line).toFixed(4));

  return {
    market: "strikeouts",
    distribution: "poisson",
    mean: Number(mean.toFixed(4)),
    variance: Number(mean.toFixed(4)),
    probMore,
    probLess,
    fairLine: Number(mean.toFixed(2)),
    confidence:
      Math.max(probMore, probLess) >= 0.65 ? "HIGH" :
      Math.max(probMore, probLess) >= 0.58 ? "MEDIUM" :
      "LOW"
  };
}

module.exports = {
  modelStrikeouts,
  poissonProbMore,
  poissonProbLess
};
