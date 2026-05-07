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

function latestCommit() {
  try {
    return cp.execSync("git log -1 --oneline", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const playable = readJson("outputs/playable-final-slips.json", []);
const caldb = readJson("data/calibration/calibration-db.json", []);
const coverage = readJson("outputs/distribution-coverage-report.json", {});
const curves = readJson("data/calibration/calibration-curves.json", {});

console.log("MLB PROP PLATFORM STATUS");
console.log("latest commit:", latestCommit());
console.log("playable slips:", Array.isArray(playable) ? playable.length : 0);
console.log("calibration db rows:", Array.isArray(caldb) ? caldb.length : 0);
console.log("distribution coverage:", coverage?.coverage ?? coverage?.summary?.coverage ?? coverage?.hrr?.coverage ?? "unknown");
console.log("calibration curve buckets:", Array.isArray(curves) ? curves.length : Object.keys(curves || {}).length);

console.log("Scripts:");
console.log("npm run final --date=YYYY-MM-DD");
console.log("npm run pipeline --date=YYYY-MM-DD");
console.log("npm run show");
console.log("npm run summary --date=YYYY-MM-DD");
console.log("npm run decision");
console.log("npm run history --date=YYYY-MM-DD");
console.log("npm run markets");
console.log("npm run grade:watchlist");
console.log("npm run status");
console.log("npm run calibration:curves");
console.log("npm run caldb:summary");
