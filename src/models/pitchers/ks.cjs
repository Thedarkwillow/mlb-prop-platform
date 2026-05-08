const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

function modelKs(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let modelScore = edge * 0.60 + prob * 0.30 + Math.min(books, 5) * 0.02;

  if (books < 3) modelScore -= 0.05;

  return {
    marketModel: "pitchers/ks",
    modelScore: clamp(modelScore),
    modelGrade: gradeFromEdge(edge),
    modelNotes: ["strikeouts model v1"]
  };
}

module.exports = { modelKs };
