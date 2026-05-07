const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const rows = readJson("outputs/slips-distribution-enriched.json", []);
const byMarket = {};

for (const r of rows) {
  const market = r.market || r.stat || "unknown";
  if (!byMarket[market]) {
    byMarket[market] = {
      total: 0,
      modeled: 0,
      missing: 0,
      avgCalibratedProb: 0
    };
  }

  byMarket[market].total++;

  if (r.distributionModel) {
    byMarket[market].modeled++;
    if (Number.isFinite(Number(r.calibratedDistributionProb))) {
      byMarket[market].avgCalibratedProb += Number(r.calibratedDistributionProb);
    }
  } else {
    byMarket[market].missing++;
  }
}

for (const market of Object.keys(byMarket)) {
  const x = byMarket[market];
  x.coverage = Number((x.modeled / x.total).toFixed(4));
  x.avgCalibratedProb = x.modeled
    ? Number((x.avgCalibratedProb / x.modeled).toFixed(4))
    : null;
}

const output = {
  generatedAt: new Date().toISOString(),
  totalLegs: rows.length,
  modeledLegs: rows.filter(x => x.distributionModel).length,
  missingLegs: rows.filter(x => !x.distributionModel).length,
  markets: byMarket
};

fs.writeFileSync(
  "outputs/distribution-coverage-report.json",
  JSON.stringify(output, null, 2)
);

console.log("DISTRIBUTION COVERAGE REPORT");
console.log(`total legs: ${output.totalLegs}`);
console.log(`modeled: ${output.modeledLegs}`);
console.log(`missing: ${output.missingLegs}`);
console.table(byMarket);
console.log("Wrote outputs/distribution-coverage-report.json");
