const fs = require("fs");

const DATE = process.env.npm_config_date || process.argv[2] || new Date().toISOString().slice(0, 10);
const CLV_FILE = `outputs/clv-report-${DATE}.json`;
const MAX_NEG_AVG_CLV = -5;
const MIN_BEAT_CLOSE = 0.40;
const MIN_SAMPLE_FOR_BEAT_CLOSE_GUARD = 5;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(x) {
  const n = Number(x);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "n/a";
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.legs)) return data.legs;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

const data = read(CLV_FILE, null);

console.log("CLV STOP-LOSS GUARD");
console.log("===================");

if (!data) {
  console.log("STATUS: CAUTION");
  console.log(`Reason: missing ${CLV_FILE}. Run npm run clv first.`);
  process.exit(0);
}

const rows = rowsOf(data);
const tracked = Number(data.trackedLegs ?? data.tracked ?? data.count ?? rows.length ?? 0);

const avgClv = Number(
  data.averageClv ??
  data.avgClv ??
  data.averageCLV ??
  data.summary?.averageClv ??
  data.summary?.avgClv ??
  (
    rows.length
      ? rows.reduce((sum, r) => sum + Number(r.clv || 0), 0) / rows.length
      : 0
  )
);

const beatClose = Number(
  data.beatCloseRate ??
  data.beatClosePct ??
  data.summary?.beatCloseRate ??
  data.summary?.beatClosePct ??
  (
    rows.length
      ? rows.filter(r => r.beatClose === true || Number(r.clv || 0) > 0).length / rows.length
      : 0
  )
);

console.log(`File: ${CLV_FILE}`);
console.log(`Tracked legs: ${tracked}`);
console.log(`Average CLV: ${avgClv.toFixed(2)} cents`);
console.log(`Beat close: ${pct(beatClose)}`);

if (tracked < 2) {
  console.log("STATUS: CAUTION");
  console.log("Reason: not enough tracked CLV legs.");
  process.exit(0);
}

if (avgClv < MAX_NEG_AVG_CLV) {
  console.log("STATUS: BLOCK");
  console.log(`Reason: average CLV below ${MAX_NEG_AVG_CLV} cents.`);
  process.exit(1);
}

if (tracked >= MIN_SAMPLE_FOR_BEAT_CLOSE_GUARD && beatClose < MIN_BEAT_CLOSE) {
  console.log("STATUS: CAUTION");
  console.log(`Reason: beat-close rate below ${pct(MIN_BEAT_CLOSE)}.`);
  process.exit(0);
}
if (tracked < MIN_SAMPLE_FOR_BEAT_CLOSE_GUARD) {
  console.log("STATUS: PASS");
  console.log(`Reason: CLV sample below ${MIN_SAMPLE_FOR_BEAT_CLOSE_GUARD}; ignoring beat-close rate unless average CLV is severely negative.`);
  process.exit(0);
}

console.log("STATUS: PASS");
console.log("Reason: CLV is acceptable.");
