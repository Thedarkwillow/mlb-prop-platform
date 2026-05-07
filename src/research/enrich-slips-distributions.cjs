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

  if (market === "strikeouts") distribution = modelStrikeouts(leg);
  if (market === "hrr") distribution = modelHrr(leg);

  let distributionProb = null;
  const side = String(leg.side || "").toUpperCase();

  if (distribution) {
    if (side === "MORE") distributionProb = distribution.probMore;
    if (side === "LESS") distributionProb = distribution.probLess;
  }

  let calibratedDistributionProb = distributionProb;
  if (Number.isFinite(distributionProb)) {
    calibratedDistributionProb = 0.5 + ((distributionProb - 0.5) * 0.55);
    calibratedDistributionProb = Math.max(0.02, Math.min(0.98, calibratedDistributionProb));
    calibratedDistributionProb = Number(calibratedDistributionProb.toFixed(4));
  }

  return {
    ...leg,
    distributionModel: distribution,
    distributionProb,
    calibratedDistributionProb
  };
}

const priced = readJson("outputs/slips-priced.json", []);
const final = readJson("outputs/final-slips.json", null);
const playable = readJson("outputs/playable-final-slips.json", null);

let legs = [];
if (Array.isArray(priced) && priced.length) {
  legs = priced.filter(x => x.qualityGrade !== "FADE");
} else {
  const slips = final?.slips || playable?.slips || final || playable || [];
  legs = Array.isArray(slips) ? slips.flatMap(s => s.legs || []) : [];
}

const enriched = legs.map(enrichLeg);

fs.writeFileSync(
  "outputs/slips-distribution-enriched.json",
  JSON.stringify(enriched, null, 2)
);

console.log("Wrote outputs/slips-distribution-enriched.json");
console.log("legs:", enriched.length);
console.log("distribution modeled:", enriched.filter(x => x.distributionModel).length);

console.table(enriched.slice(0, 20).map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  raw: x.distributionProb,
  calibrated: x.calibratedDistributionProb,
  confidence: x.distributionModel?.confidence
})));
