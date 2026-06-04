const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const JSON_FILE = `outputs/high-probability-bucket-grades-${DATE}.json`;
const TXT_FILE = `outputs/high-probability-bucket-grades-${DATE}.txt`;
const LATEST_JSON = "outputs/high-probability-bucket-grades-latest.json";
const LATEST_TXT = "outputs/high-probability-bucket-grades-latest.txt";

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function pct(v) {
  return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

function resultOf(row) {
  return String(row?.result || row?.grade || row?.status || "").toUpperCase();
}

function findBucketContainer(data) {
  if (data.buckets && typeof data.buckets === "object") return data.buckets;
  if (data.results && typeof data.results === "object") return data.results;
  if (data.summary && typeof data.summary === "object") return data.summary;
  if (data.byBucket && typeof data.byBucket === "object") return data.byBucket;

  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && v.SHADOW_HIGH_PROBABILITY) return v;
  }

  return data;
}

function buildSplit(key, label, rows) {
  const total = rows.length;
  const gradedRows = rows.filter(r => ["HIT", "MISS", "PUSH", "REFUND"].includes(resultOf(r)));
  const hits = gradedRows.filter(r => resultOf(r) === "HIT").length;
  const misses = gradedRows.filter(r => resultOf(r) === "MISS").length;
  const pushes = gradedRows.filter(r => resultOf(r) === "PUSH").length;
  const refunds = gradedRows.filter(r => resultOf(r) === "REFUND").length;
  const graded = hits + misses + pushes;
  const unmatched = total - gradedRows.length;
  const hitRate = graded ? hits / graded : null;

  return {
    key,
    label,
    total,
    graded,
    hits,
    misses,
    pushes,
    refunds,
    unmatched,
    hitRate,
    rows
  };
}

const data = readJson(JSON_FILE);
const buckets = findBucketContainer(data);

const shadow =
  buckets.SHADOW_HIGH_PROBABILITY ||
  buckets.shadowHighProbability ||
  buckets.shadow_high_probability;

if (!shadow || !Array.isArray(shadow.rows)) {
  console.log("No SHADOW_HIGH_PROBABILITY rows found; nothing to split.");
  process.exit(0);
}

const shadowRows = shadow.rows;

buckets.SHADOW_HITS_MORE_HIGH_PROB = buildSplit(
  "SHADOW_HITS_MORE_HIGH_PROB",
  "Shadow hits MORE high probability",
  shadowRows.filter(r => String(r.market || "").toLowerCase() === "hits")
);

buckets.SHADOW_BASES_MORE_HIGH_PROB = buildSplit(
  "SHADOW_BASES_MORE_HIGH_PROB",
  "Shadow bases MORE high probability",
  shadowRows.filter(r => String(r.market || "").toLowerCase() === "bases")
);

writeJson(JSON_FILE, data);
writeJson(LATEST_JSON, data);

let extra = "";
for (const key of ["SHADOW_HITS_MORE_HIGH_PROB", "SHADOW_BASES_MORE_HIGH_PROB"]) {
  const b = buckets[key];
  extra += `\n${key}\n`;
  extra += `${"-".repeat(key.length)}\n`;
  extra += `total=${b.total} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} refunds=${b.refunds} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)}\n`;
  for (const r of b.rows || []) {
    extra += `  ${resultOf(r) || "UNKNOWN"} | ${r.player || r.playerName || "UNKNOWN"} | ${r.market} ${r.side} ${r.line} | tier=${r.tier || r.oddsTier || "?"} | prob=${r.prob != null ? `${(Number(r.prob) * 100).toFixed(2)}%` : "?"} | actual=${r.actual ?? "?"}\n`;
  }
}

if (fs.existsSync(TXT_FILE)) {
  fs.appendFileSync(TXT_FILE, extra);
}
if (fs.existsSync(LATEST_TXT)) {
  fs.appendFileSync(LATEST_TXT, extra);
}

console.log("HIGH-PROB SHADOW SPLIT REPAIR");
console.log("=============================");
console.log(`date=${DATE}`);
for (const key of ["SHADOW_HITS_MORE_HIGH_PROB", "SHADOW_BASES_MORE_HIGH_PROB"]) {
  const b = buckets[key];
  console.log(`${key}: graded=${b.graded} hits=${b.hits} misses=${b.misses} hitRate=${pct(b.hitRate)}`);
}
