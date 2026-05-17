const { modelBases } = require("./hitters/bases.cjs");
const { modelHits } = require("./hitters/hits.cjs");
const { modelRuns } = require("./hitters/runs.cjs");
const { modelHitterFantasy } = require("./fantasy/hitter_fantasy_score.cjs");
const { modelPitcherFantasy } = require("./fantasy/pitcher_fantasy_score.cjs");
const { modelHrr } = require("./hitters/hrr.cjs");
const { applyPreDistributionContext } = require("../lib/phase5PreDistributionContext.cjs");
const { modelKs } = require("./pitchers/ks.cjs");
const { modelOuts } = require("./pitchers/outs.cjs");
const { modelHitsAllowed } = require("./pitchers/hits_allowed.cjs");
const { modelEarnedRuns } = require("./pitchers/earned_runs.cjs");

function applyMarketModel(leg) {
  const market = String(leg.market || "").toLowerCase();

  if (market === "bases") return applyModelWithContext(leg, modelBases);
  if (market === "hits") return applyModelWithContext(leg, modelHits);
  if (market === "runs" || market === "rbis" || market === "rbi") return applyModelWithContext(leg, modelRuns);
  if (market === "hrr") return applyModelWithContext(leg, modelHrr);

  if (market === "strikeouts") return applyModelWithContext(leg, modelKs);
  if (market === "pitching_outs" || market === "outs") return applyModelWithContext(leg, modelOuts);
  if (market === "hits_allowed") return { ...leg, ...modelHitsAllowed(leg) };
  if (market === "earned_runs_allowed") return { ...leg, ...modelEarnedRuns(leg) };

  return {
    ...leg,
    marketModel: "unknown",
    modelScore: Number(leg.score || 0),
    modelGrade: leg.grade || "UNKNOWN",
    modelNotes: ["no market-specific model"]
  };
}


function applyModelWithContext(leg, modelFn) {
  const base = modelFn(leg);
  const context = applyPreDistributionContext({ ...leg, ...base });
  return { ...leg, ...base, ...context };
}

module.exports = { applyMarketModel };
