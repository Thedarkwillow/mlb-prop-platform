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

function estimateSinglesMean(leg) {
  const candidates = [
    leg.singlesProjection,
    leg.singleProjection,
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection,
    leg.ballparkProjection
  ].map(Number).filter(Number.isFinite);

  let mean = candidates[0];

  if (!Number.isFinite(mean)) {
    const hitsLike = Number(
      leg.hitsProjection ??
      leg.hitProjection ??
      leg.projectedHits ??
      leg.projection ??
      leg.recommendedProjection
    );

    if (Number.isFinite(hitsLike)) {
      mean = hitsLike * 0.68;
    } else {
      mean = Number(leg.line) === 0.5 ? 0.58 : Number(leg.line) * 0.65;
    }
  }

  const savant = String(leg.savantReportGrade || leg.savant || "").toUpperCase();
  if (savant === "BOOST") mean += 0.05;
  if (savant === "DOWNGRADE") mean -= 0.05;

  return Math.max(0.05, mean);
}

function modelSingles(leg) {
  const mean = estimateSinglesMean(leg);
  const line = Number(leg.line);
  const probMore = poissonProbMore(mean, line);
  const probLess = 1 - probMore;
  const best = Math.max(probMore, probLess);

  return {
    market: "singles",
    distribution: "poisson_singles_v1",
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

module.exports = { modelSingles };
