const fs = require("fs");
const path = require("path");

const HISTORY_DIR = "outputs/history";
const OUT_JSON = "outputs/candidate-class-roi-report.json";
const OUT_TXT = "outputs/candidate-class-roi-report.txt";
const LEARNING_JSON = "data/learning/candidate-class-roi-history.json";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
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
  fs.writeFileSync(file, text);
}

function flattenRows(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flattenRows(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flattenRows(val, out);
  }
  return out;
}

function resultOf(r) {
  return String(r.result || r.outcome || r.gradeResult || "").toUpperCase();
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function upper(v) {
  return String(v ?? "").trim().toUpperCase();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function layerOf(r) {
  return String(r.layer || r.candidateClass || r.class || "UNKNOWN").toUpperCase();
}

function marketOf(r) {
  return norm(r.market || r.stat || r.statType || "unknown");
}

function sideOf(r) {
  return upper(r.side || r.direction || "");
}

function tierOf(r) {
  return norm(r.tier || r.oddsTier || r.specialTier || "standard") || "standard";
}

function supportOf(r) {
  return String(r.support || r.bookSupport || "UNKNOWN").toUpperCase();
}

function gradeOf(r) {
  return String(r.grade || r.dkGrade || "UNKNOWN").toUpperCase();
}

function sideBiasOf(r) {
  const raw = r.sideBias || r.side_bias || "UNKNOWN";
  if (raw && typeof raw === "object") {
    return String(
      raw.tier ||
      raw.label ||
      raw.bucket ||
      raw.bias ||
      raw.sideBias ||
      raw.status ||
      "OBJECT"
    ).toUpperCase();
  }
  return String(raw).toUpperCase();
}

function probBucket(p) {
  const x = n(p);
  if (x === null) return "unknown";
  if (x < 0.50) return "<0.50";
  if (x >= 0.80) return "0.80+";
  const lo = Math.floor(x * 20) / 20;
  const hi = lo + 0.05;
  return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
}

function edgeBucket(e) {
  const x = n(e);
  if (x === null) return "unknown";
  if (x < 0) return "<0";
  if (x >= 0.30) return "0.30+";
  if (x >= 0.20) return "0.20-0.30";
  if (x >= 0.10) return "0.10-0.20";
  if (x >= 0.05) return "0.05-0.10";
  return "0.00-0.05";
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(resultOf(r)));
  const hits = graded.filter(r => resultOf(r) === "HIT").length;
  const misses = graded.filter(r => resultOf(r) === "MISS").length;
  const pushes = graded.filter(r => resultOf(r) === "PUSH").length;
  const decisions = hits + misses;
  const profit = hits - misses;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched: rows.filter(r => resultOf(r) === "UNMATCHED").length,
    hitRate: decisions ? Number((hits / decisions).toFixed(4)) : null,
    roi: decisions ? Number((profit / decisions).toFixed(4)) : null,
    avgProb: avg(graded.map(r => n(r.prob ?? r.recommendedProb ?? r.calibratedDistributionProb))),
    avgEdge: avg(graded.map(r => n(r.edge ?? r.sportsbookAdjustedEdge ?? r.sportsbookEdge)))
  };
}

function avg(vals) {
  const xs = vals.filter(v => Number.isFinite(v));
  if (!xs.length) return null;
  return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4));
}

function groupBy(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const key = fn(r);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  return Object.fromEntries(
    [...m.entries()]
      .map(([bucket, xs]) => [bucket, summarize(xs)])
      .sort((a, b) => (b[1].graded - a[1].graded) || String(a[0]).localeCompare(String(b[0])))
  );
}

function loadDecisionRows() {
  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}-decision-layer-grades\.json$/.test(f))
    .sort();

  const rows = [];
  for (const f of files) {
    const date = f.slice(0, 10);
    const file = path.join(HISTORY_DIR, f);
    for (const r of flattenRows(readJson(file, []))) {
      rows.push({
        ...r,
        date,
        sourceFile: file
      });
    }
  }
  return rows;
}

