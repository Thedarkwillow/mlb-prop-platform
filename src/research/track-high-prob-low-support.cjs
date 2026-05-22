const fs = require("fs");

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function dateArg() {
  const idx = process.argv.findIndex(x => x === "--date");
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

function keyOf(r) {
  return [
    r.date,
    r.player,
    r.team,
    r.market,
    r.side,
    r.line,
    r.tier
  ].join("|");
}

const date = dateArg();
const final = readJson("outputs/final-slips.json", {});
const topLegs = Array.isArray(final.topLegs) ? final.topLegs : [];

const outPath = "data/tracking/high-prob-low-support.json";
const existing = readJson(outPath, []);

const tracked = topLegs
  .filter(r => Number(r.calibratedDistributionProb ?? r.distributionProb ?? 0) >= 0.70)
  .filter(r => Number(r.books ?? 0) <= 2)
  .filter(r => !r.finalExecutionGate?.passed || r.finalMarketGatePassed === false || r.grade !== "GREEN")
  .map(r => ({
    date,
    player: r.player,
    team: r.team,
    game: r.game || r.resolvedGame || null,
    market: r.market,
    side: r.side,
    line: r.line,
    prob: Number(r.calibratedDistributionProb ?? r.distributionProb ?? 0),
    rawProb: Number(r.distributionProb ?? 0),
    edge: Number(r.edge ?? 0),
    adjustedEdge: Number(r.adjustedEdge ?? 0),
    books: Number(r.books ?? 0),
    tier: r.oddsTier || r.specialTier || "standard",
    grade: r.grade || null,
    support: r.marketSupportFlag || r.priceCoverageTier || null,
    reason: "HIGH_PROB_LOW_SUPPORT",
    includedInSlip: false,
    result: null
  }));

const map = new Map(existing.map(r => [keyOf(r), r]));
for (const r of tracked) map.set(keyOf(r), r);

const merged = [...map.values()].sort((a, b) =>
  String(b.date).localeCompare(String(a.date)) ||
  Number(b.prob) - Number(a.prob)
);

writeJson(outPath, merged);

console.log("HIGH PROB LOW SUPPORT TRACKER");
console.log("=============================");
console.log({
  date,
  found: tracked.length,
  totalTracked: merged.length,
  output: outPath
});

console.table(tracked.map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  prob: r.prob,
  books: r.books,
  tier: r.tier,
  grade: r.grade
})));
