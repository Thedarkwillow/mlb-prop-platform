const fs = require("fs");

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);
const IN = "outputs/slips-priced.json";
const OUT = `data/clv-snapshots/${DATE}.json`;

fs.mkdirSync("data/clv-snapshots", { recursive: true });

const legs = JSON.parse(fs.readFileSync(IN, "utf8"))
  .filter(x =>
    x.sportsbookGrade !== "FADE" &&
    x.qualityGrade !== "FADE" &&
    x.sportsbookEdge != null &&
    x.sportsbookAvgProb != null &&
    Number(x.sportsbookBookCount || 0) > 0 &&
    Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge) >= 0.015 &&
    Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge) >= 0.015
  );

const snapshot = {
  date: DATE,
  savedAt: new Date().toISOString(),
  source: IN,
  legs: legs.map(x => ({
    player: x.player,
    team: x.team,
    game: x.game,
    gamePk: x.gamePk,
    market: x.market,
    side: x.side,
    line: x.line,
    modelProb: x.recommendedProb,
    marketProb: x.sportsbookAvgProb,
    edge: x.sportsbookEdge,
    grade: x.sportsbookGrade,
    books: x.sportsbookBookCount
  }))
};

fs.writeFileSync(OUT, JSON.stringify(snapshot, null, 2));

console.log("Saved CLV snapshot:", OUT);
console.table(snapshot.legs.map((x, i) => ({
  rank: i + 1,
  player: x.player,
  pick: `${x.market} ${x.side} ${x.line}`,
  marketProb: x.marketProb,
  edge: x.edge,
  grade: x.grade
})));
