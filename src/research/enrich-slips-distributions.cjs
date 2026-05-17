const fs = require("fs");
const { modelStrikeouts } = require("../models/markets/strikeouts.cjs");
const { modelHrr } = require("../models/markets/hrr.cjs");
const { modelHits } = require("../models/markets/hits.cjs");
const { modelPitchingOuts } = require("../models/markets/pitching-outs.cjs");
const { modelEarnedRunsAllowed } = require("../models/markets/earned-runs-allowed.cjs");
const { modelHitsAllowed } = require("../models/markets/hits-allowed.cjs");
const { modelHomeRuns } = require("../models/markets/home-runs.cjs");
const { modelRuns } = require("../models/markets/runs.cjs");
const { modelRbis } = require("../models/markets/rbis.cjs");
const { modelBases } = require("../models/markets/bases.cjs");
const { modelSingles } = require("../models/markets/singles.cjs");
const { modelHitterStrikeouts } = require("../models/markets/hitter-strikeouts.cjs");
const { modelWalks } = require("../models/markets/walks.cjs");
const { applyContextToProbability } = require("./elite-context-score.cjs");
const { applyPreDistributionContext } = require("../lib/phase5PreDistributionContext.cjs");
const { applyHistoricalCalibration } = require("./probability-calibration.cjs");
const { applyPhase6ProbabilityFeedback } = require("./phase6-probability-feedback.cjs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normMarket(s, stat = "") {
  const raw = `${s || ""} ${stat || ""}`.toLowerCase().trim();
  s = raw;
  if (s.includes("hitter_strikeouts") || s.includes("hitter strikeouts")) return "hitter_strikeouts";
  if (s.includes("pitcher_strikeouts") || s.includes("pitcher strikeouts") || s.includes("strikeout")) return "strikeouts";
  if (s.includes("pitching_outs") || s.includes("pitching outs") || s.includes("outs")) return "pitching_outs";
  if (s.includes("hrr") || s.includes("hits + runs + rbis")) return "hrr";
  if (s.includes("total bases")) return "bases";
  if (s.includes("runs")) return "runs";
  if (s.includes("rbi")) return "rbis";
  if (s.includes("home_runs") || s.includes("home runs") || s.includes("homer")) return "home_runs";
  if (s.includes("singles") || s === "single") return "singles";
  if (s.includes("walks") || s === "walk") return "walks";
  if (s.includes("hits")) return "hits";
  return s;
}

