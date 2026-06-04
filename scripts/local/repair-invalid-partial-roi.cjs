const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const GRADED_FILE = `outputs/playable-final-slips-graded-${DATE}.json`;
const ROI_DATE_FILE = `outputs/roi-summary-${DATE}.json`;
const ROI_LATEST_FILE = "outputs/roi-summary.json";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function isInvalidPartialSlip(slip) {
  return (
    slip?.graded?.invalidPartial === true ||
    slip?.graded?.result === "INVALID_PARTIAL" ||
    slip?.result === "INVALID_PARTIAL" ||
    slip?.invalidPartial === true
  );
}

function resultOf(leg) {
  return String(leg?.result || leg?.grade || leg?.status || "").toUpperCase();
}

function bucketInc(map, bucket, result) {
  if (!bucket) bucket = "UNKNOWN";
  if (!map[bucket]) {
    map[bucket] = {
      bucket,
      picks: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      hitRate: null,
      roi: null
    };
  }

  const row = map[bucket];
  row.picks += 1;

  if (result === "HIT") row.hits += 1;
  else if (result === "MISS") row.misses += 1;
  else if (result === "PUSH") row.pushes += 1;
}

function finalize(map) {
  return Object.values(map).map((r) => {
    const graded = r.hits + r.misses;
    r.hitRate = graded ? r.hits / graded : null;
    r.roi = graded ? (r.hits - r.misses) / graded : null;
    return r;
  });
}

function probBucket(leg) {
  const p = Number(
    leg?.prob ??
    leg?.probability ??
    leg?.distributionProb ??
    leg?.finalProb ??
    leg?.modelProb
  );

  if (!Number.isFinite(p)) return "UNKNOWN";
  const pct = p <= 1 ? p * 100 : p;
  const lo = Math.floor(pct / 5) * 5;
  const hi = lo + 4;
  return `${lo}-${hi}`;
}

function bookBucket(leg) {
  const books = Number(
    leg?.books ??
    leg?.bookCount ??
    leg?.sportsbookBookCount ??
    leg?.bookSupportCount
  );

  if (!Number.isFinite(books)) return "UNKNOWN";
  if (books >= 4) return "4+ books";
  if (books >= 2) return "2-3 books";
  if (books === 1) return "1 book";
  return "0 books";
}

const graded = readJson(GRADED_FILE, null);
const slips = Array.isArray(graded?.slips) ? graded.slips : [];

let invalidPartialSlips = 0;
let validSlips = 0;

const byMarket = {};
const byProbBucket = {};
const byBookSupport = {};
const bySlipSize = {};

for (const slip of slips) {
  if (isInvalidPartialSlip(slip)) {
    invalidPartialSlips += 1;
    continue;
  }

  const legs = Array.isArray(slip?.legs) ? slip.legs : [];
  if (!legs.length) continue;

  validSlips += 1;

  for (const leg of legs) {
    const result = resultOf(leg);
    if (!["HIT", "MISS", "PUSH"].includes(result)) continue;

    bucketInc(byMarket, leg?.market || "UNKNOWN", result);
    bucketInc(byProbBucket, probBucket(leg), result);
    bucketInc(byBookSupport, bookBucket(leg), result);

    const size = Number(slip?.size || legs.length);
    bucketInc(bySlipSize, Number.isFinite(size) ? `${size}-man` : "UNKNOWN", result);
  }
}

const marketRows = finalize(byMarket);
const gradedLegs = marketRows.reduce((n, r) => n + r.picks, 0);

const repaired = {
  date: DATE,
  repairedAt: new Date().toISOString(),
  source: GRADED_FILE,
  repairedReason: "excluded_invalid_partial_slips",
  invalidPartialSlips,
  validSlips,
  gradedLegs,
  byMarket: marketRows,
  byProbBucket: finalize(byProbBucket),
  byBookSupport: finalize(byBookSupport),
  bySlipSize: finalize(bySlipSize)
};

writeJson(ROI_DATE_FILE, repaired);
writeJson(ROI_LATEST_FILE, repaired);

console.log("INVALID PARTIAL ROI REPAIR");
console.log("==========================");
console.log(`date: ${DATE}`);
console.log(`invalidPartialSlips: ${invalidPartialSlips}`);
console.log(`validSlips: ${validSlips}`);
console.log(`gradedLegs: ${gradedLegs}`);
console.log(`saved: ${ROI_DATE_FILE}`);
console.log(`saved: ${ROI_LATEST_FILE}`);
