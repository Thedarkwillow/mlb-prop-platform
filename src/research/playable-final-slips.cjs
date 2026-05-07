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

const raw = JSON.parse(fs.readFileSync("outputs/final-slips.json", "utf8"));
const slips = Array.isArray(raw) ? raw : (raw.slips || raw.finalSlips || []);

const processed = slips.map(slip => ({
  ...slip,
  status: slipQualityStatus(slip)
}));

const playable = processed.filter(slip => slip.status === "PLAYABLE");
const watchlist = processed.filter(slip => slip.status !== "PLAYABLE");

console.log("PLAYABLE FINAL SLIPS");

for (const slip of processed) {
  console.log(
    `${slip.name} | status=${slip.status} green=${slip.green} neutral=${slip.neutral} correlation=${slip.correlation}`
  );
  console.table(
    (slip.legs || []).map((x, i) => ({
      leg: i + 1,
      player: x.player,
      team: x.team,
      game: x.game,
      pick: `${x.market} ${x.side} ${x.line}`,
      edge: x.edge,
      grade: x.grade,
      books: x.books
    }))
  );
}

fs.writeFileSync(
  "outputs/playable-final-slips.json",
  JSON.stringify(playable, null, 2) + "\n"
);

fs.writeFileSync(
  "outputs/watchlist-final-slips.json",
  JSON.stringify(watchlist, null, 2) + "\n"
);

console.log("Wrote outputs/playable-final-slips.json");
console.log("Wrote outputs/watchlist-final-slips.json");
