const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const OUT_JSON = `outputs/manual-lean-watchlist-grades-${DATE}.json`;
const OUT_LATEST = "outputs/manual-lean-watchlist-grades-latest.json";
const OUT_TXT = `outputs/manual-lean-watchlist-grades-${DATE}.txt`;
const OUT_TXT_LATEST = "outputs/manual-lean-watchlist-grades-latest.txt";

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.stat || v.side || v.line || v.result || v.gradeResult || v.outcome) out.push(v);
  for (const val of Object.values(v)) flat(val, out);
  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "total bases": "bases",
    "bases": "bases",
    "hits runs rbis": "hrr",
    "hits run rbis": "hrr",
    "hits runs rbi": "hrr",
    "hits runs rb is": "hrr",
    "hits runs rbis": "hrr",
    "hrr": "hrr",
    "hits": "hits",
    "singles": "singles",
    "doubles": "doubles",
    "triples": "triples",
    "home runs": "home_runs",
    "home run": "home_runs",
    "hr": "home_runs",
    "runs": "runs",
    "rbis": "rbis",
    "rbi": "rbis",
    "walks": "walks",
    "stolen bases": "stolen_bases",
    "hitter fantasy score": "hitter_fantasy_score",
    "fantasy score": "hitter_fantasy_score",
    "strikeouts": "strikeouts",
    "pitcher strikeouts": "strikeouts",
    "pitching outs": "pitching_outs",
    "pitches thrown": "pitches_thrown",
    "hits allowed": "hits_allowed",
    "earned runs allowed": "earned_runs_allowed",
    "walks allowed": "walks_allowed",
    "pitcher fantasy score": "pitcher_fantasy_score"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function resultNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (["HIT", "WIN", "W", "CASH", "CORRECT"].includes(s)) return "HIT";
  if (["MISS", "LOSS", "L", "LOSE", "INCORRECT"].includes(s)) return "MISS";
  if (["PUSH", "VOID", "REFUND", "DNP"].includes(s)) return s;
  return "";
}

function key(r) {
  return [
    norm(r.player || r.playerName || r.name),
    marketNorm(r.market || r.stat || r.statType),
    sideNorm(r.side || r.pick || r.recommendedSide),
    String(num(r.line ?? r.ppLine ?? r.prizepicksLine, ""))
  ].join("|");
}

function looseKey(r) {
  return [
    norm(r.player || r.playerName || r.name),
    marketNorm(r.market || r.stat || r.statType),
    String(num(r.line ?? r.ppLine ?? r.prizepicksLine, ""))
  ].join("|");
}

function rawResultText(row) {
  return String(row?.result ?? row?.gradeResult ?? row?.outcome ?? row?.status ?? row?.hitMiss ?? "").toUpperCase().trim();
}

function hasActualValue(row) {
  return num(row?.actual ?? row?.actualValue ?? row?.final ?? row?.value ?? row?.statValue, null) !== null;
}

function usableGrade(row) {
  const res = resultNorm(rawResultText(row));
  return ["HIT", "MISS", "PUSH", "REFUND", "VOID", "DNP"].includes(res) || hasActualValue(row);
}

function gradeFromActual(candidate, graded) {
  const existing = resultNorm(rawResultText(graded));
  if (existing) return existing;

  const actual = num(graded.actual ?? graded.actualValue ?? graded.final ?? graded.value ?? graded.statValue, null);
  const line = num(candidate.line ?? graded.line, null);
  const side = sideNorm(candidate.side || graded.side);

  if (actual === null || line === null || !side) return "UNMATCHED";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNMATCHED";
}

function sourceClass(file, row) {
  if (row.class || row.classification || row.candidateClass) return row.class || row.classification || row.candidateClass;
  if (file.includes("lean-final")) return "LEAN_FINAL";
  if (file.includes("lean-watchlist")) return "LEAN_WATCHLIST";
  if (file.includes("watchlist-final")) return "WATCHLIST_FINAL";
  return "MANUAL";
}

function bucketStats(rows, labelFn) {
  const m = new Map();
  for (const row of rows) {
    const bucket = labelFn(row) || "unknown";
    if (!m.has(bucket)) {
      m.set(bucket, { bucket, total: 0, graded: 0, hits: 0, misses: 0, pushes: 0, refunds: 0, unmatched: 0, pending: 0 });
    }
    const b = m.get(bucket);
    b.total++;
    const res = resultNorm(row.result);
    if (res === "HIT") { b.graded++; b.hits++; }
    else if (res === "MISS") { b.graded++; b.misses++; }
    else if (res === "PUSH") b.pushes++;
    else if (["REFUND", "VOID", "DNP"].includes(res)) b.refunds++;
    else if (row.result === "UNMATCHED") b.unmatched++;
    else b.pending++;
  }
  return [...m.values()].map(x => ({
    ...x,
    hitRate: x.graded ? x.hits / x.graded : null,
    roiProxy: x.graded ? (x.hits - x.misses) / x.graded : null
  })).sort((a, b) => b.total - a.total || String(a.bucket).localeCompare(String(b.bucket)));
}

