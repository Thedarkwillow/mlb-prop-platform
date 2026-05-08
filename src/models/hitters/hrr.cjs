const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

function modelHrr(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let modelScore = edge * 0.45 + prob * 0.45 + Math.min(books, 5) * 0.015;

  if (books < 2) modelScore -= 0.08;

  return {
    marketModel: "hitters/hrr",
    modelScore: clamp(modelScore),
    modelGrade: gradeFromEdge(edge),
    modelNotes: ["hrr model v1"]
  };
}

module.exports = { modelHrr };
