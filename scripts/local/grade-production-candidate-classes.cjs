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

const CANDIDATE_FILES = [
  `outputs/production-candidates-${DATE}.json`,
  "outputs/production-candidates.json"
];

const GRADE_SOURCES = [
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  `outputs/playable-final-slips-graded-${DATE}.json`,
  `outputs/final-slips-graded-${DATE}.json`,
  `outputs/history/${DATE}-all-markets-graded.json`,
  `outputs/history/${DATE}-fantasy-grades.json`,
  `outputs/history/${DATE}-hrr-graded.json`,
  "outputs/full-board-graded.json",
  "outputs/decision-layer-grades-latest.json",
  "outputs/all-markets-graded.json",
  "outputs/fantasy-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json"
];

const OUT_GRADES = `outputs/production-candidate-class-grades-${DATE}.json`;
const OUT_ROI = `outputs/production-candidate-class-roi-${DATE}.json`;
const OUT_ROI_LATEST = "outputs/production-candidate-class-roi-latest.json";
const OUT_TXT = `outputs/production-candidate-class-roi-${DATE}.txt`;
const OUT_TXT_LATEST = "outputs/production-candidate-class-roi-latest.txt";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
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

function getProb(r) {
  return num(
    r.prob ??
    r.recommendedProb ??
    r.calibratedDistributionProb ??
    r.contextAdjustedDistributionProb ??
    r.pickProb,
    null
  );
}

function getEdge(r) {
  return num(
    r.edge ??
    r.expectedValue ??
    r.sportsbookAdjustedEdge ??
    r.adjustedEdge ??
    r.sportsbookEdge,
    null
  );
}

function getClassRows(report) {
  if (!report) return [];
  const out = [];

  const classMap = [
    ["CORE", report.core || report.coreCandidates],
    ["LEAN", report.lean || report.leanCandidates],
    ["WATCHLIST", report.watchlist || report.watchlistCandidates],
    ["HIGH_PROBABILITY_WATCH", report.highProbabilityWatch || report.highProbabilityWatchCandidates],
    ["RESEARCH", report.research || report.researchCandidates],
    ["SHADOW_BLOCKED", report.shadowBlocked || report.shadowBlockedCandidates],
    ["BLOCKED", report.blocked || report.blockedCandidates]
  ];

  for (const [cls, rows] of classMap) {
    if (Array.isArray(rows)) {
      for (const row of rows) out.push({ ...row, class: row.class || cls });
    }
  }

  if (!out.length && Array.isArray(report.all)) return report.all;
  if (!out.length && Array.isArray(report.rows)) return report.rows;
  if (!out.length && Array.isArray(report.candidates)) return report.candidates;
  if (Array.isArray(report)) return report;

  return out;
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    v.player ||
    v.playerName ||
    v.name ||
    v.market ||
    v.stat ||
    v.side ||
    v.line ||
    v.result ||
    v.actual
  ) {
    out.push(v);
  }

  for (const val of Object.values(v)) flatten(val, out);
  return out;
}

function candidateKey(r) {
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

function resultNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (["HIT", "WIN", "W", "CASH", "CORRECT"].includes(s)) return "HIT";
  if (["MISS", "LOSS", "L", "LOSE", "INCORRECT"].includes(s)) return "MISS";
  if (["PUSH", "VOID", "REFUND", "DNP"].includes(s)) return s;
  if (["UNMATCHED", "NO_MATCH"].includes(s)) return "UNMATCHED";
  if (["SHADOW_UNGRADED", "UNPRICED_SHADOW", "THEORETICAL_UNGRADED"].includes(s)) return "SHADOW_UNGRADED";
  return "";
}

function isShadowUngradedCandidate(c) {
  const cls = String(c.class || c.classification || "").toUpperCase();
  const support = String(c.support || c.marketSupportFlag || c.priceCoverageTier || "").toUpperCase();
  const source = String(c.source || c.sourceFile || "").toLowerCase();
  const reasons = Array.isArray(c.reasons) ? c.reasons.map(x => String(x).toLowerCase()) : [];

  return (
    support === "PHASE8_UNPRICED" ||
    source === "phase8_audit" ||
    cls === "SHADOW_BLOCKED" ||
    reasons.includes("phase8_unpriced_shadow_blocked")
  );
}

