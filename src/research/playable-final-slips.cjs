const fs = require("fs");

function slipQualityStatus(slip) {
  const green = Number(slip.green || 0);
  const neutral = Number(slip.neutral || 0);
  const size = Number(slip.size || 0);

  if (!slip.complete) return "INCOMPLETE";
  if (size === 2 && green < 2) return "WATCHLIST";
  if (size === 3 && green < 2) return "WATCHLIST";
  if (size === 4 && green < 2) return "WATCHLIST";
  if (size === 5 && green < 3) return "WATCHLIST";
  if (size === 6 && green < 3) return "WATCHLIST";
  if (neutral > green + 1) return "WATCHLIST";

  return "PLAYABLE";
}


const data = JSON.parse(fs.readFileSync("outputs/final-slips.json", "utf8"));
const slips = data.slips || [];

const playable = slips.map(s => ({ ...s, status: slipQualityStatus(s) })).filter(s =>
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