function pct(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? "n/a" : `${(Number(v) * 100).toFixed(1)}%`;
}

function statLine(x) {
  return `${x.bucket}: total=${x.total} graded=${x.graded} hits=${x.hits} misses=${x.misses} unmatched=${x.unmatched} pending=${x.pending} hitRate=${pct(x.hitRate)} roiProxy=${pct(x.roiProxy)}`;
}

const candidateFiles = [
  `outputs/lean-final-slips-${DATE}.json`,
  "outputs/lean-final-slips.json",
  "outputs/lean-watchlist-candidates.json",
  "outputs/watchlist-final-slips.json"
];

const gradeFiles = [
  `outputs/history/${DATE}-production-hitter-boxscore-grades.json`,
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  `outputs/history/${DATE}-fantasy-grades.json`,
  `outputs/history/${DATE}-hrr-graded.json`,
  "outputs/full-board-graded.json",
  "outputs/decision-layer-grades-latest.json",
  "outputs/fantasy-graded.json",
  "outputs/graded-props.json"
];

const candidates = [];
for (const file of candidateFiles) {
  const data = read(file, null);
  if (!data) continue;
  const rows = flat(data, []);
  for (const row of rows) {
    if (!(row.player || row.playerName || row.name) || !(row.market || row.stat) || !(row.line ?? row.ppLine ?? row.prizepicksLine)) continue;
    candidates.push({ ...row, sourceFile: file, class: sourceClass(file, row) });
  }
}

const gradeRows = [];
for (const file of gradeFiles) {
  const data = read(file, null);
  if (!data) continue;
  for (const row of flat(data, [])) gradeRows.push({ ...row, gradeSourceFile: file });
}

const exact = new Map();
const loose = new Map();
for (const row of gradeRows) {
  if (!usableGrade(row)) continue;
  const k = key(row);
  const lk = looseKey(row);
  if (!exact.has(k)) exact.set(k, row);
  if (!loose.has(lk)) loose.set(lk, row);
}

const rows = candidates.map(c => {
  const match = exact.get(key(c)) || loose.get(looseKey(c)) || null;
  const result = match ? gradeFromActual(c, match) : "UNMATCHED";
  return {
    date: DATE,
    class: c.class || "MANUAL",
    player: c.player || c.playerName || c.name || null,
    team: c.team || null,
    market: marketNorm(c.market || c.stat || c.statType),
    side: sideNorm(c.side || c.pick || c.recommendedSide),
    line: c.line ?? c.ppLine ?? c.prizepicksLine ?? null,
    oddsTier: c.oddsTier || c.tier || "standard",
    prob: c.prob ?? c.recommendedProb ?? c.pickProb ?? null,
    edge: c.edge ?? c.expectedValue ?? null,
    result: resultNorm(result) || "UNMATCHED",
    actual: match?.actual ?? match?.actualValue ?? match?.final ?? match?.value ?? null,
    matched: !!match && resultNorm(result) !== "",
    sourceFile: c.sourceFile,
    gradeSourceFile: match?.gradeSourceFile || null,
    sourceCandidate: c
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  candidateFiles,
  gradeFiles,
  candidateRows: candidates.length,
  gradeRows: gradeRows.length,
  rows,
  byClass: bucketStats(rows, r => r.class),
  byMarketSide: bucketStats(rows, r => `${r.market}|${r.side}`),
  byTier: bucketStats(rows, r => r.oddsTier)
};

const txt = [
  "MANUAL / LEAN / WATCHLIST GRADES",
  "================================",
  `date: ${DATE}`,
  `candidateRows: ${candidates.length}`,
  `gradeRows: ${gradeRows.length}`,
  "",
  "BY CLASS",
  "--------",
  ...report.byClass.map(statLine),
  "",
  "BY MARKET/SIDE",
  "--------------",
  ...report.byMarketSide.map(statLine),
  "",
  "ROWS",
  "----",
  ...rows.slice(0, 50).map(r => `${r.result} | ${r.class} | ${r.player} | ${r.market} ${r.side} ${r.line} | actual=${r.actual ?? "n/a"} | source=${r.gradeSourceFile || "n/a"}`)
].join("\n");

writeJson(OUT_JSON, report);
writeJson(OUT_LATEST, report);
writeText(OUT_TXT, txt);
writeText(OUT_TXT_LATEST, txt);

console.log(txt);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_LATEST}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved: ${OUT_TXT_LATEST}`);
