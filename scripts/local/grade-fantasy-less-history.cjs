const fs = require("fs");
const path = require("path");

const START = process.argv[2] || "2026-06-04";
const END = process.argv[3] || START;
const HIST_DIR = "outputs/history";

const OUT_JSON = `outputs/fantasy-less-history-graded-${START}-to-${END}.json`;
const OUT_TXT = `outputs/fantasy-less-history-graded-${START}-to-${END}.txt`;

function read(p,f){try{return JSON.parse(fs.readFileSync(p,"utf8"))}catch{return f}}
function flat(v,out=[]){
  if (!v) return out;
  if (Array.isArray(v)) { for (const x of v) flat(x,out); return out; }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.stat) out.push(v);
  for (const x of Object.values(v)) if (x && typeof x === "object") flat(x,out);
  return out;
}
function norm(v){
  return String(v||"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g,"")
    .replace(/[^a-z0-9]+/g,"");
}
function market(r){
  const m = String(r.market || r.stat || r.type || "").toLowerCase().replace(/\s+/g,"_");
  if (m.includes("pitcher")) return "pitcher_fantasy_score";
  if (m.includes("hitter")) return "hitter_fantasy_score";
  return m;
}
function line(r){ return Number(r.line ?? r.target ?? r.value ?? r.threshold); }
function actual(r){ return Number(r.actual ?? r.score ?? r.fantasyScore ?? r.points ?? r.finalScore); }
function key(player,m,l){ return [norm(player),m,Number(l)].join("|"); }
function resultLess(a,l){
  if (!Number.isFinite(a) || !Number.isFinite(l)) return "UNMATCHED";
  if (a < l) return "HIT";
  if (a > l) return "MISS";
  return "PUSH";
}
function pct(a,b){ return b ? `${(a/b*100).toFixed(1)}%` : "n/a"; }
function roi(h,m){ const t=h+m; return t ? `${(((h-m)/t)*100).toFixed(1)}%` : "n/a"; }
function lineBucket(l){
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
function summarize(rows){
  const graded = rows.filter(r => r.result === "HIT" || r.result === "MISS");
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = rows.filter(r => r.result === "PUSH").length;
  const unmatched = rows.filter(r => r.result === "UNMATCHED").length;
  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
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

const dates = fs.existsSync(HIST_DIR)
  ? fs.readdirSync(HIST_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}-fantasy-grades\.json$/.test(f))
      .map(f => f.slice(0,10))
      .filter(d => d >= START && d <= END)
      .sort()
  : [];

const allRows = [];
const dateSummaries = [];

for (const date of dates) {
  const gradeFile = path.join(HIST_DIR, `${date}-fantasy-grades.json`);
  const watchFiles = [
    path.join(HIST_DIR, `${date}-fantasy-less-top.json`),
    path.join(HIST_DIR, `${date}-fantasy-less-watchlist.json`)
  ].filter(fs.existsSync);

  const rawCandidates = [];
  for (const file of watchFiles) {
    for (const r of flat(read(file, []))) {
      const player = r.player || r.playerName || r.name;
      const m = market(r);
      const l = line(r);
      if (!player || !m.includes("fantasy") || !Number.isFinite(l)) continue;
      rawCandidates.push({
        date,
        player,
        market: m,
        side: "LESS",
        line: l,
        lineBucket: lineBucket(l),
        sourceFile: file
      });
    }
  }

  const seen = new Set();
  const candidates = [];
  for (const r of rawCandidates) {
    const k = key(r.player, r.market, r.line);
    if (seen.has(k)) continue;
    seen.add(k);
    candidates.push(r);
  }

  const grades = flat(read(gradeFile, []));
  const gradeMap = new Map();
  for (const g of grades) {
    const player = g.player || g.playerName || g.name;
    const m = market(g);
    const l = line(g);
    if (!player || !m.includes("fantasy") || !Number.isFinite(l)) continue;
    gradeMap.set(key(player,m,l), { ...g, actual: actual(g) });
  }

  const rows = candidates.map(c => {
    const g = gradeMap.get(key(c.player,c.market,c.line));
    const a = g ? actual(g) : NaN;
    return {
      ...c,
      actual: Number.isFinite(a) ? a : null,
      result: resultLess(a, c.line)
    };
  });

  allRows.push(...rows);
  dateSummaries.push({
    date,
    fantasyGradeRows: grades.length,
    watchFiles,
    ...summarize(rows)
  });
}

const report = {
  start: START,
  end: END,
  policy: "Date-specific Fantasy LESS history grader. Uses outputs/history/YYYY-MM-DD-fantasy-less-watchlist/top snapshots and same-date fantasy-grades actuals. Research-only.",
  dates,
  dateSummaries,
  summary: summarize(allRows),
  byType: group(allRows, r => r.market),
  byTypeLine: group(allRows, r => `${r.market}|${r.lineBucket}`),
  byDate: group(allRows, r => r.date),
  rows: allRows
};

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

const lines = [];
lines.push("DATE-SPECIFIC FANTASY LESS HISTORY GRADES");
lines.push("=========================================");
lines.push(`range=${START} to ${END}`);
lines.push(report.policy);
lines.push("");
lines.push(`summary: graded=${report.summary.graded} hits=${report.summary.hits} misses=${report.summary.misses} pushes=${report.summary.pushes} unmatched=${report.summary.unmatched} hitRate=${report.summary.hitRate} roiProxy=${report.summary.roiProxy}`);
lines.push("");
lines.push("BY TYPE");
for (const r of report.byType) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("BY TYPE + LINE");
for (const r of report.byTypeLine) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("BY DATE");
for (const r of report.byDate) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
fs.writeFileSync(OUT_TXT, lines.join("\n"));

console.log(report.summary);
console.log("BY TYPE");
console.table(report.byType);
console.log("BY TYPE + LINE");
console.table(report.byTypeLine);
console.log("BY DATE");
console.table(report.byDate);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
