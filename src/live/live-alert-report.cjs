const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = `outputs/live/mlb-live-inning-graded-${date}.json`;
const FALLBACK = "outputs/live/mlb-live-inning-graded-latest.json";
const OUT = `outputs/live/mlb-live-alert-report-${date}.json`;
const LATEST = "outputs/live/mlb-live-alert-report-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function pct(n) {
  return Number.isFinite(n) ? Number((n * 100).toFixed(1)) : null;
}

function sideOf(r) {
  return String(r.side || "").toUpperCase();
}

function marketOf(r) {
  return String(r.market || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const decisions = hits + misses;
  const roi = decisions ? (hits - misses) / decisions : null;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    hitRate: decisions ? Number((hits / decisions).toFixed(4)) : null,
    hitRatePct: decisions ? pct(hits / decisions) : null,
    roi: Number.isFinite(roi) ? Number(roi.toFixed(4)) : null,
    roiPct: Number.isFinite(roi) ? pct(roi) : null
  };
}

function groupBy(rows, fn) {
  const map = new Map();
  for (const r of rows) {
    const k = fn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()].map(([bucket, group]) => ({
    bucket,
    ...summarize(group)
  }));
}

function actionFor(summary) {
  if (summary.graded < 10) return "TRACK_ONLY";
  if (summary.hitRate >= 0.62 && summary.roi > 0.10) return "WATCH_BOOST";
  if (summary.hitRate <= 0.48 && summary.roi < -0.10) return "WATCH_SUPPRESS";
  return "NEUTRAL";
}

const rows = read(INPUT, null) || read(FALLBACK, []);
const marketSide = groupBy(rows, r => `${marketOf(r)} ${sideOf(r)}`)
  .map(x => ({ ...x, action: actionFor(x) }))
  .sort((a, b) => b.graded - a.graded || String(a.bucket).localeCompare(String(b.bucket)));

const inningMarketSide = groupBy(rows, r => `inning_${r.inningWindow || "unknown"} ${marketOf(r)} ${sideOf(r)}`)
  .map(x => ({ ...x, action: actionFor(x) }))
  .sort((a, b) => b.graded - a.graded || String(a.bucket).localeCompare(String(b.bucket)));

const notGradedReasons = groupBy(
  rows.filter(r => r.gradeStatus !== "GRADED"),
  r => (r.gradeReasons || ["unknown"])[0] || "unknown"
).sort((a, b) => b.rows - a.rows);

const gradedRows = rows
  .filter(r => ["HIT", "MISS", "PUSH"].includes(r.result))
  .map(r => ({
    player: r.player,
    team: r.team,
    game: r.resolvedGame || r.game,
    inningWindow: r.inningWindow,
    market: r.market,
    side: r.side,
    line: r.line,
    actual: r.actual,
    result: r.result
  }));

const report = {
  date,
  generatedAt: new Date().toISOString(),
  inputUsed: fs.existsSync(INPUT) ? INPUT : FALLBACK,
  note: "Report-only MLB Live alert layer. No bet recommendations until real sample validates.",
  overall: summarize(rows),
  marketSide,
  inningMarketSide,
  notGradedReasons,
  gradedRows
};

write(OUT, report);
write(LATEST, report);

console.log("MLB LIVE ALERT REPORT");
console.log("---------------------");
console.log("date:", date);
console.log("input:", report.inputUsed);
console.log("overall:");
console.table([report.overall]);

console.log("Market / Side:");
console.table(marketSide.map(x => ({
  bucket: x.bucket,
  graded: x.graded,
  hitRate: x.hitRatePct,
  roi: x.roiPct,
  action: x.action
})));

console.log("Inning / Market / Side:");
console.table(inningMarketSide.map(x => ({
  bucket: x.bucket,
  graded: x.graded,
  hitRate: x.hitRatePct,
  roi: x.roiPct,
  action: x.action
})));

if (notGradedReasons.length) {
  console.log("Not graded reasons:");
  console.table(notGradedReasons.map(x => ({
    reason: x.bucket,
    rows: x.rows
  })));
}

console.log("saved:", OUT);
console.log("saved:", LATEST);
