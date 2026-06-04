const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const OUT_JSON = `outputs/promotion-watch-bucket-grades-${DATE}.json`;
const OUT_TXT = `outputs/promotion-watch-bucket-grades-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/promotion-watch-bucket-grades-latest.json";
const OUT_LATEST_TXT = "outputs/promotion-watch-bucket-grades-latest.txt";

const FILES = [
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  `outputs/history/${DATE}-production-candidate-grades.json`,
  `outputs/history/${DATE}-shadow-graded.json`,
  `outputs/history/${DATE}-unsupported-shadow-graded.json`,
  `outputs/playable-final-slips-graded-${DATE}.json`,
];

const BUCKETS = [
  {
    key: "GOBLIN_STRIKEOUTS_MORE",
    label: "Goblin strikeouts MORE",
    market: "strikeouts",
    side: "MORE",
    tier: "goblin",
  },
  {
    key: "GOBLIN_WALKS_ALLOWED_MORE",
    label: "Goblin walks_allowed MORE",
    market: "walks_allowed",
    side: "MORE",
    tier: "goblin",
  },
  {
    key: "STANDARD_STRIKEOUTS_LESS",
    label: "Standard strikeouts LESS",
    market: "strikeouts",
    side: "LESS",
    tier: "standard",
  },
];

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
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function flatten(v, out = [], seen = new Set()) {
  if (!v || typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out, seen);
    return out;
  }

  if (
    v.player ||
    v.playerName ||
    v.name ||
    v.market ||
    v.statType ||
    v.side ||
    v.result ||
    v.actual !== undefined
  ) {
    out.push(v);
  }

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out, seen);
  }

  return out;
}

function playerOf(r) {
  return r.player || r.playerName || r.name || r.displayName || "UNKNOWN";
}

function marketOf(r) {
  return norm(r.market || r.statType || r.stat || r.projectionType || r.type);
}

function sideOf(r) {
  return String(r.side || r.pick || r.direction || r.prediction || "").toUpperCase();
}

function tierOf(r) {
  return norm(
    r.oddsTier ||
      r.tier ||
      r.specialTier ||
      r.prizePicksTier ||
      r.payoutTier ||
      "standard"
  );
}

function resultOf(r) {
  const raw = String(r.result || r.grade || r.outcome || "").toUpperCase();
  if (raw.includes("HIT") || raw === "WIN" || raw === "WON") return "HIT";
  if (raw.includes("MISS") || raw === "LOSS" || raw === "LOST") return "MISS";
  if (raw.includes("PUSH") || raw === "TIE") return "PUSH";
  if (raw.includes("REFUND") || raw.includes("DNP") || raw.includes("VOID")) return "REFUND";
  return "";
}

function actualOf(r) {
  return r.actual ?? r.actualValue ?? r.final ?? r.statValue ?? r.value ?? null;
}

function lineOf(r) {
  return r.line ?? r.target ?? r.projection ?? r.threshold ?? null;
}

function uniqueKey(r) {
  return [
    norm(playerOf(r)),
    marketOf(r),
    sideOf(r),
    String(lineOf(r) ?? "").trim(),
    tierOf(r),
    resultOf(r),
    String(actualOf(r) ?? "").trim(),
  ].join("|");
}

function summarize(rows) {
  const seen = new Set();
  const deduped = [];

  for (const r of rows) {
    const key = uniqueKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const graded = deduped.filter(r => ["HIT", "MISS", "PUSH", "REFUND"].includes(resultOf(r)));
  const hits = graded.filter(r => resultOf(r) === "HIT").length;
  const misses = graded.filter(r => resultOf(r) === "MISS").length;
  const pushes = graded.filter(r => resultOf(r) === "PUSH").length;
  const refunds = graded.filter(r => resultOf(r) === "REFUND").length;
  const denominator = hits + misses;
  const hitRate = denominator > 0 ? hits / denominator : null;

  return {
    total: deduped.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    refunds,
    unmatched: deduped.length - graded.length,
    hitRate,
    examples: deduped.slice(0, 12).map(r => ({
      result: resultOf(r) || "UNMATCHED",
      player: playerOf(r),
      market: marketOf(r),
      side: sideOf(r),
      line: lineOf(r),
      tier: tierOf(r),
      actual: actualOf(r),
      file: r.__file,
    })),
  };
}

function main() {
  const allRows = [];

  for (const file of FILES) {
    const data = readJson(file);
    if (!data) continue;
    const rows = flatten(data);
    for (const r of rows) {
      r.__file = file;
      allRows.push(r);
    }
  }

  const buckets = {};

  for (const bucket of BUCKETS) {
    const rows = allRows.filter(r => {
      const market = marketOf(r);
      const side = sideOf(r);
      const tier = tierOf(r);

      return (
        market === norm(bucket.market) &&
        side === bucket.side &&
        tier === norm(bucket.tier)
      );
    });

    buckets[bucket.key] = {
      key: bucket.key,
      label: bucket.label,
      market: bucket.market,
      side: bucket.side,
      tier: bucket.tier,
      ...summarize(rows),
    };
  }

  const report = {
    date: DATE,
    sourceFiles: FILES.filter(f => fs.existsSync(f)),
    buckets,
  };

  const lines = [];
  lines.push("PROMOTION WATCH BUCKET GRADES");
  lines.push("================================");
  lines.push(`date=${DATE}`);
  lines.push("");

  for (const bucket of Object.values(buckets)) {
    lines.push(bucket.key);
    lines.push("-".repeat(bucket.key.length));
    lines.push(`label=${bucket.label}`);
    lines.push(
      `total=${bucket.total} graded=${bucket.graded} hits=${bucket.hits} misses=${bucket.misses} pushes=${bucket.pushes} refunds=${bucket.refunds} unmatched=${bucket.unmatched} hitRate=${bucket.hitRate == null ? "n/a" : (bucket.hitRate * 100).toFixed(1) + "%"}`
    );
    for (const ex of bucket.examples) {
      lines.push(
        `  ${ex.result} | ${ex.player} | ${ex.market} ${ex.side} ${ex.line ?? "?"} | tier=${ex.tier} | actual=${ex.actual ?? "?"} | file=${ex.file}`
      );
    }
    lines.push("");
  }

  writeJson(OUT_JSON, report);
  writeJson(OUT_LATEST_JSON, report);
  writeText(OUT_TXT, lines.join("\n"));
  writeText(OUT_LATEST_TXT, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log(`saved: ${OUT_JSON}`);
  console.log(`saved: ${OUT_TXT}`);
}

main();
