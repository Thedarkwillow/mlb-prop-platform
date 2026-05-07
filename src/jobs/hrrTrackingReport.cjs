const fs = require("fs");

const date = process.argv[2];
if (!date) {
  console.error("Usage: node src/jobs/hrrTrackingReport.cjs YYYY-MM-DD");
  process.exit(1);
}

const OUT_JSON = `outputs/history/${date}-hrr-tracking-report.json`;
const OUT_TXT = `outputs/history/${date}-hrr-tracking-report.txt`;

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function k(v) {
  return String(v || "").trim().toLowerCase();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function sideOf(r) {
  return String(r.recommendedSide || r.side || r.pick || r.direction || "").toUpperCase();
}

function marketOf(r) {
  return k(r.market || r.stat || r.rawStat);
}

function isHrr(r) {
  const m = marketOf(r);
  return m === "hrr" || m.includes("hits+runs+rbis");
}

function bucketProb(v) {
  const x = n(v);
  if (x >= 0.75) return "75%+";
  if (x >= 0.70) return "70-74.9%";
  if (x >= 0.65) return "65-69.9%";
  if (x >= 0.60) return "60-64.9%";
  if (x >= 0.55) return "55-59.9%";
  return "<55%";
}

function summarize(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const key = keyFn(r) || "unknown";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

const priced = readJson("outputs/priced-board.json", []);
const rows = priced
  .filter(r => r.recordType === "merged_prop" && isHrr(r))
  .map(r => ({
    player: r.player || "",
    team: r.team || "",
    game: r.game || "",
    market: marketOf(r),
    side: sideOf(r),
    line: r.line,
    recommendedProb: n(r.recommendedProb),
    expectedValue: n(r.expectedValue),
    confidenceBucket: r.confidenceBucket || "",
    probabilityBucket: bucketProb(r.recommendedProb),
    vegasDriven: r.vegasDriven === true,
    savantMatched: r.savantMatched === true,
  }));

const lines = [];
lines.push("HRR TRACKING REPORT");
lines.push(`Date: ${date}`);
lines.push(`Rows: ${rows.length}`);
lines.push("");

lines.push("BY SIDE");
lines.push("-------");
for (const [key, val] of Object.entries(summarize(rows, r => r.side))) lines.push(`${key}: ${val}`);
lines.push("");

lines.push("BY LINE");
lines.push("-------");
for (const [key, val] of Object.entries(summarize(rows, r => String(r.line)))) lines.push(`${key}: ${val}`);
lines.push("");

lines.push("BY CONFIDENCE");
lines.push("-------------");
for (const [key, val] of Object.entries(summarize(rows, r => r.confidenceBucket))) lines.push(`${key}: ${val}`);
lines.push("");

lines.push("BY PROBABILITY BUCKET");
lines.push("---------------------");
for (const [key, val] of Object.entries(summarize(rows, r => r.probabilityBucket))) lines.push(`${key}: ${val}`);
lines.push("");

lines.push("DETAILS");
lines.push("-------");
for (const r of rows) {
  lines.push(`${r.player} | ${r.team} | ${r.game} | HRR ${r.side} ${r.line} | Prob: ${r.recommendedProb} | EV: ${r.expectedValue} | Conf: ${r.confidenceBucket}`);
}

fs.writeFileSync(OUT_JSON, JSON.stringify(rows, null, 2));
fs.writeFileSync(OUT_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log(`Saved JSON: ${OUT_JSON}`);
console.log(`Saved TXT: ${OUT_TXT}`);
