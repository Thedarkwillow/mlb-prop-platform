const fs = require("fs");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function legSummaryByGrade(slip, grade) {
  return (slip.legs || [])
    .filter(l => String(l.grade || "").toUpperCase() === grade)
    .map(l => `${l.player} ${l.market} ${l.side} ${l.line}`)
    .join("; ") || null;
}

const playable = readJson("outputs/official-slip.json", []);
const watchlist = readJson("outputs/watchlist-final-slips.json", []);

const completeWatchlist = watchlist.filter(x => x.complete);
const incomplete = watchlist.filter(x => !x.complete);

console.log("\nDAILY BETTING DECISION\n");

if (playable.length > 0) {
  console.log("DECISION: PLAY");
  console.log(`Official playable slips: ${playable.length}`);
  console.table(playable.map(x => ({
    slip: x.name,
    size: x.size,
    green: x.green,
    neutral: x.neutral,
    watchlist: x.watchlist || 0,
    fade: x.fade || 0,
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
    watchlist: x.watchlist || 0,
    fade: x.fade || 0,
    watchlistLegs: legSummaryByGrade(x, "WATCHLIST"),
    fadeLegs: legSummaryByGrade(x, "FADE"),
    reason:
      (x.watchlist || 0) > 0 ? "has WATCHLIST leg" :
      (x.fade || 0) > 0 ? "has FADE leg" :
      x.size === 2 && x.green < 2 ? "needs 2 GREEN legs" :
      x.size === 3 && x.green < 2 ? "needs more GREEN legs" :
      x.size === 4 && x.green < 2 ? "needs more GREEN legs" :
      x.size === 5 && x.green < 3 ? "needs more GREEN legs" :
      x.size === 6 && x.green < 4 ? "needs more GREEN legs" :
      x.neutral >= x.green ? "too many NEUTRAL legs" :
      "watchlist"
  })));
} else {
  console.log("DECISION: PASS TODAY");
  console.log("No playable slips and no complete watchlist slips.");
  console.log(`Incomplete slips: ${incomplete.length}`);
}

console.log("");