function gradeFromActual(candidate, graded) {
  const existing = resultNorm(
    graded.result ??
    graded.gradeResult ??
    graded.outcome ??
    graded.status ??
    graded.hitMiss
  );
  if (existing) return existing;

  const actual = num(
    graded.actual ??
    graded.actualValue ??
    graded.final ??
    graded.value ??
    graded.statValue,
    null
  );
  const line = num(candidate.line ?? graded.line, null);
  const side = sideNorm(candidate.side || graded.side);

  if (actual === null || line === null || !side) return "UNMATCHED";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNMATCHED";
}

function bucketStats(rows, labelFn) {
  const m = new Map();

  for (const row of rows) {
    const key = labelFn(row) || "unknown";
    if (!m.has(key)) {
      m.set(key, {
        bucket: key,
        total: 0,
        graded: 0,
        hits: 0,
        misses: 0,
        pushes: 0,
        refunds: 0,
        unmatched: 0,
        pending: 0
      });
    }

    const b = m.get(key);
    b.total++;

    const result = resultNorm(row.result);
    if (result === "HIT") {
      b.graded++;
      b.hits++;
    } else if (result === "MISS") {
      b.graded++;
      b.misses++;
    } else if (result === "PUSH") {
      b.pushes++;
    } else if (result === "REFUND" || result === "VOID" || result === "DNP") {
      b.refunds++;
    } else if (result === "UNMATCHED") {
      b.unmatched++;
    } else {
      b.pending++;
    }
  }

  return [...m.values()]
    .map(x => {
      const hitRate = x.graded ? x.hits / x.graded : null;
      const roiProxy = x.graded ? (x.hits - x.misses) / x.graded : null;
      return {
        ...x,
        hitRate,
        roiProxy
      };
    })
    .sort((a, b) => b.total - a.total || String(a.bucket).localeCompare(String(b.bucket)));
}

function fmtPct(v) {
  return v === null || v === undefined ? "n/a" : `${(Number(v) * 100).toFixed(1)}%`;
}

function rowLine(x) {
  return `${x.bucket}: total=${x.total} graded=${x.graded} hits=${x.hits} misses=${x.misses} pushes=${x.pushes} refunds=${x.refunds} unmatched=${x.unmatched} shadowUngraded=${x.shadowUngraded || 0} pending=${x.pending} hitRate=${fmtPct(x.hitRate)} roiProxy=${fmtPct(x.roiProxy)}`;
}

const candidateFile = CANDIDATE_FILES.find(f => fs.existsSync(f));
if (!candidateFile) {
  console.error(`No production candidate file found for ${DATE}`);
  process.exit(1);
}

const candidateReport = readJson(candidateFile, null);
const candidates = getClassRows(candidateReport);

const gradeRows = [];
const gradeSourceCounts = {};
for (const file of GRADE_SOURCES) {
  const data = readJson(file, null);
  if (!data) continue;
  const rows = flatten(data, []);
  if (!rows.length) continue;
  gradeSourceCounts[file] = rows.length;
  for (const row of rows) {
    gradeRows.push({ ...row, gradeSourceFile: file });
  }
}

const exact = new Map();
const loose = new Map();

for (const row of gradeRows) {
  const k = candidateKey(row);
  const lk = looseKey(row);
  if (!exact.has(k)) exact.set(k, row);
  if (!loose.has(lk)) loose.set(lk, row);
}

const graded = candidates.map(c => {
  const k = candidateKey(c);
  const lk = looseKey(c);
  const match = exact.get(k) || loose.get(lk) || null;
  const rawResult = match ? gradeFromActual(c, match) : "UNMATCHED";
  const finalResult = resultNorm(rawResult);
  const isFinal = ["HIT", "MISS", "PUSH", "REFUND", "VOID", "DNP"].includes(finalResult);
  const shadowUngraded = !isFinal && isShadowUngradedCandidate(c);
  const result = shadowUngraded ? "SHADOW_UNGRADED" : (isFinal ? finalResult : "UNMATCHED");

  return {
    date: DATE,
    class: c.class || c.classification || "UNKNOWN",
    player: c.player || null,
    team: c.team || null,
    game: c.game || null,
    market: marketNorm(c.market || c.stat),
    side: sideNorm(c.side),
    line: c.line ?? null,
    oddsTier: c.oddsTier || c.tier || "standard",
    prob: getProb(c),
    edge: getEdge(c),
    books: c.books ?? null,
    support: c.support || null,
    grade: c.grade || null,
    sideBias: c.sideBias?.tier || c.sideBias || null,
    reasons: c.reasons || [],
    result,
    actual: isFinal ? (match?.actual ?? match?.actualValue ?? match?.final ?? match?.value ?? null) : null,
    matched: isFinal,
    unmatched: result === "UNMATCHED",
    shadowUngraded: result === "SHADOW_UNGRADED",
    pending: false,
    matchKey: isFinal ? candidateKey(match) : null,
    gradeSourceFile: isFinal ? (match?.gradeSourceFile || null) : null,
    sourceCandidate: c
  };
});

