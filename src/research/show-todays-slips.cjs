const fs = require("fs");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function reason(slip) {
  const green = Number(slip.green || 0);
  const neutral = Number(slip.neutral || 0);
  const watchlist = Number(slip.watchlist || 0);
  const fade = Number(slip.fade || 0);
  const size = Number(slip.size || 0);

  if (!slip.complete) return "incomplete slip";
  if (fade > 0) return "has FADE leg";
  if (watchlist > 0) return "has WATCHLIST leg";

  if (size === 2 && green < 2) return "needs 2 GREEN legs";
  if (size === 3 && green < 2) return "needs more GREEN legs";
  if (size === 4 && green < 2) return "needs more GREEN legs";
  if (size === 5 && green < 3) return "needs more GREEN legs";
  if (size === 6 && green < 4) return "needs more GREEN legs";

  if (neutral >= green) return "too many NEUTRAL legs";

  return "playable";
}

function printSlip(slip) {
  console.log(
    `${slip.name} | status=${slip.status || "UNKNOWN"} | reason=${reason(slip)} | green=${slip.green} neutral=${slip.neutral} correlation=${slip.correlation}`
  );
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

const playable = readJson("outputs/playable-final-slips.json", []);
const watchlist = readJson("outputs/watchlist-final-slips.json", []);

console.log("\nPLAYABLE SLIPS\n");
if (!playable.length) console.log("None passed the quality gate.\n");
for (const slip of playable) printSlip(slip);

console.log("\nWATCHLIST / BLOCKED SLIPS\n");
if (!watchlist.length) console.log("No watchlist slips found.\n");
for (const slip of watchlist) printSlip(slip);
