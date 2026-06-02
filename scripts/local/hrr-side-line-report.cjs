const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const OUT_JSON = `outputs/hrr-side-line-report-${DATE}.json`;
const OUT_LATEST = "outputs/hrr-side-line-report-latest.json";
const OUT_TXT = `outputs/hrr-side-line-report-${DATE}.txt`;
const OUT_TXT_LATEST = "outputs/hrr-side-line-report-latest.txt";

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.stat || v.side || v.line || v.result || v.gradeResult || v.outcome) out.push(v);
  for (const val of Object.values(v)) flat(val, out);
  return out;
}

function normMarket(r) {
  return String(r.market ?? r.stat ?? r.statType ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isHrr(r) {
  const m = normMarket(r);
  return m === "hrr" || m.includes("hits+runs+rbis") || m.includes("hits runs rbis");
}

function side(r) {
  const s = String(r.side ?? r.pick ?? r.recommendedSide ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s || "UNKNOWN";
}

function result(r) {
  const x = String(r.result ?? r.gradeResult ?? r.outcome ?? r.status ?? "").toUpperCase();
  if (["HIT", "WIN", "W", "CASH"].includes(x)) return "HIT";
  if (["MISS", "LOSS", "L"].includes(x)) return "MISS";
  if (["PUSH", "REFUND", "VOID", "DNP"].includes(x)) return x;
  return x || "UNKNOWN";
}

function lineNum(r) {
  const n = Number(r.line ?? r.ppLine ?? r.prizepicksLine);
  return Number.isFinite(n) ? n : null;
}

function lineBucket(r) {
  const n = lineNum(r);
  if (n === null) return "unknown";
  if (n <= 0.5) return "0.5";
  if (n <= 1.5) return "1.5";
  if (n <= 2.5) return "2.5";
  if (n <= 3.5) return "3.5";
  if (n <= 4.5) return "4.5";
  return "5.5+";
}

function add(map, key, r) {
  if (!map.has(key)) {
    map.set(key, {
      bucket: key,
      total: 0,
      graded: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      refunds: 0,
      pending: 0,
      hitRate: null,
      roiProxy: null
    });
  }
  const b = map.get(key);
  b.total++;
  const res = result(r);
  if (res === "HIT") {
    b.graded++;
    b.hits++;
  } else if (res === "MISS") {
    b.graded++;
    b.misses++;
  } else if (res === "PUSH") {
    b.pushes++;
  } else if (["REFUND", "VOID", "DNP"].includes(res)) {
    b.refunds++;
  } else {
    b.pending++;
  }
}

function finalize(map) {
  return [...map.values()]
    .map(x => ({
      ...x,
      hitRate: x.graded ? x.hits / x.graded : null,
      roiProxy: x.graded ? (x.hits - x.misses) / x.graded : null
    }))
    .sort((a, b) => b.graded - a.graded || String(a.bucket).localeCompare(String(b.bucket)));
}

function pct(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? "n/a" : `${(Number(v) * 100).toFixed(1)}%`;
}

function line(row) {
  return `${row.bucket}: total=${row.total} graded=${row.graded} hits=${row.hits} misses=${row.misses} pending=${row.pending} hitRate=${pct(row.hitRate)} roiProxy=${pct(row.roiProxy)}`;
}

const sourceFiles = [
  `outputs/history/${DATE}-hrr-graded.json`,
  `outputs/history/${DATE}-full-board-graded.json`,
  "outputs/graded-props.json"
];

const rows = sourceFiles.flatMap(f => flat(read(f, []))).filter(isHrr);

const bySide = new Map();
const bySideLine = new Map();
const byLine = new Map();

for (const r of rows) {
  add(bySide, side(r), r);
  add(byLine, lineBucket(r), r);
  add(bySideLine, `${side(r)}|${lineBucket(r)}`, r);
}

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  sourceFiles,
  rows: rows.length,
  bySide: finalize(bySide),
  byLine: finalize(byLine),
  bySideLine: finalize(bySideLine)
};

const txt = [
  "HRR SIDE / LINE REPORT",
  "======================",
  `date: ${DATE}`,
  `rows: ${rows.length}`,
  "",
  "BY SIDE",
  "-------",
  ...report.bySide.map(line),
  "",
  "BY LINE",
  "-------",
  ...report.byLine.map(line),
  "",
  "BY SIDE + LINE",
  "--------------",
  ...report.bySideLine.map(line)
].join("\n");

writeJson(OUT_JSON, report);
writeJson(OUT_LATEST, report);
writeText(OUT_TXT, txt);
writeText(OUT_TXT_LATEST, txt);

console.log(txt);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_LATEST}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved: ${OUT_TXT_LATEST}`);
