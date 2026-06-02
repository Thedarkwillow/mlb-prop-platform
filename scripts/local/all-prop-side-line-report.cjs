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

const OUT_JSON = `outputs/all-prop-side-line-report-${DATE}.json`;
const OUT_LATEST = "outputs/all-prop-side-line-report-latest.json";
const OUT_TXT = `outputs/all-prop-side-line-report-${DATE}.txt`;
const OUT_TXT_LATEST = "outputs/all-prop-side-line-report-latest.txt";

const EXCLUDED_DERIVED_PATTERNS = [
  /all-prop-side-line-report/i,
  /hrr-side-line-report/i,
  /fantasy-side-repair-report/i,
  /production-candidate-class-roi/i,
  /manual-lean-watchlist-grades/i,
  /bases-more-half-controlled-audit/i,
  /hrr-less-controlled-unlocks/i,
  /context-coverage/i,
  /pitch-type-real-coverage/i,
  /real-pitch-type-target-list/i,
  /slip-type-optimization/i,
  /blocked-candidate-explain/i,
  /line-specific-block-audit/i,
  /controlled-line-unlocks/i
];

const INCLUDED_HINTS = [
  /graded/i,
  /grades/i,
  /full-board/i,
  /decision-layer/i,
  /fantasy/i,
  /results/i,
  /postgame/i
];

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

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (p.includes("node_modules") || p.includes(".git")) continue;
      walk(p, out);
    } else if (ent.isFile() && p.endsWith(".json")) {
      out.push(p);
    }
  }
  return out;
}

function unique(arr) {
  return [...new Set(arr)];
}

function discoverSourceFiles() {
  const manual = [
    "outputs/graded-props.json",
    "outputs/fantasy-graded.json",
    "outputs/decision-layer-grades-latest.json",
    `outputs/history/${DATE}-full-board-graded.json`,
    `outputs/history/${DATE}-decision-layer-grades.json`,
    `outputs/history/${DATE}-production-hitter-boxscore-grades.json`,
    `outputs/production-candidate-class-grades-${DATE}.json`
  ];

  const discovered = [
    ...walk("outputs"),
    ...walk("data/results"),
    ...walk("data/history")
  ].filter(file => {
    const base = path.basename(file);
    const full = file.replace(/\\/g, "/");

    if (!base.endsWith(".json")) return false;
    if (EXCLUDED_DERIVED_PATTERNS.some(rx => rx.test(full))) return false;
    if (!INCLUDED_HINTS.some(rx => rx.test(full))) return false;

    // Prefer either current date files or broad/latest grade stores.
    if (full.includes(DATE)) return true;
    if (/latest/i.test(full)) return true;
    if (/graded-props|fantasy-graded|decision-layer-grades/i.test(full)) return true;

    return false;
  });

  return unique([...manual, ...discovered]).filter(f => fs.existsSync(f));
}

function flat(v, out = []) {
  if (!v) return out;

  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }

  if (typeof v !== "object") return out;

  if (
    v.player || v.playerName || v.name ||
    v.market || v.stat || v.statType ||
    v.side || v.pick || v.recommendedSide ||
    v.line !== undefined || v.ppLine !== undefined ||
    v.result || v.gradeResult || v.outcome ||
    v.actual !== undefined || v.actualValue !== undefined || v.statValue !== undefined
  ) {
    out.push(v);
  }

  for (const val of Object.values(v)) flat(val, out);
  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "hits+runs+rbis": "hrr",
    "hits runs rbis": "hrr",
    "hits runs rb is": "hrr",
    "total bases": "bases",
    "bases": "bases",
    "hits": "hits",
    "runs": "runs",
    "rbis": "rbis",
    "rbi": "rbis",
    "singles": "singles",
    "doubles": "doubles",
    "triples": "triples",
    "home runs": "home_runs",
    "home run": "home_runs",
    "hr": "home_runs",
    "walks": "walks",
    "stolen bases": "stolen_bases",
    "stolen_bases": "stolen_bases",
    "hitter fantasy score": "hitter_fantasy_score",
    "hitter_fantasy_score": "hitter_fantasy_score",
    "pitcher fantasy score": "pitcher_fantasy_score",
    "pitcher_fantasy_score": "pitcher_fantasy_score",
    "pitcher strikeouts": "strikeouts",
    "strikeouts": "strikeouts",
    "earned runs allowed": "earned_runs_allowed",
    "earned_runs_allowed": "earned_runs_allowed",
    "hits allowed": "hits_allowed",
    "hits_allowed": "hits_allowed",
    "walks allowed": "walks_allowed",
    "walks_allowed": "walks_allowed",
    "pitching outs": "pitching_outs",
    "pitching_outs": "pitching_outs",
    "pitches thrown": "pitches_thrown",
    "pitches_thrown": "pitches_thrown"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  if (s === "MORE" || s === "LESS") return s;
  return "UNKNOWN";
}

