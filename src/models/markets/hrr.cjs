function clamp(x, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(x)));
}

function poissonPmf(k, lambda) {
  let out = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) out *= lambda / i;
  return out;
}

function poissonProbMore(lambda, line) {
  const floor = Math.floor(Number(line));
  let cdf = 0;
  for (let k = 0; k <= floor; k++) cdf += poissonPmf(k, lambda);
  return clamp(1 - cdf);
}

function poissonProbLess(lambda, line) {
  return clamp(1 - poissonProbMore(lambda, line));
}

function estimateHrrMean(leg) {
  const direct = [
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection
  ].map(Number).find(Number.isFinite);

  if (Number.isFinite(direct)) return direct;

  const line = Number(leg.line);
  const prob = Number(leg.recommendedProb);

  if (!Number.isFinite(line) || !Number.isFinite(prob)) return null;

  let mean = line + (prob - 0.5) * 2.2;

  if (leg.savantReportGrade === "BOOST") mean += 0.12;
  if (leg.savantReportGrade === "DOWNGRADE") mean -= 0.12;

  return Math.max(0.05, mean);
}

function modelHrr(leg) {
  const line = Number(leg.line);
  const mean = estimateHrrMean(leg);

  if (!Number.isFinite(line) || !Number.isFinite(mean)) {
    return {
      market: "hrr",
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
  const probLess = poissonProbLess(mean, line);

  return {
    market: "hrr",
    distribution: "poisson",
    mean: Number(mean.toFixed(4)),
    variance: Number(mean.toFixed(4)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: Number(mean.toFixed(2)),
    confidence:
      Math.max(probMore, probLess) >= 0.7 ? "HIGH" :
      Math.max(probMore, probLess) >= 0.58 ? "MEDIUM" :
      "LOW"
  };
}

module.exports = {
  modelHrr
};
