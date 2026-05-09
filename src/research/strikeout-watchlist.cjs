const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const rows = readJson("outputs/priced-board.json", []);

const ks = rows
  .filter(r =>
    String(r.market || r.stat || "").toLowerCase() === "strikeouts" &&
    String(r.oddsTier || "").toLowerCase() === "standard" &&
    (r.side || r.recommendedSide) &&
    Number.isFinite(Number(r.recommendedProb)) &&
    Number(r.recommendedProb) >= 0.52 &&
    !String(r.game || "").includes("null")
  )
  .sort((a,b) => Number(b.expectedValue || 0) - Number(a.expectedValue || 0));

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/strikeout-watchlist.json", JSON.stringify(ks, null, 2));

console.log("STRIKEOUT WATCHLIST");
console.log("===================");
console.log(`Rows: ${ks.length}`);
console.table(ks.slice(0, 25).map(r => ({
  player: r.player,
  team: r.team,
  game: r.game,
  pick: `${r.market} ${r.side || r.recommendedSide} ${r.line}`,
  projection: r.projection,
  prob: r.recommendedProb,
  ev: r.expectedValue,
  conf: r.confidenceBucket
})));
