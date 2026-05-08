const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function line(s = "") {
  console.log(s);
}

const playable = read("outputs/playable-final-slips.json", []);
const watchlist = read("outputs/watchlist-final-slips.json", []);
const coverage = read("outputs/distribution-coverage-report.json", {});
const market = read("outputs/market-exposure-report.json", {});
const status = read("outputs/status.json", null);

line("MOBILE MLB PROP SUMMARY");
line("=======================");
line(`Playable slips: ${playable.length}`);
line(`Watchlist slips: ${watchlist.length}`);
line(`Distribution coverage: ${coverage.coverage ?? coverage.overallCoverage ?? "unknown"}`);
line("");

line("BEST PLAYABLE SLIP");
line("------------------");

const best = playable[0];
if (!best) {
  line("None");
} else {
  line(`${best.name || best.slip || "Slip"} | status=${best.status || "PLAYABLE"} | green=${best.green ?? "?"}`);
  for (const [i, leg] of (best.legs || []).entries()) {
    line(
      `${i + 1}. ${leg.player} | ${leg.team || ""} | ${leg.game || ""} | ${leg.market || leg.stat} ${leg.side || leg.recommendedSide} ${leg.line} | prob=${leg.calibratedDistributionProb ?? leg.prob ?? "?"} | edge=${leg.sportsbookEdge ?? leg.edge ?? "?"} | books=${leg.sportsbookBookCount ?? leg.books ?? "?"}`
    );
  }
}

line("");
line("TOP ALL PLAYABLE SLIPS");
line("----------------------");
for (const slip of playable.slice(0, 6)) {
  line(`${slip.name || slip.slip} | size=${slip.size || slip.legs?.length || "?"} | green=${slip.green ?? "?"} | status=${slip.status}`);
}

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/mobile-summary.txt", "");
