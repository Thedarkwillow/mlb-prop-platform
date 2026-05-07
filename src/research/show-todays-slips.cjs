const fs = require("fs");

const file = "outputs/playable-final-slips.json";
if (!fs.existsSync(file)) {
  console.error("Missing playable slips. Run: npm run picks");
  process.exit(1);
}

const slips = JSON.parse(fs.readFileSync(file, "utf8"));

console.log("\nTODAY'S PLAYABLE SLIPS\n");

for (const slip of slips) {
  console.log(`${slip.name} | green=${slip.green} neutral=${slip.neutral} correlation=${slip.correlation}`);
  console.table(
    (slip.legs || []).map((x, i) => ({
      leg: i + 1,
      player: x.player,
      team: x.team,
      game: x.game,
      pick: `${x.market} ${x.side} ${x.line}`,
      grade: x.grade,
      prob: x.calibratedDistributionProb ?? null,
      edge: x.edge,
      books: x.books
    }))
  );
}
