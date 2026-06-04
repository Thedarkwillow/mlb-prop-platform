const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const HARDENING_FILE = `outputs/production-candidate-hardening-${DATE}.json`;
const OUT_JSON = `outputs/production-hardening-roi-${DATE}.json`;
const OUT_TXT = `outputs/production-hardening-roi-${DATE}.txt`;
const LATEST_JSON = "outputs/production-hardening-roi-latest.json";
const LATEST_TXT = "outputs/production-hardening-roi-latest.txt";
const HISTORY_FILE = "data/results/production-hardening-roi-history.json";

const GRADE_FILES = [
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/history/${DATE}-decision-layer-grades.json`,
  `outputs/history/${DATE}-production-candidate-grades.json`,
  `outputs/history/${DATE}-fantasy-grades.json`,
  `outputs/playable-final-slips-graded-${DATE}.json`,
];

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
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
    v.player || v.playerName ||
    v.market || v.statType ||
    v.side || v.direction ||
    v.result || v.actual !== undefined
  ) {
    out.push(v);
  }

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out, seen);
  }

  return out;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s.+-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function marketOf(r) {
  return norm(r.market || r.statType || r.stat || r.type);
}

function sideOf(r) {
  const s = String(r.side || r.direction || r.pick || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return s || "UNKNOWN";
}

function playerOf(r) {
  return norm(r.player || r.playerName || r.name);
}

function lineOf(r) {
  const n = Number(r.line ?? r.target ?? r.threshold ?? r.projectionLine);
  return Number.isFinite(n) ? n : null;
}

function resultOf(r) {
  const x = String(r.result || r.grade || r.status || "").toUpperCase();
  if (x.includes("HIT") || x === "WIN") return "HIT";
  if (x.includes("MISS") || x === "LOSS") return "MISS";
  if (x.includes("PUSH") || x === "VOID") return "PUSH";
  if (x.includes("REFUND")) return "REFUND";
  return "UNMATCHED";
}

function keyOf(r) {
  return [
    playerOf(r),
    marketOf(r),
    sideOf(r),
    lineOf(r) == null ? "?" : String(lineOf(r)),
  ].join("|");
}

function getClasses(hardening) {
  if (Array.isArray(hardening?.allRows)) {
    return hardening.allRows.map(r => ({
      ...r,
      hardenedClass: r.hardenedClass || r.class || "UNKNOWN",
    }));
  }

  const classes = hardening?.classes || {};
  const rows = [];
  for (const [cls, arr] of Object.entries(classes)) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      rows.push({
        ...r,
        hardenedClass: r.hardenedClass || cls,
      });
    }
  }
  return rows;
}

function summarize(rows) {
  const total = rows.length;
  const gradedRows = rows.filter(r => ["HIT", "MISS", "PUSH", "REFUND"].includes(r.result));
  const graded = gradedRows.filter(r => r.result === "HIT" || r.result === "MISS").length;
  const hits = gradedRows.filter(r => r.result === "HIT").length;
  const misses = gradedRows.filter(r => r.result === "MISS").length;
  const pushes = gradedRows.filter(r => r.result === "PUSH").length;
  const refunds = gradedRows.filter(r => r.result === "REFUND").length;
  const unmatched = rows.filter(r => r.result === "UNMATCHED").length;
  const hitRate = graded ? hits / graded : null;
  const roiProxy = graded ? (hits - misses) / graded : null;

  return { total, graded, hits, misses, pushes, refunds, unmatched, hitRate, roiProxy };
}


function summarizeByFlag(rows) {
  const out = {};
  for (const row of rows) {
    const flags = Array.isArray(row.flags) && row.flags.length ? row.flags : ["no_flags"];
    for (const flag of flags) {
      if (!out[flag]) {
        out[flag] = {
          flag,
          total: 0,
          graded: 0,
          hits: 0,
          misses: 0,
          pushes: 0,
          refunds: 0,
          unmatched: 0,
          hitRate: null,
          roiProxy: null,
        };
      }

      const b = out[flag];
      b.total++;

      const result = String(row.result || row.gradeResult || "").toUpperCase();
      if (result === "HIT") {
        b.graded++;
        b.hits++;
      } else if (result === "MISS") {
        b.graded++;
        b.misses++;
      } else if (result === "PUSH") {
        b.graded++;
        b.pushes++;
      } else if (result === "REFUND") {
        b.refunds++;
      } else {
        b.unmatched++;
      }
    }
  }

  for (const b of Object.values(out)) {
    if (b.graded > 0) {
      b.hitRate = b.hits / b.graded;
      b.roiProxy = (b.hits - b.misses) / b.graded;
    }
  }

  return Object.fromEntries(
    Object.entries(out).sort((a, b) => {
      const ag = a[1].graded || 0;
      const bg = b[1].graded || 0;
      const ar = a[1].hitRate ?? -1;
      const br = b[1].hitRate ?? -1;
      return bg - ag || br - ar;
    })
  );
}

function pct(v) {
  return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

const hardening = readJson(HARDENING_FILE);
if (!hardening) {
  console.error(`Missing hardening file: ${HARDENING_FILE}`);
  console.error(`Run: npm run production:hardening --date=${DATE}`);
  process.exit(1);
}

const hardeningRows = getClasses(hardening);

const gradeRows = [];
for (const file of GRADE_FILES) {
  const data = readJson(file);
  if (!data) continue;
  for (const row of flatten(data)) {
    const key = keyOf(row);
    const result = resultOf(row);
    if (!key.includes("?") && result !== "UNMATCHED") {
      gradeRows.push({ ...row, _gradeFile: file, _key: key, _result: result });
    }
  }
}

const gradeMap = new Map();
for (const g of gradeRows) {
  if (!gradeMap.has(g._key)) gradeMap.set(g._key, g);
}

const graded = hardeningRows.map(r => {
  const key = keyOf(r);
  const g = gradeMap.get(key);
  return {
    date: DATE,
    hardenedClass: r.hardenedClass,
    oldClass: r.oldClass,
    player: r.player,
    team: r.team,
    market: r.market,
    side: r.side,
    line: r.line,
    tier: r.tier,
    prob: r.prob,
    edge: r.edge,
    books: r.books,
    support: r.support,
    grade: r.grade,
    sideBiasTier: r.sideBiasTier,
    stake: r.stake,
    flags: r.flags || [],
    reasons: r.reasons || [],
    result: g?._result || "UNMATCHED",
    actual: g?.actual ?? g?.value ?? null,
    gradeFile: g?._gradeFile || null,
  };
});

const byClass = {};
for (const cls of ["CORE", "LEAN", "CONTROLLED_WATCH", "WATCHLIST", "RESEARCH", "BLOCKED", "SHADOW_BLOCKED"]) {
  byClass[cls] = summarize(graded.filter(r => r.hardenedClass === cls));
}

const byMarketSide = {};
for (const r of graded) {
  const k = `${r.market}|${r.side}`;
  if (!byMarketSide[k]) byMarketSide[k] = [];
  byMarketSide[k].push(r);
}
for (const k of Object.keys(byMarketSide)) {
  byMarketSide[k] = summarize(byMarketSide[k]);
}

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  sourceFile: HARDENING_FILE,
  gradeFiles: GRADE_FILES.filter(f => fs.existsSync(f)),
  summary: summarize(graded),
  byClass,
  byFlag: summarizeByFlag(gradedRows),
  byMarketSide,
  rows: graded,
};

writeJson(OUT_JSON, report);
writeJson(LATEST_JSON, report);

let lines = [];
lines.push("PRODUCTION HARDENING ROI HISTORY");
lines.push("================================");
lines.push(`date=${DATE}`);
lines.push(`source=${HARDENING_FILE}`);
lines.push("");
lines.push("OVERALL");
lines.push("-------");
lines.push(`total=${report.summary.total} graded=${report.summary.graded} hits=${report.summary.hits} misses=${report.summary.misses} pushes=${report.summary.pushes} refunds=${report.summary.refunds} unmatched=${report.summary.unmatched} hitRate=${pct(report.summary.hitRate)} roiProxy=${pct(report.summary.roiProxy)}`);
lines.push("");
lines.push("BY HARDENED CLASS");
lines.push("-----------------");
for (const [cls, s] of Object.entries(byClass)) {
  lines.push(`${cls}: total=${s.total} graded=${s.graded} hits=${s.hits} misses=${s.misses} pushes=${s.pushes} refunds=${s.refunds} unmatched=${s.unmatched} hitRate=${pct(s.hitRate)} roiProxy=${pct(s.roiProxy)}`);
}
lines.push("");

lines.push("");
lines.push("BY BLOCK / REASON FLAG");
lines.push("----------------------");
for (const [flag, b] of Object.entries(report.byFlag || {})) {
  lines.push(`${flag}: total=${b.total} graded=${b.graded} hits=${b.hits} misses=${b.misses} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)} roiProxy=${pct(b.roiProxy)}`);
}

lines.push("TOP GRADED ROWS");
lines.push("---------------");
for (const r of graded.filter(r => r.result !== "UNMATCHED").slice(0, 30)) {
  lines.push(`${r.result} | ${r.hardenedClass} | ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | actual=${r.actual ?? "?"}`);
}
lines.push("");
lines.push("TOP UNMATCHED ROWS");
lines.push("------------------");
for (const r of graded.filter(r => r.result === "UNMATCHED").slice(0, 30)) {
  lines.push(`UNMATCHED | ${r.hardenedClass} | ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier}`);
}

writeText(OUT_TXT, lines.join("\n"));
writeText(LATEST_TXT, lines.join("\n"));

const history = readJson(HISTORY_FILE, []);
const filtered = Array.isArray(history) ? history.filter(r => r.date !== DATE) : [];
filtered.push({
  date: DATE,
  generatedAt: report.generatedAt,
  summary: report.summary,
  byClass: report.byClass,
  byMarketSide: report.byMarketSide,
});
filtered.sort((a, b) => String(a.date).localeCompare(String(b.date)));
writeJson(HISTORY_FILE, filtered);

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved history: ${HISTORY_FILE}`);
