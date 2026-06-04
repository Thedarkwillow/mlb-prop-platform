const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const HIGH_FILE = `outputs/high-probability-boards-${DATE}.json`;
const FULL_BOARD_FILE = `outputs/history/${DATE}-full-board-graded.json`;
const OUT_JSON = `outputs/high-probability-hrr-synthetic-grades-${DATE}.json`;
const OUT_TXT = `outputs/high-probability-hrr-synthetic-grades-${DATE}.txt`;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
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
  ) out.push(v);

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
  return r.player || r.playerName || r.name || "";
}

function marketOf(r) {
  return r.market || r.statType || r.stat || "";
}

function sideOf(r) {
  return String(r.side || r.direction || "").toUpperCase();
}

function lineOf(r) {
  const n = Number(r.line ?? r.target ?? r.projectionLine ?? r.value);
  return Number.isFinite(n) ? n : null;
}

function probOf(r) {
  const n = Number(r.prob ?? r.probability ?? r.distributionProb ?? r.finalProb);
  return Number.isFinite(n) ? n : null;
}

function actualOf(r) {
  const n = Number(r.actual ?? r.actualValue ?? r.statActual ?? r.final);
  return Number.isFinite(n) ? n : null;
}

function resultFromActual(side, line, actual) {
  if (actual == null || line == null) return "UNMATCHED";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNMATCHED";
}

const high = readJson(HIGH_FILE);
const fullBoard = readJson(FULL_BOARD_FILE);

if (!high) {
  console.error(`Missing ${HIGH_FILE}`);
  process.exit(1);
}
if (!fullBoard) {
  console.error(`Missing ${FULL_BOARD_FILE}`);
  process.exit(1);
}

const highRows = flatten(high).filter(r =>
  norm(marketOf(r)) === "hrr" &&
  sideOf(r) === "MORE" &&
  playerOf(r)
);

const fullRows = flatten(fullBoard).filter(r => playerOf(r));

const byPlayerMarket = new Map();
for (const r of fullRows) {
  const key = `${norm(playerOf(r))}|${norm(marketOf(r))}`;
  if (!byPlayerMarket.has(key)) byPlayerMarket.set(key, []);
  byPlayerMarket.get(key).push(r);
}

function componentActual(player, market) {
  const rows = byPlayerMarket.get(`${norm(player)}|${norm(market)}`) || [];
  for (const r of rows) {
    const a = actualOf(r);
    if (a != null) return a;
  }
  return null;
}

function directHrrActual(player) {
  const rows = byPlayerMarket.get(`${norm(player)}|hrr`) || [];
  for (const r of rows) {
    const a = actualOf(r);
    if (a != null) return a;
  }
  return null;
}

const seen = new Set();
const gradedRows = [];

for (const r of highRows) {
  const key = `${norm(playerOf(r))}|${norm(marketOf(r))}|${sideOf(r)}|${lineOf(r)}`;
  if (seen.has(key)) continue;
  seen.add(key);

  const player = playerOf(r);
  const line = lineOf(r);
  const side = sideOf(r);

  let actual = directHrrActual(player);
  let source = "direct_hrr";

  if (actual == null) {
    const hits = componentActual(player, "hits");
    const runs = componentActual(player, "runs");
    const rbis = componentActual(player, "rbis");

    if ([hits, runs, rbis].every(v => v != null)) {
      actual = hits + runs + rbis;
      source = "hits_runs_rbis_components";
    } else {
      source = `missing_components:hits=${hits ?? "?"},runs=${runs ?? "?"},rbis=${rbis ?? "?"}`;
    }
  }

  const result = resultFromActual(side, line, actual);

  gradedRows.push({
    player,
    market: marketOf(r),
    side,
    line,
    tier: r.tier || r.oddsTier || r.specialTier || "",
    prob: probOf(r),
    actual,
    result,
    source,
  });
}

const hits = gradedRows.filter(r => r.result === "HIT").length;
const misses = gradedRows.filter(r => r.result === "MISS").length;
const pushes = gradedRows.filter(r => r.result === "PUSH").length;
const unmatched = gradedRows.filter(r => r.result === "UNMATCHED").length;
const graded = hits + misses + pushes;
const hitRate = hits + misses ? hits / (hits + misses) : null;

const report = {
  date: DATE,
  source: HIGH_FILE,
  fullBoardFile: FULL_BOARD_FILE,
  rule: "Synthetic HRR actual = hits + runs + RBIs when direct HRR actual is unavailable.",
  total: gradedRows.length,
  graded,
  hits,
  misses,
  pushes,
  unmatched,
  hitRate,
  rows: gradedRows,
};

const lines = [];
lines.push("SYNTHETIC HRR HIGH-PROBABILITY GRADES");
lines.push("=====================================");
lines.push(`date=${DATE}`);
lines.push(`total=${report.total} graded=${graded} hits=${hits} misses=${misses} pushes=${pushes} unmatched=${unmatched} hitRate=${hitRate == null ? "n/a" : (hitRate * 100).toFixed(1) + "%"}`);
lines.push("");

for (const r of gradedRows) {
  lines.push(`${r.result} | ${r.player} | ${r.market} ${r.side} ${r.line} | prob=${r.prob == null ? "?" : (r.prob * 100).toFixed(2) + "%"} | actual=${r.actual ?? "?"} | source=${r.source}`);
}

writeJson(OUT_JSON, report);
writeText(OUT_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
