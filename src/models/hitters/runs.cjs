const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

function modelRuns(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let modelScore = edge * 0.60 + prob * 0.30 + Math.min(books, 5) * 0.015;

  if (books < 3) modelScore -= 0.04;

  return {
    marketModel: "hitters/runs",
    modelScore: clamp(modelScore),
    modelGrade: gradeFromEdge(edge),
    modelNotes: ["runs model v1"]
  };
}

module.exports = { modelRuns };
