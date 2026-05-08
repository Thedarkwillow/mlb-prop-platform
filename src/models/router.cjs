const { modelBases } = require("./hitters/bases.cjs");
const { modelHits } = require("./hitters/hits.cjs");
const { modelRuns } = require("./hitters/runs.cjs");
const { modelHrr } = require("./hitters/hrr.cjs");
const { modelKs } = require("./pitchers/ks.cjs");
const { modelOuts } = require("./pitchers/outs.cjs");
const { modelHitsAllowed } = require("./pitchers/hits_allowed.cjs");
const { modelEarnedRuns } = require("./pitchers/earned_runs.cjs");

function applyMarketModel(leg) {
  const market = String(leg.market || "").toLowerCase();

  if (market === "bases") return { ...leg, ...modelBases(leg) };
  if (market === "hits") return { ...leg, ...modelHits(leg) };
  if (market === "runs" || market === "rbis" || market === "rbi") return { ...leg, ...modelRuns(leg) };
  if (market === "hrr") return { ...leg, ...modelHrr(leg) };

  if (market === "strikeouts") return { ...leg, ...modelKs(leg) };
  if (market === "pitching_outs" || market === "outs") return { ...leg, ...modelOuts(leg) };
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

module.exports = { applyMarketModel };
