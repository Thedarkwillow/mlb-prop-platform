const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const OUT_JSON = `outputs/promotion-watch-bucket-grades-${DATE}.json`;
const OUT_TXT = `outputs/promotion-watch-bucket-grades-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/promotion-watch-bucket-grades-latest.json";
const OUT_LATEST_TXT = "outputs/promotion-watch-bucket-grades-latest.txt";

const DAILY_FILES = [
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  `outputs/history/${DATE}-production-candidate-grades.json`,
  `outputs/history/${DATE}-shadow-graded.json`,
  `outputs/history/${DATE}-unsupported-shadow-graded.json`,
  `outputs/playable-final-slips-graded-${DATE}.json`,
];

const LIVE_FILES = [
  "outputs/live/live-tier-performance-latest.json",
  ...safeReaddir("outputs/live")
    .filter(f => /^live-tier-performance-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .map(f => path.join("outputs/live", f)),
];

const BUCKETS = [
  {
    key: "GOBLIN_STRIKEOUTS_MORE",
    label: "Goblin strikeouts MORE",
    market: "strikeouts",
    side: "MORE",
    tier: "goblin",
    preferLive: true,
  },
  {
    key: "GOBLIN_WALKS_ALLOWED_MORE",
    label: "Goblin walks_allowed MORE",
    market: "walks_allowed",
    side: "MORE",
    tier: "goblin",
    preferLive: true,
  },
  {
    key: "STANDARD_STRIKEOUTS_LESS",
    label: "Standard strikeouts LESS",
    market: "strikeouts",
    side: "LESS",
    tier: "standard",
    preferLive: false,
  },
  {
    key: "STANDARD_PITCHING_OUTS_LESS",
    label: "Standard pitching_outs LESS",
    market: "pitching_outs",
    side: "LESS",
    tier: "standard",
    preferLive: false,
  },
];

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

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

function writeText(file, text) {
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function flatten(v, out = [], seen = new Set(), file = "") {
  if (!v || typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out, seen, file);
    return out;
  }

  const hasUseful =
    v.player || v.playerName || v.name ||
    v.market || v.statType || v.propType ||
    v.side || v.outcome ||
    v.result || v.grade ||
    v.graded !== undefined ||
    v.hits !== undefined ||
    v.misses !== undefined ||
    v.hitRate !== undefined ||
    v.roi !== undefined ||
    v.bucket || v.key || v.label;

  if (hasUseful) out.push({ ...v, __file: file });

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out, seen, file);
  }

  return out;
}

function getPlayer(r) {
  return r.player || r.playerName || r.name || r.description || "UNKNOWN";
}

function getMarket(r) {
  return norm(
    r.market ||
    r.statType ||
    r.propType ||
    r.marketName ||
    r.stat ||
    parseText(r, "market")
  );
}

function getSide(r) {
  return String(
    r.side ||
    r.outcome ||
    r.pickSide ||
    parseText(r, "side") ||
    ""
  ).toUpperCase();
}

function getTier(r) {
  return norm(
    r.tier ||
    r.oddsTier ||
    r.specialTier ||
    r.priceTier ||
    parseText(r, "tier") ||
    "standard"
  );
}

function getLine(r) {
  const v = r.line ?? r.target ?? r.threshold ?? r.projectionLine ?? r.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getActual(r) {
  const v = r.actual ?? r.actualValue ?? r.final ?? r.statValue ?? r.resultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getResult(r) {
  const raw = String(r.result || r.grade || r.outcomeResult || "").toUpperCase();
  if (raw.includes("HIT") || raw === "WIN") return "HIT";
  if (raw.includes("MISS") || raw === "LOSS") return "MISS";
  if (raw.includes("PUSH") || raw === "TIE") return "PUSH";
  if (raw.includes("REFUND")) return "REFUND";
  return "";
}

function parseText(r, want) {
  const text = [
    r.key,
    r.bucket,
    r.label,
    r.name,
    r.title,
    r.marketSideTier,
    r.marketSide,
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  if (!text) return "";

  if (want === "tier") {
    if (text.includes("goblin")) return "goblin";
    if (text.includes("demon")) return "demon";
    if (text.includes("standard")) return "standard";
  }

  if (want === "side") {
    if (/\bmore\b/.test(text)) return "MORE";
    if (/\bless\b/.test(text)) return "LESS";
  }

  if (want === "market") {
    if (text.includes("walks_allowed")) return "walks_allowed";
    if (text.includes("pitching_outs")) return "pitching_outs";
    if (text.includes("strikeouts")) return "strikeouts";
    if (text.includes("hits_allowed")) return "hits_allowed";
    if (text.includes("earned_runs_allowed")) return "earned_runs_allowed";
    if (text.includes("bases")) return "bases";
    if (text.includes("hits")) return "hits";
    if (text.includes("hrr")) return "hrr";
    if (text.includes("walks")) return "walks";
  }

  return "";
}

function rowMatchesBucket(r, b) {
  return (
    getMarket(r) === norm(b.market) &&
    getSide(r) === b.side &&
    getTier(r) === norm(b.tier)
  );
}

function summarizeDailyRows(bucket) {
  const rows = [];
  for (const file of DAILY_FILES) {
    const data = readJson(file);
    if (!data) continue;
    for (const r of flatten(data, [], new Set(), file)) {
      if (!rowMatchesBucket(r, bucket)) continue;
      const result = getResult(r);
      if (!result) continue;

      rows.push({
        player: getPlayer(r),
        market: getMarket(r),
        side: getSide(r),
        tier: getTier(r),
        line: getLine(r),
        actual: getActual(r),
        result,
        file,
      });
    }
  }

  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const refunds = rows.filter(r => r.result === "REFUND").length;

  return {
    sourceType: "daily_graded_files",
    sourceFile: null,
    total: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    refunds,
    unmatched: 0,
    hitRate: hits + misses > 0 ? hits / (hits + misses) : null,
    examples: rows.slice(0, 12),
  };
}

function summarizeLiveRows(bucket) {
  for (const file of LIVE_FILES) {
    const data = readJson(file);
    if (!data) continue;

    const candidates = flatten(data, [], new Set(), file).filter(r => rowMatchesBucket(r, bucket));

    let best = null;
    for (const r of candidates) {
      const graded =
        num(r.graded, NaN) ||
        num(r.gradeRows, NaN) ||
        num(r.totalGraded, NaN) ||
        num(r.sample, NaN) ||
        num(r.total, NaN);

      const hits = num(r.hits, NaN);
      const misses = num(r.misses, NaN);

      const hitRateRaw =
        r.hitRate ??
        r.hit_rate ??
        r.winRate ??
        r.roiHitRate ??
        null;

      let hitRate = Number(hitRateRaw);
      if (Number.isFinite(hitRate) && hitRate > 1) hitRate /= 100;

      const usableHitsMisses = Number.isFinite(hits) && Number.isFinite(misses);
      const usableGraded = Number.isFinite(graded) && graded > 0;
      const usableHitRate = Number.isFinite(hitRate);

      if (!usableGraded && !usableHitsMisses) continue;

      const finalHits = usableHitsMisses ? hits : usableHitRate ? Math.round(graded * hitRate) : 0;
      const finalMisses = usableHitsMisses ? misses : Math.max(0, graded - finalHits);
      const finalGraded = usableGraded ? graded : finalHits + finalMisses;
      const finalHitRate =
        finalHits + finalMisses > 0 ? finalHits / (finalHits + finalMisses) : null;

      const source = {
        sourceType: "rolling_live_shadow",
        sourceFile: file,
        total: num(r.total, finalGraded),
        graded: finalGraded,
        hits: finalHits,
        misses: finalMisses,
        pushes: num(r.pushes, 0),
        refunds: num(r.refunds, 0),
        unmatched: num(r.unmatched, 0),
        pending: num(r.pending, 0),
        roi: Number.isFinite(Number(r.roi)) ? Number(r.roi) : null,
        hitRate: finalHitRate,
        rawBucket: {
          key: r.key,
          bucket: r.bucket,
          label: r.label,
          name: r.name,
          market: r.market,
          side: r.side,
          tier: r.tier || r.oddsTier || r.specialTier,
        },
        examples: [],
      };

      if (!best || source.graded > best.graded) best = source;
    }

    if (best) return best;
  }

  return null;
}

function summarizeBucket(bucket) {
  const daily = summarizeDailyRows(bucket);

  if (bucket.preferLive) {
    const live = summarizeLiveRows(bucket);
    if (live && live.graded > 0) return live;
  }

  return daily;
}

const byBucket = {};
const lines = [];

lines.push("PROMOTION WATCH BUCKET GRADES");
lines.push("================================");
lines.push(`date=${DATE}`);

for (const bucket of BUCKETS) {
  const s = summarizeBucket(bucket);

  byBucket[bucket.key] = {
    key: bucket.key,
    label: bucket.label,
    market: bucket.market,
    side: bucket.side,
    tier: bucket.tier,
    ...s,
  };

  lines.push("");
  lines.push(bucket.key);
  lines.push("-".repeat(bucket.key.length));
  lines.push(`label=${bucket.label}`);
  lines.push(`sourceType=${s.sourceType}`);
  if (s.sourceFile) lines.push(`sourceFile=${s.sourceFile}`);
  lines.push(
    `total=${s.total} graded=${s.graded} hits=${s.hits} misses=${s.misses} pushes=${s.pushes} refunds=${s.refunds} unmatched=${s.unmatched} hitRate=${s.hitRate == null ? "n/a" : (s.hitRate * 100).toFixed(1) + "%"}`
  );

  for (const ex of s.examples || []) {
    lines.push(
      `  ${ex.result} | ${ex.player} | ${ex.market} ${ex.side} ${ex.line ?? "?"} | tier=${ex.tier} | actual=${ex.actual ?? "?"} | file=${ex.file}`
    );
  }
}

const out = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  byBucket,
};

writeJson(OUT_JSON, out);
writeJson(OUT_LATEST_JSON, out);
writeText(OUT_TXT, lines.join("\n"));
writeText(OUT_LATEST_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
