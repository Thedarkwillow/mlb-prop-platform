const { modelHits } = require("./hits.cjs");
const { modelRuns } = require("./runs.cjs");
const { modelRbis } = require("./rbis.cjs");

function clamp(x, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(x)));
}

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
  return clamp(1 - cdf);
}

function firstNum(values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function cleanComponentLeg(leg, market, projectionFields = []) {
  const out = {
    ...leg,
    market,
    stat: market,
    modelMean: undefined,
    mean: undefined,
    projectedMean: undefined,
    projection: undefined,
    recommendedProjection: undefined,
    ballparkProjection: undefined,
    sportsbookLine: undefined,
    line: 0.5
  };

  const projection = firstNum(projectionFields.map(k => leg[k]));
  if (Number.isFinite(projection)) {
    out.modelMean = projection;
  }

  return out;
}

function lineupAdjustment(leg) {
  const spot = Number(
    leg.battingOrder ??
    leg.lineupSpot ??
    leg.projectedBattingOrder ??
    leg.order
  );

  if (!Number.isFinite(spot)) return 0;
  if (spot <= 3) return 0.08;
  if (spot <= 5) return 0.04;
  if (spot >= 8) return -0.07;
  if (spot >= 6) return -0.035;
  return 0;
}

function savantAdjustment(leg) {
  const savant = String(leg.savantReportGrade || leg.savant || "").toUpperCase();
  if (savant === "BOOST") return 0.06;
  if (savant === "DOWNGRADE") return -0.06;
  return 0;
}

function estimateDirectHrrMean(leg) {
  const direct = firstNum([
    leg.hrrProjection,
    leg.hrrMean,
    leg.hitsRunsRbisProjection,
    leg.modelMean,
    leg.mean,
    leg.projectedMean,
    leg.projection,
    leg.recommendedProjection,
    leg.ballparkProjection
  ]);

  if (Number.isFinite(direct)) return direct;

  const line = Number(leg.line);
  const prob = Number(leg.recommendedProb);
  if (!Number.isFinite(line) || !Number.isFinite(prob)) return null;

  return Math.max(0.05, line + (prob - 0.5) * 2.2);
}

function estimateModelComponentMean(leg) {
  const hitsLeg = cleanComponentLeg(leg, "hits", [
    "hitsProjection",
    "hitProjection",
    "projectedHits",
    "hitsMean"
  ]);

  const runsLeg = cleanComponentLeg(leg, "runs", [
    "runsProjection",
    "runProjection",
    "projectedRuns",
    "runsMean"
  ]);

  const rbisLeg = cleanComponentLeg(leg, "rbis", [
    "rbisProjection",
    "rbiProjection",
    "projectedRbis",
    "rbisMean"
  ]);

  const hits = modelHits(hitsLeg);
  const runs = modelRuns(runsLeg);
  const rbis = modelRbis(rbisLeg);

  const means = [hits.mean, runs.mean, rbis.mean].map(Number).filter(Number.isFinite);
  if (means.length !== 3) return null;

  return {
    mean: means.reduce((a, b) => a + b, 0),
    components: {
      hits: hits.mean,
      runs: runs.mean,
      rbis: rbis.mean
    }
  };
}

function estimateHrrMean(leg) {
  const directMean = estimateDirectHrrMean(leg);
  const modeled = estimateModelComponentMean(leg);

  let mean = modeled?.mean;
  if (!Number.isFinite(mean)) mean = directMean;
  if (!Number.isFinite(mean)) return { mean: null, components: null };

  const contextMultiplier = 1 + lineupAdjustment(leg) + savantAdjustment(leg);
  mean *= contextMultiplier;

  // Safety cap keeps model-driven composition from exploding when component fields are missing.
  if (Number.isFinite(directMean)) {
    mean = Math.min(mean, directMean * 1.22);
    mean = Math.max(mean, directMean * 0.78);
  }

  return {
    mean: Math.max(0.05, mean),
    components: modeled?.components || null
  };
}

function modelHrr(leg) {
  const line = Number(leg.line);
  const estimated = estimateHrrMean(leg);
  const mean = estimated.mean;

  if (!Number.isFinite(line) || !Number.isFinite(mean)) {
    return {
      market: "hrr",
      distribution: "model_component_poisson_hrr_v3",
      mean: null,
      variance: null,
      probMore: null,
      probLess: null,
      fairLine: null,
      components: null,
      confidence: "UNKNOWN"
    };
  }

  const probMore = poissonProbMore(mean, line);
  const probLess = 1 - probMore;
  const best = Math.max(probMore, probLess);

  return {
    market: "hrr",
    distribution: "model_component_poisson_hrr_v3",
    mean: Number(mean.toFixed(4)),
    variance: Number(mean.toFixed(4)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: Number(mean.toFixed(2)),
    components: estimated.components,
    confidence:
      best >= 0.70 ? "HIGH" :
      best >= 0.58 ? "MEDIUM" :
      "LOW"
  };
}

module.exports = { modelHrr };
