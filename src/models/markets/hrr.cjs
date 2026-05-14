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

function estimateComponentMean(leg) {
  const hits = firstNum([
    leg.hitsProjection,
    leg.hitProjection,
    leg.projectedHits,
    leg.hitsMean
  ]);

  const runs = firstNum([
    leg.runsProjection,
    leg.runProjection,
    leg.projectedRuns,
    leg.runsMean
  ]);

  const rbis = firstNum([
    leg.rbisProjection,
    leg.rbiProjection,
    leg.projectedRbis,
    leg.rbisMean
  ]);

  const parts = [hits, runs, rbis].filter(Number.isFinite);

  if (parts.length >= 2) {
    const missing = 3 - parts.length;
    const fallbackPart = Math.max(0.18, parts.reduce((a, b) => a + b, 0) / parts.length * 0.75);
    return parts.reduce((a, b) => a + b, 0) + missing * fallbackPart;
  }

  return null;
}

function estimateHrrMean(leg) {
  const componentMean = estimateComponentMean(leg);
  const directMean = estimateDirectHrrMean(leg);

  let mean = Number.isFinite(componentMean) ? componentMean : directMean;
  if (!Number.isFinite(mean)) return null;

  const contextMultiplier = 1 + lineupAdjustment(leg) + savantAdjustment(leg);
  mean *= contextMultiplier;

  // Prevent accidental over-expansion from noisy component inputs.
  if (Number.isFinite(directMean)) {
    mean = Math.min(mean, directMean * 1.22);
    mean = Math.max(mean, directMean * 0.78);
  }

  return Math.max(0.05, mean);
}

function modelHrr(leg) {
  const line = Number(leg.line);
  const mean = estimateHrrMean(leg);

  if (!Number.isFinite(line) || !Number.isFinite(mean)) {
    return {
      market: "hrr",
      distribution: "component_poisson_hrr_v2",
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
  const best = Math.max(probMore, probLess);

  return {
    market: "hrr",
    distribution: "component_poisson_hrr_v2",
    mean: Number(mean.toFixed(4)),
    variance: Number(mean.toFixed(4)),
    probMore: Number(probMore.toFixed(4)),
    probLess: Number(probLess.toFixed(4)),
    fairLine: Number(mean.toFixed(2)),
    confidence:
      best >= 0.70 ? "HIGH" :
      best >= 0.58 ? "MEDIUM" :
      "LOW"
  };
}

module.exports = { modelHrr };
