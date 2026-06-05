const fs = require("fs");

const START = process.argv[2] || "2026-06-02";
const END = process.argv[3] || "2026-06-04";

const IN = `outputs/reverse-pf-under-context-backtest-${START}-to-${END}.json`;
const OUT_JSON = `outputs/reverse-pf-under-watch-${START}-to-${END}.json`;
const OUT_TXT = `outputs/reverse-pf-under-watch-${START}-to-${END}.txt`;

function read(p,f){try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return f}}
function pct(a,b){return b ? `${(a/b*100).toFixed(1)}%` : "n/a"}
function roi(h,m){const t=h+m; return t ? `${(((h-m)/t)*100).toFixed(1)}%` : "n/a"}

const report = read(IN, null);
if (!report) throw new Error(`Missing backtest file: ${IN}`);

const strongBuckets = new Set([
  "rbis|1.5",
  "hits|1.5",
  "walks|0.5",
  "rbis|0.5"
]);

const rows = (report.rows || []).filter(r => {
  const bucket = `${r.market}|${r.line}`;
  return (
    strongBuckets.has(bucket) &&
    r.status === "REVERSE_CONTEXT_WATCH_UNDER" &&
    Number(r.score) >= 0.60 &&
    Number(r.sampleSize) >= 5
  );
});

function summarize(rs){
  const hits = rs.filter(r => r.result === "HIT").length;
  const misses = rs.filter(r => r.result === "MISS").length;
  return {
    rows: rs.length,
    graded: hits + misses,
    hits,
    misses,
    hitRate: pct(hits, hits + misses),
    roiProxy: roi(hits, misses)
  };
}

function group(rs, fn){
  const out = {};
  for (const r of rs) (out[fn(r)] ||= []).push(r);
  return Object.entries(out)
    .map(([bucket, xs]) => ({ bucket, ...summarize(xs) }))
    .sort((a,b)=>b.graded-a.graded);
}

const output = {
  start: START,
  end: END,
  policy: "Research/watch only. Extracts only strongest Reverse PF Under v3 buckets. No official/lean promotion.",
  allowedBuckets: [...strongBuckets],
  summary: summarize(rows),
  byMarketLine: group(rows, r => `${r.market}|${r.line}`),
  byScoreBand: group(rows, r => {
    const s = Number(r.score);
    if (s >= 0.70) return "0.70_plus";
    if (s >= 0.65) return "0.65_0.70";
    if (s >= 0.60) return "0.60_0.65";
    return "below_0.60";
  }),
  rows
};

fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2));

const lines = [];
lines.push("REVERSE PF UNDER WATCH EXTRACT");
lines.push("==============================");
lines.push(`range=${START} to ${END}`);
lines.push(output.policy);
lines.push("");
lines.push(`summary: graded=${output.summary.graded} hits=${output.summary.hits} misses=${output.summary.misses} hitRate=${output.summary.hitRate} roiProxy=${output.summary.roiProxy}`);
lines.push("");
lines.push("BY MARKET + LINE");
for (const r of output.byMarketLine) {
  lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
}
lines.push("");
lines.push("BY SCORE BAND");
for (const r of output.byScoreBand) {
  lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
}
fs.writeFileSync(OUT_TXT, lines.join("\n"));

console.log(output.summary);
console.log("BY MARKET + LINE");
console.table(output.byMarketLine);
console.log("BY SCORE BAND");
console.table(output.byScoreBand);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
