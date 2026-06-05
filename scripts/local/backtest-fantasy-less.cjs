const fs = require("fs");
const path = require("path");

const START = process.argv[2] || "2026-05-29";
const END = process.argv[3] || "2026-06-04";
const HIST_DIR = "outputs/history";

const OUT_JSON = `outputs/fantasy-less-backtest-${START}-to-${END}.json`;
const OUT_TXT = `outputs/fantasy-less-backtest-${START}-to-${END}.txt`;

function read(p,f){try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return f}}
function flat(v,out=[]){
  if (!v) return out;
  if (Array.isArray(v)) { for (const x of v) flat(x,out); return out; }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.stat) out.push(v);
  for (const x of Object.values(v)) if (x && typeof x === "object") flat(x,out);
  return out;
}
function market(r){
  return String(r.market || r.stat || r.type || "").toLowerCase().replace(/\s+/g,"_");
}
function side(r){
  return String(r.side || r.recommendedSide || r.pick || "").toUpperCase();
}
function line(r){
  return Number(r.line ?? r.target ?? r.value ?? r.threshold);
}
function result(r){
  return String(r.result || r.grade || r.outcome || "").toUpperCase();
}
function hit(r){ return result(r).includes("HIT"); }
function miss(r){ return result(r).includes("MISS"); }
function excluded(r){ return /EXCLUDED|PENDING|REFUND|PUSH|UNMATCHED|UNKNOWN/.test(result(r)); }
function pct(a,b){ return b ? `${(a/b*100).toFixed(1)}%` : "n/a"; }
function roi(h,m){ const t=h+m; return t ? `${(((h-m)/t)*100).toFixed(1)}%` : "n/a"; }

function lineBucket(r){
  const l = line(r);
  if (!Number.isFinite(l)) return "line_unknown";
  if (l <= 1.5) return "1.5_or_less";
  if (l <= 2.5) return "2.5";
  if (l <= 3.5) return "3.5";
  if (l <= 5.5) return "4.5_5.5";
  if (l <= 8.5) return "6.5_8.5";
  if (l <= 12.5) return "9.5_12.5";
  if (l <= 20.5) return "13.5_20.5";
  return "21.5_plus";
}
function fantasyType(r){
  const m = market(r);
  if (m.includes("pitcher")) return "pitcher_fantasy_score";
  if (m.includes("hitter")) return "hitter_fantasy_score";
  return m;
}
function summarize(rows){
  const graded = rows.filter(r => hit(r) || miss(r));
  const hits = graded.filter(hit).length;
  const misses = graded.filter(miss).length;
  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    hitRate: pct(hits, graded.length),
    roiProxy: roi(hits, misses)
  };
}
function group(rows, fn){
  const out = {};
  for (const r of rows) {
    const k = fn(r);
    out[k] ||= [];
    out[k].push(r);
  }
  return Object.entries(out)
    .map(([bucket, rs]) => ({ bucket, ...summarize(rs) }))
    .sort((a,b)=>b.graded-a.graded || String(a.bucket).localeCompare(String(b.bucket)));
}

const files = fs.existsSync(HIST_DIR)
  ? fs.readdirSync(HIST_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}-fantasy-grades\.json$/.test(f))
      .map(f => ({ date: f.slice(0,10), file: path.join(HIST_DIR, f) }))
      .filter(x => x.date >= START && x.date <= END)
      .sort((a,b)=>a.date.localeCompare(b.date))
  : [];

const allFantasy = [];
for (const f of files) {
  for (const r of flat(read(f.file, []))) {
    const m = market(r);
    if (!m.includes("fantasy")) continue;
    allFantasy.push({
      ...r,
      date: f.date,
      _market: fantasyType(r),
      _side: side(r),
      _lineBucket: lineBucket(r),
      _result: result(r)
    });
  }
}

const gradedFantasy = allFantasy.filter(r => !excluded(r) && (hit(r) || miss(r)));
const lessRows = gradedFantasy.filter(r => r._side === "LESS");
const moreRows = gradedFantasy.filter(r => r._side === "MORE");

const report = {
  start: START,
  end: END,
  policy: "Fantasy LESS backtest is research-only. Uses direct outputs/history/*-fantasy-grades.json rows only. No synthetic-only unlocks.",
  fileCount: files.length,
  summary: {
    allFantasy: summarize(gradedFantasy),
    fantasyLess: summarize(lessRows),
    fantasyMore: summarize(moreRows)
  },
  lessByType: group(lessRows, r => r._market),
  lessByTypeLine: group(lessRows, r => `${r._market}|${r._lineBucket}`),
  lessByDate: group(lessRows, r => r.date),
  moreByType: group(moreRows, r => r._market),
  allBySide: group(gradedFantasy, r => r._side || "UNKNOWN"),
  rows: lessRows
};

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

const lines = [];
lines.push("FANTASY LESS BACKTEST");
lines.push("=====================");
lines.push(`range=${START} to ${END}`);
lines.push(report.policy);
lines.push(`fantasyGradeFiles=${files.length}`);
lines.push("");
for (const [k,v] of Object.entries(report.summary)) {
  lines.push(`${k}: graded=${v.graded} hits=${v.hits} misses=${v.misses} hitRate=${v.hitRate} roiProxy=${v.roiProxy}`);
}
lines.push("");
lines.push("LESS BY TYPE");
for (const r of report.lessByType) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("LESS BY TYPE + LINE");
for (const r of report.lessByTypeLine) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("ALL BY SIDE");
for (const r of report.allBySide) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
fs.writeFileSync(OUT_TXT, lines.join("\n"));

console.log(report.summary);
console.log("LESS BY TYPE");
console.table(report.lessByType);
console.log("LESS BY TYPE + LINE");
console.table(report.lessByTypeLine);
console.log("ALL BY SIDE");
console.table(report.allBySide);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
