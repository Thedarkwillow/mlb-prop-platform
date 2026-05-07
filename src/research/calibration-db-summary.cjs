const fs = require("fs");

const dbPath = "data/calibration/calibration-db.json";
if (!fs.existsSync(dbPath)) {
  console.error("missing:", dbPath);
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(dbPath, "utf8"))
  .filter(x => x.result === "HIT" || x.result === "MISS");

function bucket(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  if (p >= 0.70) return "70%+";
  if (p >= 0.65) return "65-70%";
  if (p >= 0.60) return "60-65%";
  if (p >= 0.55) return "55-60%";
  return "<55%";
}

function summarize(keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] ||= { picks: 0, hits: 0, misses: 0, hitRate: 0 };
    out[k].picks++;
    if (r.result === "HIT") out[k].hits++;
    if (r.result === "MISS") out[k].misses++;
  }
  for (const v of Object.values(out)) {
    v.hitRate = v.picks ? Number((v.hits / v.picks).toFixed(4)) : 0;
  }
  return out;
}

const report = {
  totalFinished: rows.length,
  byMarket: summarize(r => r.market || "unknown"),
  byGrade: summarize(r => r.grade || "unknown"),
  byProbabilityBucket: summarize(r => bucket(r.calibratedDistributionProb)),
  bySavant: summarize(r => r.savant || "unknown")
};

console.log("CALIBRATION DB SUMMARY");
console.log("Finished legs:", report.totalFinished);
console.log("By market:");
console.table(report.byMarket);
console.log("By grade:");
console.table(report.byGrade);
console.log("By probability bucket:");
console.table(report.byProbabilityBucket);
console.log("By Savant:");
console.table(report.bySavant);

fs.writeFileSync(
  "data/calibration/calibration-db-summary.json",
  JSON.stringify(report, null, 2)
);
console.log("Wrote data/calibration/calibration-db-summary.json");
