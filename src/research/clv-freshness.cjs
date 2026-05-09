const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const DIR = `data/odds-history/${DATE}`;
const OUT = "outputs/clv-freshness.json";

function parseSnapshotTime(file) {
  const m = file.match(/odds-snapshot-(.+)\.json$/);
  if (!m) return null;
  return new Date(m[1].replace(/-/g, (x, i) => i < 10 ? x : ":"));
}

function readLatestSnapshot() {
  if (!fs.existsSync(DIR)) return null;
  const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort();
  if (!files.length) return null;
  const latestFile = files[files.length - 1];
  const fullPath = `${DIR}/${latestFile}`;
  const stat = fs.statSync(fullPath);
  return {
    date: DATE,
    dir: DIR,
    snapshots: files.length,
    first: files[0],
    latest: latestFile,
    latestPath: fullPath,
    latestMtime: stat.mtime.toISOString()
  };
}

const latest = readLatestSnapshot();
const now = Date.now();

let report;

if (!latest) {
  report = {
    date: DATE,
    status: "MISSING",
    snapshots: 0,
    stale: true,
    ageMinutes: null,
    penalty: 0.05,
    warning: "No same-day odds snapshot found. Run npm run snap."
  };
} else {
  const ageMinutes = (now - new Date(latest.latestMtime).getTime()) / 60000;
  const stale = ageMinutes > 90;
  report = {
    ...latest,
    status: stale ? "STALE" : "OK",
    stale,
    ageMinutes: Number(ageMinutes.toFixed(1)),
    penalty: stale ? 0.03 : 0,
    warning: stale ? "Latest odds snapshot is older than 90 minutes." : null
  };
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

console.log("CLV FRESHNESS");
console.log("-------------");
console.log(`date: ${report.date}`);
console.log(`status: ${report.status}`);
console.log(`snapshots: ${report.snapshots}`);
console.log(`ageMinutes: ${report.ageMinutes ?? "n/a"}`);
console.log(`penalty: ${report.penalty}`);
if (report.warning) console.log(`warning: ${report.warning}`);
console.log(`Wrote ${OUT}`);
