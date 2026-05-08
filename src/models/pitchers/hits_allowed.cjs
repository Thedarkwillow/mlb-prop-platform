const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

function modelHitsAllowed(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let modelScore = edge * 0.55 + prob * 0.35 + Math.min(books, 5) * 0.018;

  if (books < 3) modelScore -= 0.05;

  return {
    marketModel: "pitchers/hits_allowed",
    modelScore: clamp(modelScore),
    modelGrade: gradeFromEdge(edge),
    modelNotes: ["hits allowed model v1"]
  };
}

module.exports = { modelHitsAllowed };
