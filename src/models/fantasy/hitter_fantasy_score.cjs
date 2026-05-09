const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

const SCORING = {
  single: 3,
  double: 5,
  triple: 8,
  homeRun: 10,
  run: 2,
  rbi: 2,
  walk: 2,
  hbp: 2,
  stolenBase: 5
};

function modelHitterFantasy(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let score = edge + Math.max(0, prob - 0.5) * 0.75;

  if (books >= 4) score += 0.025;
  else if (books < 2) score -= 0.08;

  if (prob < 0.54) score -= 0.05;
  if (edge < 0.04) score -= 0.05;

  return {
    marketModel: "fantasy/hitter_fantasy_score",
    fantasyScoringVerified: true,
    fantasyScoring: SCORING,
    modelScore: clamp(score),
    modelGrade: gradeFromEdge(edge),
    rankEligible: true
  };
}

module.exports = { modelHitterFantasy, SCORING };
