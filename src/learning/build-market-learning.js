import fs from "fs";

const RESULTS_PATHS = [
  "data/results/graded-props.json",
  "data/results/history.json",
  "outputs/graded-props.json",
  "outputs/history.json"
];

const OUT_DIR = "data/learning";
const OUT_FILE = `${OUT_DIR}/market-learning.json`;

function readJson(path) {
  if (!fs.existsSync(path)) return null;
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function findRows() {
  for (const p of RESULTS_PATHS) {
    const data = readJson(p);
    if (!data) continue;

    if (Array.isArray(data)) return { path: p, rows: data };
    if (Array.isArray(data.results)) return { path: p, rows: data.results };
    if (Array.isArray(data.props)) return { path: p, rows: data.props };
    if (Array.isArray(data.rows)) return { path: p, rows: data.rows };
  }

  return { path: null, rows: [] };
}

function normalizeMarket(row) {
  return String(
    row.market ||
    row.statType ||
    row.stat ||
    row.projectionType ||
    "unknown"
  ).toLowerCase().replace(/\s+/g, "_");
}

function normalizeDirection(row) {
  return String(
    row.direction ||
    row.side ||
    row.pick ||
    row.overUnder ||
    row.type ||
    ""
  ).toUpperCase().includes("LESS")
    ? "LESS"
    : "MORE";
}

function getProb(row) {
  const candidates = [
    row.adjustedProb,
    row.calibratedProb,
    row.probability,
    row.prob,
    row.trueProb,
    row.confidence
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
    if (Number.isFinite(n) && n > 1 && n <= 100) return n / 100;
  }

  return null;
}

function getResult(row) {
  const raw = String(row.result || row.grade || row.outcome || "").toUpperCase();

  if (["WIN", "HIT", "W", "CASH"].includes(raw)) return 1;
  if (["LOSS", "MISS", "L"].includes(raw)) return 0;
  return null;
}

function bucketProb(p) {
  const low = Math.floor(p * 20) / 20;
  const high = low + 0.05;
  return `${low.toFixed(2)}-${high.toFixed(2)}`;
}

function safeAvg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function summarizeGroup(rows) {
  const probs = rows.map(r => r.prob);
  const hits = rows.map(r => r.hit);

  const predicted = safeAvg(probs);
  const actual = safeAvg(hits);
  const sample = rows.length;
  const bias = actual - predicted;

  let multiplier = 1 + bias;

  if (sample < 50) multiplier = 1;
  else if (sample < 100) multiplier = 1 + bias * 0.35;
  else if (sample < 250) multiplier = 1 + bias * 0.50;
  else multiplier = 1 + bias * 0.70;

  multiplier = Math.max(0.70, Math.min(1.20, multiplier));

  const suppressed =
    sample >= 100 &&
    actual < 0.50 &&
    bias <= -0.06;

  return {
    sample,
    predicted: Number(predicted.toFixed(4)),
    actual: Number(actual.toFixed(4)),
    bias: Number(bias.toFixed(4)),
    adjustmentMultiplier: Number(multiplier.toFixed(4)),
    suppressed
  };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { path, rows } = findRows();

  const usable = rows
    .map(row => {
      const prob = getProb(row);
      const hit = getResult(row);
      if (prob == null || hit == null) return null;

      return {
        market: normalizeMarket(row),
        direction: normalizeDirection(row),
        bucket: bucketProb(prob),
        prob,
        hit
      };
    })
    .filter(Boolean);

  const groups = {};
  const marketDirectionGroups = {};
  const bucketGroups = {};

  for (const row of usable) {
    const key = `${row.market}_${row.direction}_${row.bucket}`;
    const mdKey = `${row.market}_${row.direction}`;
    const bKey = row.bucket;

    groups[key] ??= [];
    marketDirectionGroups[mdKey] ??= [];
    bucketGroups[bKey] ??= [];

    groups[key].push(row);
    marketDirectionGroups[mdKey].push(row);
    bucketGroups[bKey].push(row);
  }

  const byMarketDirectionBucket = {};
  for (const [key, groupRows] of Object.entries(groups)) {
    byMarketDirectionBucket[key] = summarizeGroup(groupRows);
  }

  const byMarketDirection = {};
  for (const [key, groupRows] of Object.entries(marketDirectionGroups)) {
    byMarketDirection[key] = summarizeGroup(groupRows);
  }

  const byBucket = {};
  for (const [key, groupRows] of Object.entries(bucketGroups)) {
    byBucket[key] = summarizeGroup(groupRows);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: path,
    totalRows: rows.length,
    usableRows: usable.length,
    byMarketDirectionBucket,
    byMarketDirection,
    byBucket
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n");

  console.log(`Learning file written: ${OUT_FILE}`);
  console.log(`Source: ${path || "none found"}`);
  console.log(`Usable graded rows: ${usable.length}`);
}

main();
