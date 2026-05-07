const fs = require("fs");
const cp = require("child_process");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const slips = readJson("outputs/playable-final-slips.json", []);
const caldb = readJson("data/calibration/calibration-db.json", []);
const coverage = readJson("outputs/distribution-coverage-report.json", {});
const summary = readJson("data/calibration/calibration-db-summary.json", {});
const curves = readJson("data/calibration/calibration-curves.json", {});

let commit = "unknown";

try {
  commit = cp.execSync(
    "git log -1 --oneline",
    { encoding: "utf8" }
  ).trim();
} catch {}

const coveragePct =
  coverage.coverage ??
  coverage.overall?.coverage ??
  (
    typeof coverage.total === "number" &&
    typeof coverage.modeled === "number" &&
    coverage.total > 0
      ? (coverage.modeled / coverage.total).toFixed(4)
      : "unknown"
  );

const finishedLegs =
  summary.finishedLegs ??
  summary.overall?.finishedLegs ??
  caldb.filter(
    x => x.result === "HIT" || x.result === "MISS"
  ).length;

const curveBuckets =
  Array.isArray(curves)
    ? curves.length
    : Object.keys(curves.buckets || curves || {}).length;

console.log("\nMLB PROP PLATFORM STATUS\n");

console.log("latest commit:", commit);
console.log("playable slips:", slips.length);
console.log("calibration db rows:", caldb.length);
console.log("distribution coverage:", coveragePct);
console.log("calibration finished legs:", finishedLegs);
console.log("calibration curve buckets:", curveBuckets);

console.log("\nScripts:");
console.log("npm run pipeline --date=YYYY-MM-DD");
console.log("npm run show");
console.log("npm run status");
console.log("npm run calibration:curves");
console.log("npm run caldb:summary");
