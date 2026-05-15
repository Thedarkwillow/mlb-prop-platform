const { applySavantV2Mean } = require("../savant-v2-adjustments.cjs");
function poissonPmf(k, lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  let p0 = Math.exp(-lambda);
  if (k === 0) return p0;
  let p = p0;
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function poissonProbMore(lambda, line) {
  const floor = Math.floor(Number(line));
  let cdf = 0;
  for (let k = 0; k <= floor; k++) cdf += poissonPmf(k, lambda);
  return Math.max(0, Math.min(1, 1 - cdf));
}

function estimateBasesMean(leg) {
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

  let mean = candidates[0] || Number(leg.line) + 0.45;

  const savant = String(leg.savantReportGrade || leg.savant || "").toUpperCase();
  if (savant === "BOOST") mean += 0.18;
  if (savant === "DOWNGRADE") mean -= 0.12;

  return Math.max(0.15, mean);
}

function modelBases(leg) {
  const baseMean = estimateBasesMean(leg);
  const savantV2Result = applySavantV2Mean(baseMean, leg, "bases");
  const mean = savantV2Result.mean;
  const line = Number(leg.line);
  const probMore = poissonProbMore(mean, line);
  const probLess = 1 - probMore;

  const confidence =
    Math.max(probMore, probLess) >= 0.7 ? "HIGH" :
    Math.max(probMore, probLess) >= 0.58 ? "MEDIUM" :
    "LOW";

  return {
    market: "bases",
    distribution: "poisson",
    mean: Number(mean.toFixed(3)),
    variance: Number(mean.toFixed(3)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: Number(mean.toFixed(3)),
    savantV2: savantV2Result.savantV2,
    confidence
  };
}

module.exports = { modelBases };