function enrichLeg(leg) {
  const market = normMarket(leg.market || leg.stat, leg.stat || leg.projectionType);
  const preDistributionContext = applyPreDistributionContext({
    ...leg,
    market
  });
  const modelLeg = {
    ...leg,
    market,
    projection: preDistributionContext.contextAdjustedProjection ?? leg.projection,
    mean: preDistributionContext.contextAdjustedProjection ?? leg.mean,
    hrrMean: preDistributionContext.contextAdjustedProjection ?? leg.hrrMean,
    hitsMean: preDistributionContext.contextAdjustedProjection ?? leg.hitsMean,
    basesMean: preDistributionContext.contextAdjustedProjection ?? leg.basesMean,
    kMean: preDistributionContext.contextAdjustedProjection ?? leg.kMean,
    strikeoutMean: preDistributionContext.contextAdjustedProjection ?? leg.strikeoutMean
  };
  let distribution = null;

  if (market === "strikeouts") distribution = modelStrikeouts(modelLeg);
  if (market === "hitter_strikeouts") distribution = modelHitterStrikeouts(modelLeg);
  if (market === "pitching_outs") distribution = modelPitchingOuts(modelLeg);
  if (market === "earned_runs_allowed") distribution = modelEarnedRunsAllowed(modelLeg);
  if (market === "hits_allowed") distribution = modelHitsAllowed(modelLeg);
  if (market === "home_runs") distribution = modelHomeRuns(modelLeg);
  if (market === "hrr") distribution = modelHrr(modelLeg);
  if (market === "hits") distribution = modelHits(modelLeg);
  if (market === "runs") distribution = modelRuns(modelLeg);
  if (market === "rbis") distribution = modelRbis(modelLeg);
  if (market === "bases") distribution = modelBases(modelLeg);
  if (market === "singles") distribution = modelSingles(modelLeg);
  if (market === "walks") distribution = modelWalks(modelLeg);

  let distributionProb = null;
  const side = String(leg.side || "").toUpperCase();

  if (distribution) {
    if (side === "MORE") distributionProb = distribution.probMore;
    if (side === "LESS") distributionProb = distribution.probLess;
  }

  let calibratedDistributionProb = distributionProb;

  if (Number.isFinite(distributionProb)) {
    calibratedDistributionProb = 0.5 + ((distributionProb - 0.5) * 0.55);
    calibratedDistributionProb = Math.max(0.02, Math.min(0.98, calibratedDistributionProb));
    calibratedDistributionProb = Number(calibratedDistributionProb.toFixed(4));
  }

  const contextApplied = applyContextToProbability(calibratedDistributionProb, {
    ...leg,
    market,
    side
  });

  const contextAdjustedDistributionProb = contextApplied.probability;
  const contextProbabilityAdjustment = contextApplied.contextAdjustment;
  const eliteContext = contextApplied.eliteContext;

  const historicalCalibrated = applyHistoricalCalibration(contextAdjustedDistributionProb, {
    ...leg,
    market,
    side
  });

  const phase6Feedback = applyPhase6ProbabilityFeedback(historicalCalibrated.probability, {
    ...leg,
    market,
    side
  });
  const finalDistributionProb = phase6Feedback.probability;
  const phase6ProbabilityFeedback = phase6Feedback.phase6ProbabilityFeedback;
  const historicalCalibrationAdjustment = historicalCalibrated.historicalCalibrationAdjustment;
  const historicalCalibration = historicalCalibrated.historicalCalibration;

  const isStrikeouts = market === "strikeouts";
  const poissonStrikeoutsProb =
    isStrikeouts && Number.isFinite(finalDistributionProb)
      ? finalDistributionProb
      : null;

  const finalRecommendedProb = Number.isFinite(finalDistributionProb)
    ? finalDistributionProb
    : leg.recommendedProb;

  return {
    ...leg,
    distributionModel: distribution,
    contextBaseProjection: preDistributionContext.contextBaseProjection ?? null,
    contextAdjustedProjection: preDistributionContext.contextAdjustedProjection ?? null,
    contextMultiplier: preDistributionContext.contextMultiplier ?? null,
    contextProjectionNotes: preDistributionContext.contextProjectionNotes ?? [],
    distributionProb,
    preContextCalibratedDistributionProb: calibratedDistributionProb,
    contextAdjustedDistributionProb,
    calibratedDistributionProb: finalDistributionProb,
    contextProbabilityAdjustment,
    historicalCalibrationAdjustment,
    historicalCalibration,
    phase6ProbabilityFeedback,
    eliteContext,
    poissonStrikeoutsProb,
    probabilityModel: poissonStrikeoutsProb != null ? "poisson_strikeouts_context_v2" : leg.probabilityModel,
    recommendedProb: finalRecommendedProb,
    prob: finalRecommendedProb
  };
}

const priced = readJson("outputs/slips-priced.json", []);
const final = readJson("outputs/final-slips.json", null);
const playable = readJson("outputs/playable-final-slips.json", null);

let legs = [];
if (Array.isArray(priced) && priced.length) {
  legs = priced.filter(x => {
    const market = normMarket(x.market || x.stat);
    if (x.qualityGrade !== "FADE") return true;

    // Allow positive-edge secondary markets through as watchlist/model candidates.
    // They are still not auto-playable unless later gates approve them.
    if (["bases", "hits", "runs", "rbis"].includes(market)) {
      return (
        x.sportsbookMatch &&
        typeof x.sportsbookEdge === "number" &&
        x.sportsbookEdge > 0 &&
        Number(x.sportsbookAdjustedEdge ?? -999) >= 0.04
      );
    }

    return false;
  });
} else {
  const slips = final?.slips || playable?.slips || final || playable || [];
  legs = Array.isArray(slips) ? slips.flatMap(s => s.legs || []) : [];
}

const enriched = legs.map(enrichLeg);

fs.writeFileSync(
  "outputs/slips-distribution-enriched.json",
  JSON.stringify(enriched, null, 2)
);

console.log("Wrote outputs/slips-distribution-enriched.json");
console.log("legs:", enriched.length);
console.log("distribution modeled:", enriched.filter(x => x.distributionModel).length);

console.table(enriched.slice(0, 20).map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  raw: x.distributionProb,
  calibrated: x.calibratedDistributionProb,
  confidence: x.distributionModel?.confidence
})));
