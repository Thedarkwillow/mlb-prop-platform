const fs = require("fs");
const path = require("path");

const OUT_JSON = "outputs/production-candidate-class-roi-history.json";
const OUT_TXT = "outputs/production-candidate-class-roi-history.txt";

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

function pct(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "n/a";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function addBucket(map, bucket, row) {
  if (!bucket) bucket = "unknown";
  if (!map.has(bucket)) {
    map.set(bucket, {
      bucket,
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

  const x = map.get(bucket);
  x.total += safeNum(row.total);
  x.graded += safeNum(row.graded);
  x.hits += safeNum(row.hits);
  x.misses += safeNum(row.misses);
  x.pushes += safeNum(row.pushes);
  x.refunds += safeNum(row.refunds);
  x.unmatched += safeNum(row.unmatched);
  x.pending += safeNum(row.pending);
}

function finalize(rows) {
  return rows
    .map(x => ({
      ...x,
      hitRate: x.graded ? x.hits / x.graded : null,
      roiProxy: x.graded ? (x.hits - x.misses) / x.graded : null
    }))
    .sort((a, b) =>
      safeNum(b.graded) - safeNum(a.graded) ||
      safeNum(b.total) - safeNum(a.total) ||
      String(a.bucket).localeCompare(String(b.bucket))
    );
}

function rollup(files, section) {
  const map = new Map();
  for (const file of files) {
    const data = readJson(file, null);
    const rows = Array.isArray(data?.[section]) ? data[section] : [];
    for (const row of rows) addBucket(map, row.bucket, row);
  }
  return finalize([...map.values()]);
}

function rowLine(x) {
  return `${x.bucket}: total=${x.total} graded=${x.graded} hits=${x.hits} misses=${x.misses} pushes=${x.pushes} refunds=${x.refunds} unmatched=${x.unmatched} pending=${x.pending} hitRate=${pct(x.hitRate)} roiProxy=${pct(x.roiProxy)}`;
}

const files = fs.readdirSync("outputs")
  .filter(f => /^production-candidate-class-roi-\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .map(f => path.join("outputs", f))
  .sort();

const dates = files.map(f => {
  const m = path.basename(f).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}).filter(Boolean);

const byDate = files.map(file => {
  const data = readJson(file, {});
  return {
    date: data.date || path.basename(file).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null,
    overall: data.overall || null,
    byClass: data.byClass || []
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  files,
  dates,
  slateCount: dates.length,
  byDate,
  byClass: rollup(files, "byClass"),
  byMarketSide: rollup(files, "byMarketSide"),
  byMarket: rollup(files, "byMarket"),
  byTier: rollup(files, "byTier"),
  bySideBias: rollup(files, "bySideBias"),
  byProbBucket: rollup(files, "byProbBucket"),
  byEdgeBucket: rollup(files, "byEdgeBucket"),
  byReason: rollup(files, "byReason")
};

const lines = [];
lines.push("ROLLING PRODUCTION CANDIDATE ROI HISTORY");
lines.push("========================================");
lines.push(`generatedAt: ${report.generatedAt}`);
lines.push(`slates: ${report.slateCount}`);
lines.push(`dates: ${dates.join(", ") || "none"}`);
lines.push("");

for (const section of ["byClass", "byMarketSide", "byMarket", "byTier", "bySideBias", "byProbBucket", "byEdgeBucket"]) {
  lines.push(section.toUpperCase());
  lines.push("-".repeat(section.length));
  const rows = report[section] || [];
  if (!rows.length) lines.push("none");
  else rows.slice(0, 30).forEach(r => lines.push(rowLine(r)));
  lines.push("");
}

lines.push("TOP REASONS");
lines.push("-----------");
(report.byReason || []).slice(0, 30).forEach(r => lines.push(rowLine(r)));

writeJson(OUT_JSON, report);
writeText(OUT_TXT, lines.join("\n"));

console.log("ROLLING PRODUCTION CANDIDATE ROI HISTORY");
console.log("========================================");
console.log({
  slateCount: report.slateCount,
  dates,
  files: files.length
});
console.log("BY CLASS");
console.table(report.byClass);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
