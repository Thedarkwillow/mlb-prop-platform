const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const graded = readJson(`outputs/playable-final-slips-graded-${date}.json`, null);

if (!graded) {
  console.error(`Missing graded file for ${date}`);
  process.exit(1);
}

const legs =
  graded.legResults ||
  graded.legs ||
  (graded.slips || []).flatMap(s => s.legs || []);
const seen = new Set();
const finished = legs.filter(x => {
  if (x.result !== "HIT" && x.result !== "MISS") return false;
  const k = [
    x.player,
    x.market,
    x.side,
    x.line,
    x.gamePk || x.game
  ].join("|");
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

function bucket(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return "unknown";
  if (p >= 0.70) return "70%+";
  if (p >= 0.65) return "65-70%";
  if (p >= 0.60) return "60-65%";
  if (p >= 0.55) return "55-60%";
  return "<55%";
}

function summarize(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] ||= { picks: 0, hits: 0, misses: 0, hitRate: 0 };
    out[k].picks++;
    if (r.result === "HIT") out[k].hits++;
    if (r.result === "MISS") out[k].misses++;
  }
  for (const v of Object.values(out)) {
    v.hitRate = v.picks ? +(v.hits / v.picks).toFixed(4) : null;
  }
  return out;
}

const report = {
  date,
  totalFinished: finished.length,
  byMarket: summarize(finished, x => x.market || "unknown"),
  byBucket: summarize(finished, x => bucket(x.calibratedDistributionProb)),
  byGrade: summarize(finished, x => x.grade || "unknown")
};

fs.writeFileSync(`outputs/calibration-report-${date}.json`, JSON.stringify(report, null, 2));

console.log(`CALIBRATION REPORT ${date}`);
console.log("Finished legs:", finished.length);
console.log("By market:");
console.table(report.byMarket);
console.log("By probability bucket:");
console.table(report.byBucket);
console.log("By grade:");
console.table(report.byGrade);
