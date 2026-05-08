const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

function modelBases(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let modelScore = edge * 0.55 + prob * 0.35 + Math.min(books, 5) * 0.02;

  if (leg.side === "MORE" && num(leg.line) === 0.5) modelScore += 0.015;
  if (books < 2) modelScore -= 0.08;

  return {
    marketModel: "hitters/bases",
    modelScore: clamp(modelScore),
    modelGrade: gradeFromEdge(edge),
    modelNotes: ["bases model v1"]
  };
}

module.exports = { modelBases };
