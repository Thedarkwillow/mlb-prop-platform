
function addShadowHitBaseSplits(results) {
  const shadow = results.SHADOW_HIGH_PROBABILITY;
  if (!shadow || !Array.isArray(shadow.rows)) return;

  const build = (key, label, marketName) => {
    const rows = shadow.rows.filter(r => String(r.market || "").toLowerCase() === marketName);
    const gradedRows = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));
    const hits = gradedRows.filter(r => String(r.result || "").toUpperCase() === "HIT").length;
    const misses = gradedRows.filter(r => String(r.result || "").toUpperCase() === "MISS").length;
    const pushes = gradedRows.filter(r => String(r.result || "").toUpperCase() === "PUSH").length;
    const refunds = gradedRows.filter(r => String(r.result || "").toUpperCase() === "REFUND").length;
    const unmatched = rows.length - gradedRows.length;

    results[key] = {
      key,
      label,
      total: rows.length,
      graded: gradedRows.length,
      hits,
      misses,
      pushes,
      refunds,
      unmatched,
      hitRate: gradedRows.length ? hits / gradedRows.length : null,
      rows,
    };
  };

  build("SHADOW_HITS_MORE_HIGH_PROB", "Shadow hits MORE high probability", "hits");
  build("SHADOW_BASES_MORE_HIGH_PROB", "Shadow bases MORE high probability", "bases");
}

const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const HIGH_FILE = `outputs/high-probability-boards-${DATE}.json`;

const GRADE_FILES = [
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  `outputs/history/${DATE}-fantasy-grades.json`,
  `outputs/playable-final-slips-graded-${DATE}.json`,
  `outputs/history/${DATE}-production-candidate-grades.json`,
];

