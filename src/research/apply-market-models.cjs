const fs = require("fs");
const { applyMarketModel } = require("../models/router.cjs");

const IN = "outputs/final-slips.json";
const OUT = "outputs/final-slips-modeled.json";

if (!fs.existsSync(IN)) {
  throw new Error(`Missing ${IN}. Run npm run picks first.`);
}

const raw = JSON.parse(fs.readFileSync(IN, "utf8"));
const slips = Array.isArray(raw) ? raw : (raw.slips || []);

const modeled = slips.map(slip => ({
  ...slip,
  legs: (slip.legs || []).map(applyMarketModel)
}));

fs.writeFileSync(OUT, JSON.stringify(modeled, null, 2));

const legs = modeled.flatMap(s => s.legs || []);
const byModel = {};
for (const l of legs) {
  byModel[l.marketModel] = (byModel[l.marketModel] || 0) + 1;
}

console.log("APPLIED MARKET MODELS");
console.table(Object.entries(byModel).map(([marketModel, legs]) => ({ marketModel, legs })));
console.log(`Wrote ${OUT}`);
