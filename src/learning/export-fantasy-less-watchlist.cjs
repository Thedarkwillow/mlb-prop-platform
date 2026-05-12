const fs = require("fs");
const { fantasyPolicy } = require("../policy/fantasyPolicy.cjs");

function readJson(p, fallback = []) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const board = readJson("outputs/priced-board.json", []);

const rows = board
  .filter(r => r.recordType === "merged_prop")
  .map(r => ({ ...r, ...fantasyPolicy(r) }))
  .filter(r =>
    r.isFantasy &&
    r.fantasyEligible &&
    r.fantasyWatchlist &&
    String(r.fantasyReason || "").includes("hitter_fantasy_less") &&
    String(r.oddsTier || r.tier || "standard").toLowerCase() !== "goblin"
  )
  .sort((a, b) => {
    const ap = a.fantasyPolicy === "strong_watchlist" ? 1 : 0;
    const bp = b.fantasyPolicy === "strong_watchlist" ? 1 : 0;
    return bp - ap || Number(b.line || 0) - Number(a.line || 0);
  });

fs.mkdirSync("outputs/watchlists", { recursive: true });
fs.writeFileSync("outputs/watchlists/fantasy-less-watchlist.json", JSON.stringify(rows, null, 2));

const lines = [];
lines.push("FANTASY LESS CONTROLLED WATCHLIST");
lines.push("=================================");
lines.push(`Rows: ${rows.length}`);
lines.push("Rules:");
lines.push("- hitter fantasy LESS only");
lines.push("- no goblins");
lines.push("- line >= 3");
lines.push("- strong if line >= 6");
lines.push("- watchlist only, not official slip eligible");
lines.push("");

const textRows = rows.slice(0, 50);
lines.push(`Showing top ${textRows.length} of ${rows.length}`);
lines.push("");

for (const [i, r] of textRows.entries()) {
  const side =
    r.side ||
    r.recommendedSide ||
    (Number(r.projection) < Number(r.line) ? "LESS" : "");
  lines.push(`${i + 1}. ${r.player} | ${r.team} | ${r.market || r.stat} ${side} ${r.line} | policy=${r.fantasyPolicy} | reason=${r.fantasyReason}`);
}

fs.writeFileSync("outputs/watchlists/fantasy-less-watchlist.txt", lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("Wrote outputs/watchlists/fantasy-less-watchlist.json");
console.log("Wrote outputs/watchlists/fantasy-less-watchlist.txt");
