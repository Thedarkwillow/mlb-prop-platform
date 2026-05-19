const fs = require("fs");
const { optimizeSlipType } = require("../lib/slipTypeOptimizer.cjs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const payouts = read("data/config/prizepicks-slip-payouts.json", {});
const inputPath = process.argv[2] || "outputs/playable-final-slips.json";
const outputPath = process.argv[3] || "outputs/playable-final-slips.json";

const slips = read(inputPath, []);
if (!Array.isArray(slips)) throw new Error(`${inputPath} must be an array`);

const optimized = slips.map(s => optimizeSlipType(s, payouts));

fs.writeFileSync(outputPath, JSON.stringify(optimized, null, 2) + "\n");
fs.writeFileSync("outputs/slip-type-optimization.json", JSON.stringify(optimized.map(s => ({
  name: s.name,
  size: s.size,
  entryType: s.entryType,
  complete: s.complete,
  powerEv: s.slipTypeOptimization?.powerEv,
  flexEv: s.slipTypeOptimization?.flexEv,
  bestEv: s.slipTypeOptimization?.bestEv,
  avgLegProb: s.slipTypeOptimization?.avgLegProb,
  legProbs: s.slipTypeOptimization?.legProbs
})), null, 2) + "\n");

console.log("SLIP TYPE OPTIMIZATION");
console.table(optimized.map(s => ({
  slip: s.name,
  size: s.size,
  selected: s.entryType,
  powerEv: s.slipTypeOptimization?.powerEv,
  flexEv: s.slipTypeOptimization?.flexEv,
  bestEv: s.slipTypeOptimization?.bestEv,
  avgProb: s.slipTypeOptimization?.avgLegProb
})));
console.log("Wrote", outputPath);
console.log("Wrote outputs/slip-type-optimization.json");
