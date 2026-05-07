const fs = require("fs");

const dbPath = "data/calibration/calibration-db.json";

if (!fs.existsSync(dbPath)) {
  console.error("missing calibration db");
  process.exit(1);
}

const rows = JSON.parse(
  fs.readFileSync(dbPath, "utf8")
).filter(
  x => x.result === "HIT" || x.result === "MISS"
);

function bucket(p) {
  p = Number(p);

  if (!Number.isFinite(p)) return "unknown";
  if (p >= 0.75) return "75%+";
  if (p >= 0.70) return "70-75%";
  if (p >= 0.65) return "65-70%";
  if (p >= 0.60) return "60-65%";
  if (p >= 0.55) return "55-60%";

  return "<55%";
}

const buckets = {};

for (const r of rows) {
  const b = bucket(r.calibratedDistributionProb);

  buckets[b] ||= {
    picks: 0,
    hits: 0,
    misses: 0,
    expected: 0,
    actual: 0,
    calibrationError: 0
  };

  buckets[b].picks++;

  const p = Number(r.calibratedDistributionProb || 0);

  buckets[b].expected += p;

  if (r.result === "HIT") {
    buckets[b].hits++;
    buckets[b].actual += 1;
  }

  if (r.result === "MISS") {
    buckets[b].misses++;
  }
}

for (const b of Object.values(buckets)) {
  b.expectedRate =
    b.picks ? +(b.expected / b.picks).toFixed(4) : 0;

  b.actualRate =
    b.picks ? +(b.actual / b.picks).toFixed(4) : 0;

  b.calibrationError =
    +(b.actualRate - b.expectedRate).toFixed(4);
}

console.log("\nCALIBRATION CURVES\n");

console.table(buckets);

fs.writeFileSync(
  "data/calibration/calibration-curves.json",
  JSON.stringify(buckets, null, 2) + "\n"
);

console.log(
  "Wrote data/calibration/calibration-curves.json"
);
