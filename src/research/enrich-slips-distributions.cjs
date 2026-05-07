const fs = require("fs");
const { modelStrikeouts } = require("../models/markets/strikeouts.cjs");
const { modelHrr } = require("../models/markets/hrr.cjs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normMarket(s) {
  s = String(s || "").toLowerCase().trim();
  if (s.includes("strikeout")) return "strikeouts";
  if (s.includes("hrr") || s.includes("hits + runs + rbis")) return "hrr";
  if (s.includes("total bases")) return "bases";
  if (s.includes("hits")) return "hits";
  return s;
}

function enrichLeg(leg) {
  const market = normMarket(leg.market || leg.stat);
  let distribution = null;

  if (market === "strikeouts") {
    distribution = modelStrikeouts(leg);
  }
  if (market === "hrr") {
    distribution = modelHrr(leg);
  }

  return {
    ...leg,
    market,
    distributionModel: distribution ? distribution.distribution : null,
    distributionMean: distribution ? distribution.mean : null,
    distributionVariance: distribution ? distribution.variance : null,
    distributionProbMore: distribution ? distribution.probMore : null,
    distributionProbLess: distribution ? distribution.probLess : null,
    distributionFairLine: distribution ? distribution.fairLine : null,
    distributionConfidence: distribution ? distribution.confidence : null
  };
}

const priced = readJson("outputs/slips-priced.json", []);
const rows = Array.isArray(priced) ? priced : priced.rows || priced.legs || [];

const enriched = rows.map(enrichLeg);

fs.writeFileSync("outputs/slips-distribution-enriched.json", JSON.stringify(enriched, null, 2));

console.log("Wrote outputs/slips-distribution-enriched.json");
console.log("legs:", enriched.length);
console.log("distribution modeled:", enriched.filter(x => x.distributionModel).length);
console.table(
  enriched
    .filter(x => x.distributionModel)
    .slice(0, 20)
    .map(x => ({
      player: x.player,
      market: x.market,
      side: x.side,
      line: x.line,
      mean: x.distributionMean,
      probMore: x.distributionProbMore,
      probLess: x.distributionProbLess,
      confidence: x.distributionConfidence
    }))
);
