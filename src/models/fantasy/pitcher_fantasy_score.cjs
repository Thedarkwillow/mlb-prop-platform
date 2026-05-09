const { num, clamp, gradeFromEdge } = require("../shared/model-utils.cjs");

const SCORING = {
  win: 6,
  qualityStart: 4,
  earnedRun: -3,
  strikeout: 3,
  out: 1
};

function modelPitcherFantasy(leg) {
  const edge = num(leg.edge ?? leg.sportsbookEdge);
  const prob = num(leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb);
  const books = num(leg.books ?? leg.sportsbookBookCount);

  let score = edge + Math.max(0, prob - 0.5) * 0.7;

  if (books >= 4) score += 0.025;
  else if (books < 2) score -= 0.08;

  if (prob < 0.54) score -= 0.05;
  if (edge < 0.04) score -= 0.05;

  return {
    marketModel: "fantasy/pitcher_fantasy_score",
    fantasyScoringVerified: true,
    fantasyScoring: SCORING,
    modelScore: clamp(score),
    modelGrade: gradeFromEdge(edge),
    rankEligible: true
  };
}

module.exports = { modelPitcherFantasy, SCORING };
