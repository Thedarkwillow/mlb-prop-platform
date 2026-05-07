const fs = require("fs");

const data = JSON.parse(fs.readFileSync("outputs/final-slips.json", "utf8"));
const slips = data.slips || [];

const playable = slips.filter(s =>
  s.complete !== false &&
  s.correlation !== "HIGH_CORRELATION"
);

console.log("\nPLAYABLE FINAL SLIPS");

for (const s of playable) {
  console.log(`\n${s.name} | green=${s.green} neutral=${s.neutral} correlation=${s.correlation || "OK"}`);
  console.table((s.legs || []).map((x, i) => ({
    leg: i + 1,
    player: x.player,
    team: x.team,
    game: x.game,
    pick: `${x.market} ${x.side} ${x.line}`,
    edge: x.edge,
    grade: x.grade,
    books: x.books
  })));
}

fs.writeFileSync("outputs/playable-final-slips.json", JSON.stringify(playable, null, 2));
console.log("\nWrote outputs/playable-final-slips.json");
