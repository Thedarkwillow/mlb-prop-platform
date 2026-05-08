const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

function modelHits(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let modelScore = edge * 0.50 + prob * 0.40 + Math.min(books, 5) * 0.018;

  if (leg.side === "MORE" && num(leg.line) === 0.5) modelScore += 0.01;
  if (books < 2) modelScore -= 0.08;

  return {
    marketModel: "hitters/hits",
    modelScore: clamp(modelScore),
    modelGrade: gradeFromEdge(edge),
    modelNotes: ["hits model v1"]
  };
}

module.exports = { modelHits };
