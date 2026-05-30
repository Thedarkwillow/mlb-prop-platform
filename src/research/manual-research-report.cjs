const fs = require("fs");
const path = require("path");

const IN_FILE = "data/manual/manual-research-ledger.json";
const OUT_JSON = "outputs/manual/manual-research-summary.json";
const OUT_TXT = "outputs/manual/manual-research-summary.txt";

function readJson(file, fallback = []) {
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

function norm(v) {
  return String(v ?? "").trim();
}

function keyOf(row, fields) {
  return fields.map(f => norm(row[f] || "unknown")).join(" | ");
}

function emptyBucket(key) {
  return {
    key,
    total: 0,
    graded: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    pending: 0,
    refunds: 0,
    hitRate: null
  };
}

function add(bucket, row) {
  const result = norm(row.result).toUpperCase();
  bucket.total += 1;

  if (result === "HIT" || result === "WIN") {
    bucket.graded += 1;
    bucket.hits += 1;
  } else if (result === "MISS" || result === "LOSS") {
    bucket.graded += 1;
    bucket.misses += 1;
  } else if (result === "PUSH") {
    bucket.graded += 1;
    bucket.pushes += 1;
  } else if (result === "REFUND" || result === "DNP") {
    bucket.refunds += 1;
  } else {
    bucket.pending += 1;
  }

  bucket.hitRate = bucket.graded > 0 ? +(bucket.hits / bucket.graded).toFixed(4) : null;
}

function summarize(rows, fields) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row, fields);
    if (!map.has(key)) map.set(key, emptyBucket(key));
    add(map.get(key), row);
  }
  return [...map.values()].sort((a, b) => b.graded - a.graded || b.hitRate - a.hitRate);
}

const rows = readJson(IN_FILE, []);

const overall = emptyBucket("overall");
for (const row of rows) add(overall, row);

const byMarketSide = summarize(rows, ["market", "side"]);
const byMarketSideTier = summarize(rows, ["market", "side", "tier"]);
const bySource = summarize(rows, ["source"]);
const byDate = summarize(rows, ["date"]);

const summary = {
  generatedAt: new Date().toISOString(),
  inputFile: IN_FILE,
  rows: rows.length,
  overall,
  byDate,
  bySource,
  byMarketSide,
  byMarketSideTier
};

writeJson(OUT_JSON, summary);

const lines = [];
lines.push("MANUAL RESEARCH REPORT");
lines.push("======================");
lines.push(`rows: ${rows.length}`);
lines.push(`graded: ${overall.graded}`);
lines.push(`hits: ${overall.hits}`);
lines.push(`misses: ${overall.misses}`);
lines.push(`pushes: ${overall.pushes}`);
lines.push(`pending: ${overall.pending}`);
lines.push(`refunds: ${overall.refunds}`);
lines.push(`hitRate: ${overall.hitRate == null ? "n/a" : (overall.hitRate * 100).toFixed(2) + "%"}`);
lines.push("");

function section(title, arr) {
  lines.push(title);
  lines.push("-".repeat(title.length));
  for (const r of arr.slice(0, 30)) {
    const hr = r.hitRate == null ? "n/a" : `${(r.hitRate * 100).toFixed(2)}%`;
    lines.push(`- ${r.key}: total=${r.total} graded=${r.graded} hits=${r.hits} misses=${r.misses} pushes=${r.pushes} refunds=${r.refunds} pending=${r.pending} hitRate=${hr}`);
  }
  lines.push("");
}

section("BY DATE", byDate);
section("BY SOURCE", bySource);
section("BY MARKET/SIDE", byMarketSide);
section("BY MARKET/SIDE/TIER", byMarketSideTier);

fs.mkdirSync(path.dirname(OUT_TXT), { recursive: true });
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
