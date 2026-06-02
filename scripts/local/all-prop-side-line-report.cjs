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

const SOURCE_FILES = [
  "outputs/graded-props.json",
  "outputs/fantasy-graded.json",
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  "outputs/decision-layer-grades-latest.json",
  `outputs/production-candidate-class-grades-${DATE}.json`,
  "outputs/production-candidate-class-roi-latest.json",
  "outputs/manual-lean-watchlist-grades-latest.json",
  "outputs/fantasy-side-repair-report-latest.json",
  "outputs/hrr-side-line-report-latest.json"
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

function flat(v, out = []) {
  if (!v) return out;

  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }

  if (typeof v !== "object") return out;

  if (
    v.player || v.playerName || v.name ||
    v.market || v.stat || v.side || v.line ||
    v.result || v.gradeResult || v.outcome ||
    v.actual !== undefined || v.actualValue !== undefined
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
    "home runs": "home_runs",
    "home run": "home_runs",
    "hitter fantasy score": "hitter_fantasy_score",
    "pitcher fantasy score": "pitcher_fantasy_score",
    "pitcher strikeouts": "strikeouts",
    "earned runs allowed": "earned_runs_allowed",
    "hits allowed": "hits_allowed",
    "walks allowed": "walks_allowed",
    "pitching outs": "pitching_outs"
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
      player: r.player || r.playerName || r.name || null,
      team: r.team || null,
      market: marketNorm(r.market || r.stat || r.statType),
      side: sideNorm(r.side || r.pick || r.recommendedSide),
      line: num(r.line ?? r.ppLine ?? r.prizepicksLine, null),
      result: res,
      actual: r.actual ?? r.actualValue ?? r.final ?? r.value ?? r.statValue ?? null
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

const rawRows = [];
for (const file of SOURCE_FILES) {
  const data = read(file, null);
  if (!data) continue;

  for (const r of flat(data, [])) {
    const market = marketNorm(r.market || r.stat || r.statType);
    const side = sideNorm(r.side || r.pick || r.recommendedSide);
    const line = num(r.line ?? r.ppLine ?? r.prizepicksLine, null);
    const res = resultNorm(r);

    if (!market || market === "unknown") continue;
    if (!["MORE", "LESS", "UNKNOWN"].includes(side)) continue;

    // Keep only rows that are prop-like and have a result/actual context.
    if (!res && r.actual === undefined && r.actualValue === undefined && r.final === undefined && r.value === undefined && r.statValue === undefined) continue;

    rawRows.push({
      ...r,
      _market: market,
      _side: side,
      _line: line,
      _sourceFile: file
    });
  }
}

const byMarketSide = new Map();
const byMarketSideLine = new Map();

for (const r of rawRows) {
  const market = r._market;
  const side = r._side;
  const lb = lineBucket(r._line);

  add(byMarketSide, `${market}|${side}`, r);
  add(byMarketSideLine, `${market}|${side}|${lb}`, r);
}

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
  sourceFiles: SOURCE_FILES,
  rows: rawRows.length,
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
  `rows: ${rawRows.length}`,
  "",
  "PROMOTION CANDIDATES",
  "--------------------",
  ...(promotionCandidates.length ? promotionCandidates.map(fmt) : ["none"]),
  "",
  "WATCHLIST",
  "---------",
  ...(watchlist.length ? watchlist.slice(0, 40).map(fmt) : ["none"]),
  "",
  "SUPPRESS / BLOCK",
  "----------------",
  ...(suppress.length ? suppress.slice(0, 40).map(fmt) : ["none"]),
  "",
  "MARKET + SIDE",
  "-------------",
  ...marketSide.slice(0, 80).map(fmt),
  "",
  "MARKET + SIDE + LINE",
  "--------------------",
  ...marketSideLine.slice(0, 120).map(fmt)
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
