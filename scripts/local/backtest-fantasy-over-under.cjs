const fs = require("fs");
const path = require("path");

const START = process.argv[2] || "2026-05-29";
const END = process.argv[3] || "2026-06-04";
const HIST_DIR = "outputs/history";

const OUT_JSON = `outputs/fantasy-over-under-backtest-${START}-to-${END}.json`;
const OUT_TXT = `outputs/fantasy-over-under-backtest-${START}-to-${END}.txt`;

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
  return String(r.market || r.stat || r.type || "").toLowerCase().replace(/\s+/g,"_");
}
function fantasyType(r){
  const m = market(r);
  if (m.includes("pitcher")) return "pitcher_fantasy_score";
  if (m.includes("hitter")) return "hitter_fantasy_score";
  return m;
}
function side(r){
  return String(r.side || r.recommendedSide || r.pick || "").toUpperCase();
}
function line(r){
  return Number(r.line ?? r.target ?? r.value ?? r.threshold);
}
function actual(r){
  return Number(r.actual ?? r.score ?? r.fantasyScore ?? r.points ?? r.finalScore);
}
function result(r){
  return String(r.result || r.grade || r.outcome || "").toUpperCase();
}
function hit(r){ return result(r).includes("HIT"); }
function miss(r){ return result(r).includes("MISS"); }
function excluded(r){ return /EXCLUDED|PENDING|REFUND|UNMATCHED|UNKNOWN/.test(result(r)); }
function pct(a,b){ return b ? `${(a/b*100).toFixed(1)}%` : "n/a"; }
function roi(h,m){ const t=h+m; return t ? `${(((h-m)/t)*100).toFixed(1)}%` : "n/a"; }
function key(player,m,l){ return [norm(player),m,Number(l)].join("|"); }

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
function gradeLessFromActual(a,l){
  if (!Number.isFinite(a) || !Number.isFinite(l)) return "UNMATCHED";
  if (a < l) return "HIT";
  if (a > l) return "MISS";
  return "PUSH";
}
function gradeMoreFromActual(a,l){
  if (!Number.isFinite(a) || !Number.isFinite(l)) return "UNMATCHED";
  if (a > l) return "HIT";
  if (a < l) return "MISS";
  return "PUSH";
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

const directMoreRows = [];
for (const date of dates) {
  const rows = flat(read(path.join(HIST_DIR, `${date}-fantasy-grades.json`), []));
  for (const r of rows) {
    const m = fantasyType(r);
    const l = line(r);
    const a = actual(r);
    const s = side(r) || "MORE";
    if (!m.includes("fantasy") || s !== "MORE" || excluded(r) || !(hit(r) || miss(r))) continue;
    directMoreRows.push({
      date,
      player: r.player || r.playerName || r.name,
      market: m,
      side: "MORE",
      line: l,
      lineBucket: lineBucket(l),
      actual: Number.isFinite(a) ? a : null,
      result: hit(r) ? "HIT" : "MISS",
      source: "direct_fantasy_grades"
    });
  }
}

// Current direct LESS watchlist diagnostic.
// This intentionally grades today's saved watchlist against that date's fantasy actuals.
// Multi-day historical LESS needs dated fantasy-less watchlist snapshots later.
const lessWatchFiles = [
  "outputs/watchlists/fantasy-less-top.json",
  "outputs/watchlists/fantasy-less-watchlist.json"
].filter(fs.existsSync);

const lessCandidatesRaw = [];
for (const file of lessWatchFiles) {
  for (const r of flat(read(file, []))) {
    const m = fantasyType(r);
    const l = line(r);
    const player = r.player || r.playerName || r.name;
    if (!player || !m.includes("fantasy") || !Number.isFinite(l)) continue;
    lessCandidatesRaw.push({ player, market:m, side:"LESS", line:l, sourceFile:file });
  }
}

const lessSeen = new Set();
const lessCandidates = [];
for (const r of lessCandidatesRaw) {
  const k = key(r.player,r.market,r.line);
  if (lessSeen.has(k)) continue;
  lessSeen.add(k);
  lessCandidates.push(r);
}

const lessDate = END;
const lessGradeRows = flat(read(path.join(HIST_DIR, `${lessDate}-fantasy-grades.json`), []));
const lessGradeMap = new Map();
for (const g of lessGradeRows) {
  const m = fantasyType(g);
  const l = line(g);
  const player = g.player || g.playerName || g.name;
  if (!player || !m.includes("fantasy") || !Number.isFinite(l)) continue;
  lessGradeMap.set(key(player,m,l), {...g, actual:actual(g)});
}

const directLessRows = lessCandidates.map(c => {
  const g = lessGradeMap.get(key(c.player,c.market,c.line));
  const a = g ? actual(g) : NaN;
  return {
    date: lessDate,
    player: c.player,
    market: c.market,
    side: "LESS",
    line: c.line,
    lineBucket: lineBucket(c.line),
    actual: Number.isFinite(a) ? a : null,
    result: gradeLessFromActual(a,c.line),
    source: "current_fantasy_less_watchlist",
    sourceFile: c.sourceFile
  };
});

const allRows = [...directMoreRows, ...directLessRows];

const report = {
  start: START,
  end: END,
  policy: "Fantasy Over/Under diagnostic. MORE uses direct fantasy-grades history. LESS uses current fantasy-less watchlists graded against END date. Research-only.",
  dates,
  summary: {
    directMore: summarize(directMoreRows),
    directLessWatchlist: summarize(directLessRows),
    all: summarize(allRows)
  },
  bySide: group(allRows, r => r.side),
  moreByType: group(directMoreRows, r => r.market),
  moreByTypeLine: group(directMoreRows, r => `${r.market}|${r.lineBucket}`),
  lessByType: group(directLessRows, r => r.market),
  lessByTypeLine: group(directLessRows, r => `${r.market}|${r.lineBucket}`),
  pitcherFantasyBySide: group(allRows.filter(r => r.market === "pitcher_fantasy_score"), r => `${r.side}|${r.lineBucket}`),
  hitterFantasyBySide: group(allRows.filter(r => r.market === "hitter_fantasy_score"), r => `${r.side}|${r.lineBucket}`),
  rows: allRows
};

fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

const lines = [];
lines.push("FANTASY OVER / UNDER DIAGNOSTIC");
lines.push("===============================");
lines.push(`range=${START} to ${END}`);
lines.push(report.policy);
lines.push("");
for (const [k,v] of Object.entries(report.summary)) {
  lines.push(`${k}: graded=${v.graded} hits=${v.hits} misses=${v.misses} pushes=${v.pushes} unmatched=${v.unmatched} hitRate=${v.hitRate} roiProxy=${v.roiProxy}`);
}
lines.push("");
lines.push("MORE BY TYPE");
for (const r of report.moreByType) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("MORE BY TYPE + LINE");
for (const r of report.moreByTypeLine) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("LESS BY TYPE");
for (const r of report.lessByType) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("LESS BY TYPE + LINE");
for (const r of report.lessByTypeLine) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("PITCHER FANTASY BY SIDE");
for (const r of report.pitcherFantasyBySide) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
fs.writeFileSync(OUT_TXT, lines.join("\n"));

console.log(report.summary);
console.log("MORE BY TYPE");
console.table(report.moreByType);
console.log("MORE BY TYPE + LINE");
console.table(report.moreByTypeLine);
console.log("LESS BY TYPE");
console.table(report.lessByType);
console.log("LESS BY TYPE + LINE");
console.table(report.lessByTypeLine);
console.log("PITCHER FANTASY BY SIDE");
console.table(report.pitcherFantasyBySide);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