const roi = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  candidateFile,
  candidateRows: candidates.length,
  gradeRows: gradeRows.length,
  gradeSourceCounts,
  overall: bucketStats(graded, () => "OVERALL")[0] || null,
  byClass: bucketStats(graded, r => r.class),
  byMarketSide: bucketStats(graded, r => `${r.market}|${r.side}`),
  byMarket: bucketStats(graded, r => r.market),
  byTier: bucketStats(graded, r => r.oddsTier),
  bySideBias: bucketStats(graded, r => r.sideBias || "UNKNOWN"),
  bySupport: bucketStats(graded, r => r.support || "UNKNOWN"),
  byProbBucket: bucketStats(graded, r => {
    const p = num(r.prob, null);
    if (p === null) return "unknown";
    if (p < 0.55) return "<55";
    if (p < 0.60) return "55-60";
    if (p < 0.65) return "60-65";
    if (p < 0.70) return "65-70";
    if (p < 0.72) return "70-72";
    return "72+";
  }),
  byReason: bucketStats(
    graded.flatMap(r => (r.reasons || []).map(reason => ({ ...r, reason }))),
    r => r.reason
  )
};

writeJson(OUT_GRADES, {
  generatedAt: new Date().toISOString(),
  date: DATE,
  candidateFile,
  gradeSourceCounts,
  rows: graded
});

writeJson(OUT_ROI, roi);
writeJson(OUT_ROI_LATEST, roi);

const lines = [];
lines.push("PRODUCTION CANDIDATE CLASS ROI");
lines.push("==============================");
lines.push(`date: ${DATE}`);
lines.push(`candidateFile: ${candidateFile}`);
lines.push(`candidateRows: ${candidates.length}`);
lines.push(`gradeRows: ${gradeRows.length}`);
lines.push("");
lines.push("OVERALL");
lines.push("-------");
lines.push(roi.overall ? rowLine(roi.overall) : "none");
lines.push("");
lines.push("BY CLASS");
lines.push("--------");
for (const r of roi.byClass) lines.push(rowLine(r));
lines.push("");
lines.push("BY MARKET/SIDE");
lines.push("--------------");
for (const r of roi.byMarketSide.slice(0, 30)) lines.push(rowLine(r));
lines.push("");
lines.push("BY TIER");
lines.push("-------");
for (const r of roi.byTier) lines.push(rowLine(r));
lines.push("");
lines.push("BY SIDE BIAS");
lines.push("------------");
for (const r of roi.bySideBias) lines.push(rowLine(r));
lines.push("");
lines.push("TOP REASONS");
lines.push("-----------");
for (const r of roi.byReason.slice(0, 25)) lines.push(rowLine(r));

writeText(OUT_TXT, lines.join("\n"));
writeText(OUT_TXT_LATEST, lines.join("\n"));

console.log("PRODUCTION CANDIDATE CLASS GRADER");
console.log("=================================");
console.log({
  date: DATE,
  candidateFile,
  candidateRows: candidates.length,
  gradeRows: gradeRows.length,
  matched: graded.filter(r => r.matched).length,
  unmatched: graded.filter(r => !r.matched).length,
  hit: graded.filter(r => r.result === "HIT").length,
  miss: graded.filter(r => r.result === "MISS").length,
  push: graded.filter(r => r.result === "PUSH").length,
  refund: graded.filter(r => ["REFUND", "VOID", "DNP"].includes(r.result)).length
});
console.log("");
console.log("BY CLASS");
console.table(roi.byClass);
console.log("");
console.log(`saved: ${OUT_GRADES}`);
console.log(`saved: ${OUT_ROI}`);
console.log(`saved: ${OUT_ROI_LATEST}`);
console.log(`saved: ${OUT_TXT}`);
