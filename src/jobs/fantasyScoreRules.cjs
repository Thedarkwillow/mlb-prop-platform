function hitterFantasyScore(stats = {}) {
  const singles = Number(stats.singles || 0);
  const doubles = Number(stats.doubles || 0);
  const triples = Number(stats.triples || 0);
  const homeRuns = Number(stats.homeRuns || 0);
  const walks = Number(stats.baseOnBalls || stats.walks || 0);
  const hbp = Number(stats.hitByPitch || 0);
  const runs = Number(stats.runs || 0);
  const rbi = Number(stats.rbi || stats.RBI || 0);
  const stolenBases = Number(stats.stolenBases || 0);

  return (
    singles * 3 +
    doubles * 6 +
    triples * 8 +
    homeRuns * 10 +
    walks * 3 +
    hbp * 3 +
    runs * 2 +
    rbi * 2 +
    stolenBases * 5
  );
}

function pitcherFantasyScore(stats = {}) {
  const inningsPitched = Number(stats.inningsPitched || 0);
  const strikeOuts = Number(stats.strikeOuts || stats.strikeouts || 0);
  const earnedRuns = Number(stats.earnedRuns || 0);
  const hits = Number(stats.hits || 0);
  const walks = Number(stats.baseOnBalls || stats.walks || 0);
  const wins = Number(stats.wins || 0);
  const hitBatsmen = Number(stats.hitBatsmen || stats.hitByPitch || 0);

  return (
    inningsPitched * 3 +
    strikeOuts * 3 +
    wins * 6 -
    earnedRuns * 3 -
    hits -
    walks -
    hitBatsmen
  );
}

module.exports = {
  hitterFantasyScore,
  pitcherFantasyScore,
};
