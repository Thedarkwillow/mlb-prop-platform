const fs = require("fs");
const { fantasyPolicy } = require("../policy/fantasyPolicy.cjs");

function readJson(p, fallback = []) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function inferredSide(r) {
  if (r.side || r.recommendedSide) return r.side || r.recommendedSide;

  const projection = Number(r.projection);
  const line = Number(r.line);

  if (Number.isFinite(projection) && Number.isFinite(line)) {
    if (projection < line) return "LESS";
    if (projection > line) return "MORE";
  }

  return "";
}

const BAD_TEAMS = new Set(["SF", "ATL", "PIT"]);

const board = readJson("outputs/priced-board.json", []);

const rows = board
  .filter(r => r.recordType === "merged_prop")
  .map(r => ({
    ...r,
    inferredSide: inferredSide(r),
    ...fantasyPolicy(r)
  }))
  .filter(r =>
    r.isFantasy &&
    r.fantasyEligible &&
    r.fantasyWatchlist &&
    r.inferredSide === "LESS" &&
    !BAD_TEAMS.has(String(r.team || "").toUpperCase()) &&
    (
      (
        String(r.market || r.stat || "").toLowerCase().includes("hitter") &&
        Number(r.line) >= 6.5
      ) ||
      (
        String(r.market || r.stat || "").toLowerCase().includes("pitcher") &&
        Number(r.line) >= 20
      )
    ) &&
    !["goblin", "demon"].includes(String(r.oddsTier || r.tier || "").toLowerCase())
  )
  .sort((a, b) => {
    const score = x =>
      x.fantasyPolicy === "elite_watchlist" ? 3 :
      x.fantasyPolicy === "strong_watchlist" ? 2 :
      x.fantasyPolicy === "watchlist" ? 1 :
      0;
    const ap = score(a);
    const bp = score(b);
    return bp - ap || Number(b.line || 0) - Number(a.line || 0);
  })
  .slice(0, 25);

fs.mkdirSync("outputs/watchlists", { recursive: true });

fs.writeFileSync(
  "outputs/watchlists/fantasy-less-top.json",
  JSON.stringify(rows, null, 2)
);

let text = "";
text += "FANTASY LESS TOP CANDIDATES\n";
text += "=================================\n";
text += `Rows: ${rows.length}\n\n`;

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const market = r.market || r.stat || "Hitter Fantasy Score";
  text += `${i + 1}. ${r.player} | ${r.team} | ${market} ${r.inferredSide} ${r.line} | policy=${r.fantasyPolicy}\n`;
}

fs.writeFileSync("outputs/watchlists/fantasy-less-top.txt", text);
console.log(text);

console.log("Wrote outputs/watchlists/fantasy-less-top.json");
console.log("Wrote outputs/watchlists/fantasy-less-top.txt");