const OUT_JSON = `outputs/high-probability-bucket-grades-${DATE}.json`;
const OUT_TXT = `outputs/high-probability-bucket-grades-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/high-probability-bucket-grades-latest.json";
const OUT_LATEST_TXT = "outputs/high-probability-bucket-grades-latest.txt";

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

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function playerOf(r) {
  return r.player || r.playerName || r.name || r.displayName || "";
}

function marketOf(r) {
  return r.market || r.statType || r.stat || "";
}

function sideOf(r) {
  return String(r.side || r.direction || "").toUpperCase();
}

function lineOf(r) {
  const raw = r.line ?? r.target ?? r.projectionLine ?? r.value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function resultOf(r) {
  const raw = String(r.result || r.outcome || r.grade || "").toUpperCase();
  if (raw.includes("HIT") || raw === "WIN" || raw === "WON") return "HIT";
  if (raw.includes("MISS") || raw === "LOSS" || raw === "LOST") return "MISS";
  if (raw.includes("PUSH") || raw === "VOID") return "PUSH";
  if (raw.includes("REFUND")) return "REFUND";
  return "";
}

function actualOf(r) {
  return r.actual ?? r.actualValue ?? r.statActual ?? r.final ?? null;
}

function keyExact(r) {
  return [
    norm(playerOf(r)),
    norm(marketOf(r)),
    sideOf(r),
    String(lineOf(r)),
  ].join("|");
}

function rowProb(r) {
  const raw = r.prob ?? r.probability ?? r.distributionProb ?? r.finalProb;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getBuckets(high) {
  const rows = flatten(high);

  const out = {
    ACTIONABLE_HIGH_PROBABILITY: [],
    GOBLIN_ACTIONABLE_WATCH: [],
    GOBLIN_FANTASY_RESEARCH: [],
    HRR_MORE_RESEARCH: [],
    RESEARCH_HIGH_PROBABILITY: [],
    SHADOW_HIGH_PROBABILITY: [],
    BLOCKED_HIGH_PROBABILITY: [],
  };

  for (const r of rows) {
    const cls = String(r.class || r.candidateClass || r.bucket || "").toUpperCase();
    const market = norm(marketOf(r));
    const side = sideOf(r);
    const tier = norm(r.tier || r.oddsTier || r.specialTier);
    const reasons = Array.isArray(r.reasons) ? r.reasons.join(" ").toLowerCase() : String(r.reasons || "").toLowerCase();

    if (!playerOf(r) || !marketOf(r) || !side || lineOf(r) == null) continue;

    if (market.includes("fantasy")) {
      out.GOBLIN_FANTASY_RESEARCH.push(r);
    } else if (market === "hrr" && side === "MORE") {
      out.HRR_MORE_RESEARCH.push(r);
    } else if (cls.includes("SHADOW") || reasons.includes("shadow")) {
      out.SHADOW_HIGH_PROBABILITY.push(r);
    } else if (cls.includes("BLOCK")) {
      out.BLOCKED_HIGH_PROBABILITY.push(r);
    } else if (tier === "goblin") {
      out.GOBLIN_ACTIONABLE_WATCH.push(r);
    } else if (cls.includes("RESEARCH")) {
      out.RESEARCH_HIGH_PROBABILITY.push(r);
    } else {
      out.ACTIONABLE_HIGH_PROBABILITY.push(r);
    }
  }

  for (const k of Object.keys(out)) {
    const seen = new Set();
    out[k] = out[k].filter((r) => {
      const key = keyExact(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return out;
}

function summarize(bucketName, rows, gradeByExact) {
  const gradedRows = rows.map((r) => {
    const key = keyExact(r);
    const match = gradeByExact.get(key);
    const result = match ? resultOf(match) : "UNMATCHED";
    return {
      bucket: bucketName,
      player: playerOf(r),
      market: marketOf(r),
      side: sideOf(r),
      line: lineOf(r),
      tier: r.tier || r.oddsTier || r.specialTier || "",
      prob: rowProb(r),
      result,
      actual: match ? actualOf(match) : null,
      matchedFile: match?._file || null,
    };
  });

  const graded = gradedRows.filter((r) => ["HIT", "MISS", "PUSH", "REFUND"].includes(r.result));
  const hits = gradedRows.filter((r) => r.result === "HIT").length;
  const misses = gradedRows.filter((r) => r.result === "MISS").length;
  const pushes = gradedRows.filter((r) => r.result === "PUSH").length;
  const refunds = gradedRows.filter((r) => r.result === "REFUND").length;
  const unmatched = gradedRows.filter((r) => r.result === "UNMATCHED").length;
  const decisionDenom = hits + misses;
  const hitRate = decisionDenom ? hits / decisionDenom : null;

  return {
    bucket: bucketName,
    total: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    refunds,
    unmatched,
    hitRate,
    rows: gradedRows,
  };
}

const high = readJson(HIGH_FILE);
if (!high) {
  console.error(`Missing high probability file: ${HIGH_FILE}`);
  process.exit(1);
}

const gradeRows = [];
for (const file of GRADE_FILES) {
  const data = readJson(file);
  if (!data) continue;
  for (const row of flatten(data)) {
    const result = resultOf(row);
    if (!result) continue;
    if (!playerOf(row) || !marketOf(row) || !sideOf(row) || lineOf(row) == null) continue;
    gradeRows.push({ ...row, _file: file });
  }
}

const gradeByExact = new Map();
for (const r of gradeRows) {
  const key = keyExact(r);
  if (!gradeByExact.has(key)) gradeByExact.set(key, r);
}

const buckets = getBuckets(high);
const summaries = Object.fromEntries(
  Object.entries(buckets).map(([name, rows]) => [name, summarize(name, rows, gradeByExact)])
);

const report = {
  date: DATE,
  source: HIGH_FILE,
  gradeFiles: GRADE_FILES.filter((f) => fs.existsSync(f)),
  note: "Matches by player + market + side + line and intentionally ignores tier for research grading.",
  summaries,
};
addShadowHitBaseSplits(report.buckets || report.results || report.summary || {});


const lines = [];
lines.push("HIGH-PROBABILITY BUCKET GRADES");
lines.push("================================");
lines.push(`date=${DATE}`);
lines.push(`source=${HIGH_FILE}`);
lines.push("matchKey=player+market+side+line; tier ignored");
lines.push("");

for (const [name, s] of Object.entries(summaries)) {
  if (!s.total) continue;
  lines.push(name);
  lines.push("-".repeat(name.length));
  lines.push(
    `total=${s.total} graded=${s.graded} hits=${s.hits} misses=${s.misses} pushes=${s.pushes} refunds=${s.refunds} unmatched=${s.unmatched} hitRate=${s.hitRate == null ? "n/a" : (s.hitRate * 100).toFixed(1) + "%"}`
  );
  for (const r of s.rows) {
    lines.push(
      `  ${r.result} | ${r.player} | ${r.market} ${r.side} ${r.line} | tier=${r.tier || "?"} | prob=${r.prob == null ? "?" : (r.prob * 100).toFixed(2) + "%"} | actual=${r.actual ?? "?"}`
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
