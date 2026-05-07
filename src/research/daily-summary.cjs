const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const date =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

const playable = readJson("outputs/playable-final-slips.json", []);
const watchlist = readJson("outputs/watchlist-final-slips.json", []);
const coverage = readJson("outputs/distribution-coverage-report.json", {});
const caldb = readJson("data/calibration/calibration-db.json", []);
const curves = readJson("data/calibration/calibration-curves.json", {});
const histDir = path.join("data", "history", date);

const allWatchLegs = [];
for (const slip of watchlist) {
  for (const leg of slip.legs || []) {
    allWatchLegs.push({
      slip: slip.name,
      status: slip.status,
      player: leg.player,
      team: leg.team,
      game: leg.game,
      pick: `${leg.market} ${leg.side} ${leg.line}`,
      grade: leg.grade,
      prob: leg.calibratedDistributionProb ?? null,
      edge: leg.edge,
      books: leg.books
    });
  }
}

allWatchLegs.sort((a, b) => {
  const bp = Number(b.prob || 0);
  const ap = Number(a.prob || 0);
  if (bp !== ap) return bp - ap;
  return Number(b.edge || 0) - Number(a.edge || 0);
});

const coverageMarkets = coverage.byMarket || coverage.markets || {};
const totals = Object.values(coverageMarkets).reduce(
  (a, x) => {
    a.total += Number(x.total || 0);
    a.modeled += Number(x.modeled || 0);
    return a;
  },
  { total: 0, modeled: 0 }
);

const coverageRate =
  totals.total > 0 ? (totals.modeled / totals.total).toFixed(4) : "unknown";

console.log(`\nDAILY SUMMARY ${date}\n`);
console.log("playable slips:", playable.length);
console.log("watchlist slips:", watchlist.length);
console.log("calibration rows:", caldb.length);
console.log("distribution coverage:", coverageRate);
console.log("calibration curve buckets:", Object.keys(curves.buckets || curves).length);
console.log("history archived:", fs.existsSync(histDir) ? "yes" : "no");

console.log("\nTOP WATCHLIST LEGS\n");
console.table(allWatchLegs.slice(0, 12));

console.log("\nWATCHLIST SLIPS\n");
console.table(
  watchlist.map(s => ({
    slip: s.name,
    status: s.status,
    size: s.size,
    complete: s.complete,
    green: s.green,
    neutral: s.neutral,
    correlation: s.correlation
  }))
);
