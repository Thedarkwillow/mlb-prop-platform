const fs = require("fs");
const { canonicalMarket, inferSourceType } = require("../utils/propIdentity.cjs");

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

const rows = read("outputs/priced-board.json", [])
  .filter(r => r.recordType === "merged_prop");

const byMarket = {};
for (const r of rows) {
  const market = canonicalMarket(r);
  const inferred = inferSourceType(r);
  const priced = r.pricingStatus === "PRICED";
  const hasProjection = r.projection !== null && r.projection !== undefined && Number.isFinite(Number(r.projection));
  const hasBallpark = Boolean(r.ballpark);
  const key = market;

  if (!byMarket[key]) {
    byMarket[key] = {
      total: 0,
      priced: 0,
      hasProjection: 0,
      hasBallpark: 0,
      inferredPitcher: 0,
      sourceTypeNull: 0
    };
  }

  byMarket[key].total++;
  if (priced) byMarket[key].priced++;
  if (hasProjection) byMarket[key].hasProjection++;
  if (hasBallpark) byMarket[key].hasBallpark++;
  if (inferred === "pitcher") byMarket[key].inferredPitcher++;
  if (!r.sourceType) byMarket[key].sourceTypeNull++;
}

const table = Object.entries(byMarket)
  .map(([market, x]) => ({
    market,
    total: x.total,
    priced: x.priced,
    pricedRate: ((x.priced / x.total) * 100).toFixed(1) + "%",
    hasProjection: x.hasProjection,
    hasBallpark: x.hasBallpark,
    sourceTypeNull: x.sourceTypeNull,
    inferredPitcher: x.inferredPitcher
  }))
  .sort((a, b) => b.total - a.total);

console.table(table);
fs.mkdirSync("data/diagnostics", { recursive: true });
fs.writeFileSync("data/diagnostics/merge-coverage.json", JSON.stringify(table, null, 2));
console.log("Wrote data/diagnostics/merge-coverage.json");
