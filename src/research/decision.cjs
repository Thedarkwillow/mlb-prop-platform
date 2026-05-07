const fs = require("fs");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const playable = readJson("outputs/playable-final-slips.json", []);
const watchlist = readJson("outputs/watchlist-final-slips.json", []);

const completeWatchlist = watchlist.filter(x => x.complete);
const incomplete = watchlist.filter(x => !x.complete);

console.log("\nDAILY BETTING DECISION\n");

if (playable.length > 0) {
  console.log("DECISION: PLAY");
  console.log(`Playable slips: ${playable.length}`);
  console.table(playable.map(x => ({
    slip: x.name,
    size: x.size,
    green: x.green,
    neutral: x.neutral,
    correlation: x.correlation
  })));
} else if (completeWatchlist.length > 0) {
  console.log("DECISION: WATCHLIST ONLY");
  console.log("No slip passed the quality gate.");
  console.log(`Complete watchlist slips: ${completeWatchlist.length}`);
  console.table(completeWatchlist.map(x => ({
    slip: x.name,
    size: x.size,
    green: x.green,
    neutral: x.neutral,
    reason:
      x.size === 2 && x.green < 2 ? "needs 2 GREEN legs" :
      x.size >= 3 && x.green < 2 ? "needs more GREEN legs" :
      x.neutral > x.green + 1 ? "too many NEUTRAL legs" :
      "watchlist"
  })));
} else {
  console.log("DECISION: PASS TODAY");
  console.log("No playable slips and no complete watchlist slips.");
  console.log(`Incomplete slips: ${incomplete.length}`);
}

console.log("");
