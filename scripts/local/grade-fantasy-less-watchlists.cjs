const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);

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
  return String(r.market || r.stat || r.type || "")
    .toLowerCase()
    .replace(/\s+/g,"_");
}
function fantasyType(r){
  const m = market(r);
  if (m.includes("pitcher")) return "pitcher_fantasy_score";
  if (m.includes("hitter")) return "hitter_fantasy_score";
  return m;
}
function line(r){
  return Number(r.line ?? r.target ?? r.value ?? r.threshold);
}
function actual(r){
  return Number(r.actual ?? r.score ?? r.fantasyScore ?? r.points ?? r.finalScore);
}
function resultFromActual(a,l){
  if (!Number.isFinite(a) || !Number.isFinite(l)) return "UNMATCHED";
  if (a < l) return "HIT";
  if (a > l) return "MISS";
  return "PUSH";
}
function pct(a,b){ return b ? `${(a/b*100).toFixed(1)}%` : "n/a"; }
function roi(h,m){ const t=h+m; return t ? `${(((h-m)/t)*100).toFixed(1)}%` : "n/a"; }
function key(player,m,l){
  return [norm(player),m,Number(l)].join("|");
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

const watchFiles = [
  "outputs/watchlists/fantasy-less-top.json",
  "outputs/watchlists/fantasy-less-watchlist.json"
].filter(fs.existsSync);

const candidatesRaw = [];
for (const file of watchFiles) {
  for (const r of flat(read(file, []))) {
    const m = fantasyType(r);
    const l = line(r);
    const player = r.player || r.playerName || r.name;
    if (!player || !m.includes("fantasy") || !Number.isFinite(l)) continue;
    candidatesRaw.push({
      sourceFile: file,
      player,
      market: m,
      side: "LESS",
      line: l,
      raw: r
    });
  }
}

const seen = new Set();
const candidates = [];
for (const r of candidatesRaw) {
  const k = key(r.player, r.market, r.line);
  if (seen.has(k)) continue;
  seen.add(k);
  candidates.push(r);
}

const gradeRows = flat(read(`outputs/history/${DATE}-fantasy-grades.json`, []));
const gradeMap = new Map();

for (const g of gradeRows) {
  const m = fantasyType(g);
  const l = line(g);
  const player = g.player || g.playerName || g.name;
  if (!player || !m.includes("fantasy") || !Number.isFinite(l)) continue;
  const a = actual(g);
  gradeMap.set(key(player,m,l), { ...g, player, market:m, line:l, actual:a });
}

const rows = candidates.map(c => {
  const g = gradeMap.get(key(c.player,c.market,c.line));
  const a = g ? actual(g) : NaN;
  const res = resultFromActual(a, c.line);
  return {
    date: DATE,
    player: c.player,
    market: c.market,
    side: "LESS",
    line: c.line,
    lineBucket: lineBucket(c.line),
    actual: Number.isFinite(a) ? a : null,
    result: res,
    sourceFile: c.sourceFile
  };
});

const report = {
  date: DATE,
  policy: "Direct Fantasy LESS watchlist grader. Forces watchlist candidates to LESS and grades against outputs/history/YYYY-MM-DD-fantasy-grades.json actual scores. Research-only.",
  sourceFiles: watchFiles,
  candidateRows: candidates.length,
  fantasyGradeRows: gradeRows.length,
  summary: summarize(rows),
  byType: group(rows, r => r.market),
  byTypeLine: group(rows, r => `${r.market}|${r.lineBucket}`),
  rows
};

const outJson = `outputs/fantasy-less-watchlist-graded-${DATE}.json`;
const outTxt = `outputs/fantasy-less-watchlist-graded-${DATE}.txt`;
fs.writeFileSync(outJson, JSON.stringify(report, null, 2));

const lines = [];
lines.push("DIRECT FANTASY LESS WATCHLIST GRADES");
lines.push("====================================");
lines.push(`date=${DATE}`);
lines.push(report.policy);
lines.push(`candidateRows=${report.candidateRows}`);
lines.push(`fantasyGradeRows=${report.fantasyGradeRows}`);
lines.push("");
lines.push(`summary: graded=${report.summary.graded} hits=${report.summary.hits} misses=${report.summary.misses} pushes=${report.summary.pushes} unmatched=${report.summary.unmatched} hitRate=${report.summary.hitRate} roiProxy=${report.summary.roiProxy}`);
lines.push("");
lines.push("BY TYPE");
for (const r of report.byType) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
lines.push("");
lines.push("BY TYPE + LINE");
for (const r of report.byTypeLine) lines.push(`${r.bucket}: graded=${r.graded} hits=${r.hits} misses=${r.misses} unmatched=${r.unmatched} hitRate=${r.hitRate} roiProxy=${r.roiProxy}`);
fs.writeFileSync(outTxt, lines.join("\n"));

console.log(report.summary);
console.log("BY TYPE");
console.table(report.byType);
console.log("BY TYPE + LINE");
console.table(report.byTypeLine);
console.log(`saved: ${outJson}`);
console.log(`saved: ${outTxt}`);