function tableLines(title, obj, limit = 30) {
  const rows = Object.entries(obj).map(([bucket, x]) => ({ bucket, ...x }));
  const lines = [];
  lines.push(title);
  lines.push("-".repeat(title.length));
  if (!rows.length) {
    lines.push("none");
    lines.push("");
    return lines;
  }

  for (const r of rows.slice(0, limit)) {
    lines.push(
      `${r.bucket} | graded=${r.graded} hits=${r.hits} misses=${r.misses} pushes=${r.pushes} unmatched=${r.unmatched} hitRate=${fmtPct(r.hitRate)} roi=${fmtPct(r.roi)} avgProb=${fmtNum(r.avgProb)} avgEdge=${fmtNum(r.avgEdge)}`
    );
  }
  lines.push("");
  return lines;
}

function fmtPct(v) {
  return v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

function fmtNum(v) {
  return v === null || v === undefined ? "n/a" : Number(v).toFixed(4);
}

const rows = loadDecisionRows();
const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(resultOf(r)));

const report = {
  generatedAt: new Date().toISOString(),
  fileCount: [...new Set(rows.map(r => r.sourceFile))].length,
  totalRows: rows.length,
  totalGraded: graded.length,
  overall: summarize(rows),
  byDate: groupBy(rows, r => r.date),
  byLayer: groupBy(rows, layerOf),
  byLayerMarketSide: groupBy(rows, r => `${layerOf(r)}|${marketOf(r)}|${sideOf(r)}`),
  byMarketSide: groupBy(rows, r => `${marketOf(r)}|${sideOf(r)}`),
  byTier: groupBy(rows, tierOf),
  bySupport: groupBy(rows, supportOf),
  byGrade: groupBy(rows, gradeOf),
  bySideBias: groupBy(rows, sideBiasOf),
  byProbBucket: groupBy(rows, r => probBucket(r.prob ?? r.recommendedProb ?? r.calibratedDistributionProb)),
  byEdgeBucket: groupBy(rows, r => edgeBucket(r.edge ?? r.sportsbookAdjustedEdge ?? r.sportsbookEdge)),
  rows
};

writeJson(OUT_JSON, report);
writeJson(LEARNING_JSON, {
  generatedAt: report.generatedAt,
  fileCount: report.fileCount,
  totalRows: report.totalRows,
  totalGraded: report.totalGraded,
  overall: report.overall,
  byLayer: report.byLayer,
  byLayerMarketSide: report.byLayerMarketSide,
  byMarketSide: report.byMarketSide,
  byTier: report.byTier,
  bySupport: report.bySupport,
  byGrade: report.byGrade,
  bySideBias: report.bySideBias,
  byProbBucket: report.byProbBucket,
  byEdgeBucket: report.byEdgeBucket
});

const lines = [];
lines.push("CANDIDATE CLASS ROI REPORT");
lines.push("==========================");
lines.push(`generatedAt: ${report.generatedAt}`);
lines.push(`decision grade files: ${report.fileCount}`);
lines.push(`rows: ${report.totalRows}`);
lines.push(`graded: ${report.totalGraded}`);
lines.push("");
lines.push(`OVERALL | graded=${report.overall.graded} hits=${report.overall.hits} misses=${report.overall.misses} pushes=${report.overall.pushes} unmatched=${report.overall.unmatched} hitRate=${fmtPct(report.overall.hitRate)} roi=${fmtPct(report.overall.roi)}`);
lines.push("");
lines.push(...tableLines("BY DATE", report.byDate));
lines.push(...tableLines("BY LAYER", report.byLayer));
lines.push(...tableLines("BY LAYER / MARKET / SIDE", report.byLayerMarketSide, 80));
lines.push(...tableLines("BY MARKET / SIDE", report.byMarketSide, 60));
lines.push(...tableLines("BY TIER", report.byTier));
lines.push(...tableLines("BY SUPPORT", report.bySupport));
lines.push(...tableLines("BY GRADE", report.byGrade));
lines.push(...tableLines("BY SIDE BIAS", report.bySideBias));
lines.push(...tableLines("BY PROB BUCKET", report.byProbBucket));
lines.push(...tableLines("BY EDGE BUCKET", report.byEdgeBucket));

writeText(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved: ${LEARNING_JSON}`);
