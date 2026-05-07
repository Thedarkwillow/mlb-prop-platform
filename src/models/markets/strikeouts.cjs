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
  const maxK = Math.floor(Number(line));
  let cdf = 0;
  for (let k = 0; k <= maxK; k++) cdf += poissonPmf(k, lambda);
  return Math.max(0, Math.min(1, 1 - cdf));
}

function poissonProbLess(lambda, line) {
  return Math.max(0, Math.min(1, 1 - poissonProbMore(lambda, line)));
}

function estimateStrikeoutMean(leg) {
  const vals = [
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection,
    leg.ballparkProjection,
    leg.line
  ];

  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

function modelStrikeouts(leg) {
  const line = Number(leg.line);
  const mean = estimateStrikeoutMean(leg);

  if (!Number.isFinite(line) || !Number.isFinite(mean)) {
    return {
      market: "strikeouts",
      distribution: "poisson",
      mean: null,
      variance: null,
      probMore: null,
      probLess: null,
      fairLine: null,
      confidence: "LOW"
    };
  }

  const probMore = Number(poissonProbMore(mean, line).toFixed(4));
  const probLess = Number(poissonProbLess(mean, line).toFixed(4));

  return {
    market: "strikeouts",
    distribution: "poisson",
    mean: Number(mean.toFixed(3)),
    variance: Number(mean.toFixed(3)),
    probMore,
    probLess,
    fairLine: Number(mean.toFixed(2)),
    confidence: "MEDIUM"
  };
}

module.exports = {
  modelStrikeouts,
  poissonPmf,
  poissonProbMore,
  poissonProbLess
};
