const fs = require("fs");
const { fantasyPolicy } = require("../policy/fantasyPolicy.cjs");

function readJson(p, fallback = []) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const board = readJson("outputs/priced-board.json", []);
const rows = board.filter(r =>
  r.recordType === "merged_prop" &&
  String(r.market || r.stat || "").toLowerCase().includes("fantasy")
);

const audited = rows.map(r => ({
  player: r.player,
  team: r.team,
  market: r.market || r.stat,
  side: r.side || r.recommendedSide || (
    Number(r.projection) > Number(r.line) ? "MORE" :
    Number(r.projection) < Number(r.line) ? "LESS" :
    ""
  ),
  line: r.line,
  oddsTier: r.oddsTier || r.tier,
  ...fantasyPolicy(r)
}));

const counts = {};
for (const r of audited) {
  const k = `${r.fantasyPolicy}:${r.fantasyReason}`;
  counts[k] = (counts[k] || 0) + 1;
}

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/fantasy-policy-audit.json", JSON.stringify({ counts, rows: audited }, null, 2));

console.log("FANTASY POLICY AUDIT");
console.log("====================");
console.log(`Fantasy rows: ${audited.length}`);
console.table(Object.entries(counts).map(([reason, count]) => ({ reason, count })));
console.log("Eligible fantasy watchlist rows:");
console.table(audited.filter(r => r.fantasyEligible).slice(0, 25).map(r => ({
  player: r.player,
  team: r.team,
  market: r.market,
  side: r.side,
  line: r.line,
  policy: r.fantasyPolicy,
  reason: r.fantasyReason
})));
console.log("Wrote data/learning/fantasy-policy-audit.json");