function resultNorm(r) {
  const s = String(r.result ?? r.gradeResult ?? r.outcome ?? r.status ?? r.hitMiss ?? "").toUpperCase().trim();
  if (["HIT", "WIN", "W", "CASH", "CORRECT"].includes(s)) return "HIT";
  if (["MISS", "LOSS", "L", "LOSE", "INCORRECT"].includes(s)) return "MISS";
  if (["PUSH", "VOID", "REFUND", "DNP"].includes(s)) return s;
  return "";
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function dateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function rowDate(r, sourceFile) {
  return (
    r.date ||
    r.slateDate ||
    r.gameDate ||
    r.gradeDate ||
    dateOnly(r.startTime || r.game_start || r.start_time || r.updated_at || r.timestamp) ||
    (String(sourceFile).match(/\d{4}-\d{2}-\d{2}/)?.[0]) ||
    DATE
  );
}

function playerName(r) {
  return String(r.player || r.playerName || r.name || "").trim();
}

function lineBucket(line) {
  const n = num(line, null);
  if (n === null) return "unknown";
  if (n <= 0.5) return "0.5";
  if (n <= 1.5) return "1.5";
  if (n <= 2.5) return "2.5";
  if (n <= 3.5) return "3.5";
  if (n <= 4.5) return "4.5";
  if (n <= 5.5) return "5.5";
  if (n <= 8.5) return "6.0-8.5";
  if (n <= 12.5) return "9.0-12.5";
  return "13.0+";
}

function dedupeKey(r) {
  return [
    rowDate(r, r._sourceFile),
    norm(playerName(r)),
    marketNorm(r.market || r.stat || r.statType),
    sideNorm(r.side || r.pick || r.recommendedSide),
    num(r.line ?? r.ppLine ?? r.prizepicksLine, "NA"),
    resultNorm(r),
    num(r.actual ?? r.actualValue ?? r.final ?? r.value ?? r.statValue, "NA")
  ].join("|");
}

function sourceRank(file) {
  const f = String(file);
  if (/full-board-graded/i.test(f)) return 1;
  if (/decision-layer-grades/i.test(f)) return 2;
  if (/fantasy-graded/i.test(f)) return 3;
  if (/graded-props/i.test(f)) return 4;
  if (/production-hitter-boxscore-grades/i.test(f)) return 5;
  if (/production-candidate-class-grades/i.test(f)) return 6;
  return 9;
}

function betterRow(a, b) {
  const ar = sourceRank(a._sourceFile);
  const br = sourceRank(b._sourceFile);
  if (ar !== br) return ar < br ? a : b;

  const aHasSide = sideNorm(a.side || a.pick || a.recommendedSide) !== "UNKNOWN";
  const bHasSide = sideNorm(b.side || b.pick || b.recommendedSide) !== "UNKNOWN";
  if (aHasSide !== bHasSide) return aHasSide ? a : b;

  const aHasResult = ["HIT", "MISS"].includes(resultNorm(a));
  const bHasResult = ["HIT", "MISS"].includes(resultNorm(b));
  if (aHasResult !== bHasResult) return aHasResult ? a : b;

  return a;
}

function add(map, key, r) {
  if (!map.has(key)) {
    map.set(key, {
      bucket: key,
      total: 0,
      graded: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      refunds: 0,
      pending: 0,
      examples: []
    });
  }

  const row = map.get(key);
  const res = resultNorm(r);

  row.total++;

  if (res === "HIT") {
    row.graded++;
    row.hits++;
  } else if (res === "MISS") {
    row.graded++;
    row.misses++;
  } else if (res === "PUSH") {
    row.pushes++;
  } else if (["VOID", "REFUND", "DNP"].includes(res)) {
    row.refunds++;
  } else {
    row.pending++;
  }

  if (row.examples.length < 8 && (res === "HIT" || res === "MISS")) {
    row.examples.push({
      date: rowDate(r, r._sourceFile),
      player: playerName(r) || null,
      team: r.team || null,
      market: marketNorm(r.market || r.stat || r.statType),
      side: sideNorm(r.side || r.pick || r.recommendedSide),
      line: num(r.line ?? r.ppLine ?? r.prizepicksLine, null),
      result: res,
      actual: r.actual ?? r.actualValue ?? r.final ?? r.value ?? r.statValue ?? null,
      source: r._sourceFile
    });
  }
}

function finalize(row) {
  const hitRate = row.graded ? row.hits / row.graded : null;
  const roiProxy = row.graded ? (row.hits - row.misses) / row.graded : null;

  let action = "IGNORE";
  if (row.graded >= 100 && hitRate >= 0.62 && roiProxy > 0.15) action = "PROMOTION_CANDIDATE";
  else if (row.graded >= 50 && hitRate >= 0.58 && roiProxy > 0.10) action = "WATCHLIST";
  else if (row.graded >= 25 && hitRate >= 0.56 && roiProxy > 0.05) action = "SMALL_SAMPLE_WATCH";
  else if (row.graded >= 25 && hitRate < 0.48) action = "SUPPRESS_OR_BLOCK";
  else if (row.graded < 25) action = "TOO_SMALL";

  return {
    ...row,
    hitRate,
    roiProxy,
    hitRatePct: hitRate === null ? "n/a" : `${(hitRate * 100).toFixed(1)}%`,
    roiProxyPct: roiProxy === null ? "n/a" : `${(roiProxy * 100).toFixed(1)}%`,
    action
  };
}

const sourceFiles = discoverSourceFiles();
const rawRows = [];
const sourceCounts = {};

for (const file of sourceFiles) {
  const data = read(file, null);
  if (!data) continue;

  let count = 0;
  for (const r of flat(data, [])) {
    const market = marketNorm(r.market || r.stat || r.statType);
    const side = sideNorm(r.side || r.pick || r.recommendedSide);
    const line = num(r.line ?? r.ppLine ?? r.prizepicksLine, null);
    const res = resultNorm(r);

    if (!market || market === "unknown") continue;
    if (!["MORE", "LESS", "UNKNOWN"].includes(side)) continue;

    if (
      !res &&
      r.actual === undefined &&
      r.actualValue === undefined &&
      r.final === undefined &&
      r.value === undefined &&
      r.statValue === undefined
    ) {
      continue;
    }

    rawRows.push({
      ...r,
      _market: market,
      _side: side,
      _line: line,
      _sourceFile: file
    });
    count++;
  }

  if (count) sourceCounts[file] = count;
}

const deduped = new Map();
for (const r of rawRows) {
  const key = dedupeKey(r);
  const prev = deduped.get(key);
  deduped.set(key, prev ? betterRow(prev, r) : r);
}

const rows = [...deduped.values()];

const byMarketSide = new Map();
const byMarketSideLine = new Map();
const byMarket = new Map();

for (const r of rows) {
  const market = r._market;
  const side = r._side;
  const lb = lineBucket(r._line);

  add(byMarket, market, r);
  add(byMarketSide, `${market}|${side}`, r);
  add(byMarketSideLine, `${market}|${side}|${lb}`, r);
}

const market = [...byMarket.values()].map(finalize)
  .sort((a, b) => b.graded - a.graded || ((b.hitRate || 0) - (a.hitRate || 0)));

const marketSide = [...byMarketSide.values()].map(finalize)
  .sort((a, b) =>
    (b.action === "PROMOTION_CANDIDATE") - (a.action === "PROMOTION_CANDIDATE") ||
    (b.graded - a.graded) ||
    ((b.hitRate || 0) - (a.hitRate || 0))
  );

const marketSideLine = [...byMarketSideLine.values()].map(finalize)
  .sort((a, b) =>
    (b.action === "PROMOTION_CANDIDATE") - (a.action === "PROMOTION_CANDIDATE") ||
    (b.action === "WATCHLIST") - (a.action === "WATCHLIST") ||
    (b.graded - a.graded) ||
    ((b.hitRate || 0) - (a.hitRate || 0))
  );

const promotionCandidates = marketSideLine.filter(r => r.action === "PROMOTION_CANDIDATE");
const watchlist = marketSideLine.filter(r => ["WATCHLIST", "SMALL_SAMPLE_WATCH"].includes(r.action));
const suppress = marketSideLine.filter(r => r.action === "SUPPRESS_OR_BLOCK");

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  sourceFiles,
  sourceCounts,
  rawRows: rawRows.length,
  dedupedRows: rows.length,
  duplicateRowsRemoved: rawRows.length - rows.length,
  market,
  marketSide,
  marketSideLine,
  promotionCandidates,
  watchlist,
  suppress
};

