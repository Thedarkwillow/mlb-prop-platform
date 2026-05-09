import fs from "fs";

const BASE_RESULTS_PATHS = [
  "outputs/all-markets-graded.json",
  "outputs/fantasy-graded.json",
  "data/results/all-markets-graded.json",
  "data/results/fantasy-graded.json",
  "data/results/graded-props.json",
  "data/results/history.json",
  "outputs/graded-props.json",
  "outputs/history.json"
];

function historicalGradedPaths() {
  const dirs = ["outputs/history", "data/results/history"];
  const paths = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir)) {
      if (
        file.endsWith("-all-markets-graded.json") ||
        file.endsWith("-fantasy-grades.json") ||
        file.endsWith("-hrr-graded.json")
      ) {
        paths.push(`${dir}/${file}`);
      }
    }
  }

  return paths.sort();
}

const RESULTS_PATHS = [
  ...BASE_RESULTS_PATHS,
  ...historicalGradedPaths()
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
  const allRows = [];
  const usedPaths = [];

  for (const p of RESULTS_PATHS) {
    const data = readJson(p);
    if (!data) continue;

    let rows = [];
    if (Array.isArray(data)) rows = data;
    else if (Array.isArray(data.results)) rows = data.results;
    else if (Array.isArray(data.props)) rows = data.props;
    else if (Array.isArray(data.rows)) rows = data.rows;

    if (rows.length) {
      usedPaths.push(p);
      for (const row of rows) allRows.push(row);
    }
  }

  return { path: usedPaths.join(" + "), rows: allRows };
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

function rowDate(row) {
  return String(
    row.date ||
    row.gameDate ||
    row.slateDate ||
    row.boardDate ||
    row.startDate ||
    row.startTime ||
    row.gameStart ||
    ""
  ).slice(0, 10);
}

function dedupeKey(row, parsed) {
  return [
    rowDate(row),
    String(row.player || row.player_name || "").toLowerCase().trim(),
    parsed.market,
    parsed.direction,
    String(row.line ?? row.projectionLine ?? "").trim(),
    String(parsed.hit)
  ].join("|");
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

  const seen = new Set();

  const usable = rows
    .map(row => {
      const prob = getProb(row);
      const hit = getResult(row);
      if (prob == null || hit == null) return null;

      const parsed = {
        market: normalizeMarket(row),
        direction: normalizeDirection(row),
        bucket: bucketProb(prob),
        prob,
        hit
      };

      const key = dedupeKey(row, parsed);
      if (seen.has(key)) return null;
      seen.add(key);

      return parsed;
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
