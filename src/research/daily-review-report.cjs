const fs = require("fs");

const DATE = process.argv[2] || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);
const PLAYABLE = "outputs/playable-final-slips.json";
const GRADED = `outputs/playable-final-slips-graded-${DATE}.json`;
const OUT = `outputs/daily-review-${DATE}.json`;

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) out[row[key] || "UNKNOWN"] = (out[row[key] || "UNKNOWN"] || 0) + 1;
  return out;
}

function edgeBucket(edge) {
  if (edge >= 0.15) return "15%+";
  if (edge >= 0.10) return "10-15%";
  if (edge >= 0.05) return "5-10%";
  return "<5%";
}

const slips = readJson(PLAYABLE, []);
const graded = readJson(GRADED, null);

const byKey = new Map();
for (const slip of slips) {
  for (const leg of slip.legs || []) {
    const key = `${leg.player}|${leg.market}|${leg.side}|${leg.line}`;
    if (!byKey.has(key)) byKey.set(key, { ...leg, slips: [] });
    byKey.get(key).slips.push(slip.name);
  }
}

const uniqueLegs = [...byKey.values()].sort((a, b) => (b.adjustedEdge ?? b.edge ?? 0) - (a.adjustedEdge ?? a.edge ?? 0));

const marketCounts = countBy(uniqueLegs, "market");
const savantCounts = countBy(uniqueLegs, "savant");
const edgeBuckets = {};
for (const leg of uniqueLegs) edgeBuckets[edgeBucket(Number(leg.edge || 0))] = (edgeBuckets[edgeBucket(Number(leg.edge || 0))] || 0) + 1;

const warnings = [];
const marketNames = Object.keys(marketCounts);
const savantDowngrades = uniqueLegs.filter(x => x.savant === "DOWNGRADE").length;

if (marketNames.length === 1 && uniqueLegs.length >= 3) {
  warnings.push(`MARKET_CONCENTRATION: all ${uniqueLegs.length} playable legs are ${marketNames[0]}`);
}
if (savantDowngrades === uniqueLegs.length && uniqueLegs.length > 0) {
  warnings.push(`SAVANT_RISK: all ${uniqueLegs.length} playable legs are Savant DOWNGRADE`);
}
if (uniqueLegs.length < 4) {
  warnings.push(`THIN_BOARD: only ${uniqueLegs.length} unique playable legs`);
}

const topLegs = uniqueLegs.map((x, i) => ({
  rank: i + 1,
  player: x.player,
  team: x.team,
  game: x.game,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: x.edge,
  adjEdge: x.adjustedEdge,
  grade: x.grade,
  books: x.books,
  savant: x.savant,
  slips: x.slips.join(", ")
}));

const review = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  playableSlipCount: slips.length,
  uniquePlayableLegCount: uniqueLegs.length,
  marketCounts,
  savantCounts,
  edgeBuckets,
  riskWarnings: warnings,
  topPlayableLegs: topLegs,
  grading: graded
    ? {
        hits: graded.hits ?? null,
        misses: graded.misses ?? null,
        pushes: graded.pushes ?? null,
        unknown: graded.unknown ?? null
      }
    : null
};

fs.writeFileSync(OUT, JSON.stringify(review, null, 2));

console.log(`\nDAILY REVIEW ${DATE}`);
console.log(`Playable slips: ${review.playableSlipCount}`);
console.log(`Unique playable legs: ${review.uniquePlayableLegCount}`);

console.log("\nMarket counts:");
console.table(marketCounts);

console.log("\nSavant counts:");
console.table(savantCounts);

console.log("\nEdge buckets:");
console.table(edgeBuckets);

console.log("\nRisk warnings:");
console.table(warnings.length ? warnings : ["OK"]);

console.log("\nTop playable legs:");
console.table(topLegs);

console.log("\nGrading:");
console.table(review.grading || { hits: null, misses: null, pushes: null, unknown: null });

console.log(`\nWrote ${OUT}`);
