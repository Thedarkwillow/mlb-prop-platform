const fs = require("fs");

const rows = JSON.parse(fs.readFileSync("outputs/priced-board.json", "utf8"));

const props = rows.filter(r => r.recordType === "merged_prop");

const review = props
  .filter(r =>
    r.teamResolved === true &&
    r.teamValid === true &&
    (
      String(r.teamResolverStatus || "") === "corrected" ||
      r.resolvedTeam ||
      r.resolvedGame
    )
  )
  .map(r => ({
    player: r.player,
    team: r.team,
    game: r.game,
    market: r.market || r.stat,
    line: r.line,
    side: r.side || r.recommendedSide,
    status: r.teamResolverStatus,
    resolvedTeam: r.resolvedTeam,
    resolvedGame: r.resolvedGame,
    resolvedGamePk: r.resolvedGamePk
  }));

const unique = [];
const seen = new Set();

for (const r of review) {
  const key = `${r.player}|${r.team}|${r.game}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(r);
}

fs.writeFileSync(
  "outputs/player-metadata-review.json",
  JSON.stringify(unique, null, 2) + "\n"
);

console.log("PLAYER METADATA REVIEW");
console.log("======================");
console.log("Rows:", unique.length);
console.table(unique.slice(0, 40));