const fmt = r =>
  `${r.bucket}: total=${r.total} graded=${r.graded} hits=${r.hits} misses=${r.misses} pending=${r.pending} hitRate=${r.hitRatePct} roiProxy=${r.roiProxyPct} action=${r.action}`;

const txt = [
  "ALL PROP SIDE / LINE REPORT",
  "===========================",
  `date: ${DATE}`,
  `sourceFiles: ${sourceFiles.length}`,
  `rawRows: ${rawRows.length}`,
  `dedupedRows: ${rows.length}`,
  `duplicateRowsRemoved: ${rawRows.length - rows.length}`,
  "",
  "SOURCE COUNTS",
  "-------------",
  ...Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([file, count]) => `${count} | ${file}`),
  "",
  "PROMOTION CANDIDATES",
  "--------------------",
  ...(promotionCandidates.length ? promotionCandidates.map(fmt) : ["none"]),
  "",
  "WATCHLIST",
  "---------",
  ...(watchlist.length ? watchlist.slice(0, 60).map(fmt) : ["none"]),
  "",
  "SUPPRESS / BLOCK",
  "----------------",
  ...(suppress.length ? suppress.slice(0, 60).map(fmt) : ["none"]),
  "",
  "MARKET",
  "------",
  ...market.slice(0, 80).map(fmt),
  "",
  "MARKET + SIDE",
  "-------------",
  ...marketSide.slice(0, 100).map(fmt),
  "",
  "MARKET + SIDE + LINE",
  "--------------------",
  ...marketSideLine.slice(0, 160).map(fmt)
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
