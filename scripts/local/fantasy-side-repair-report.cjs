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

const OUT_JSON = `outputs/fantasy-side-repair-report-${DATE}.json`;
const OUT_LATEST = "outputs/fantasy-side-repair-report-latest.json";
const OUT_TXT = `outputs/fantasy-side-repair-report-${DATE}.txt`;
const OUT_TXT_LATEST = "outputs/fantasy-side-repair-report-latest.txt";

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

  if (
    v.player || v.playerName || v.name ||
    v.market || v.stat || v.statType ||
    v.side || v.pick || v.recommendedSide ||
    v.line || v.ppLine || v.prizepicksLine ||
    v.result || v.gradeResult || v.outcome || v.status
  ) out.push(v);

  for (const val of Object.values(v)) flat(val, out);
  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "hitter fantasy score": "hitter_fantasy_score",
    "pitcher fantasy score": "pitcher_fantasy_score",
    "fantasy score": "fantasy_score"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function isFantasy(r) {
  return marketNorm(r.market || r.stat || r.statType).includes("fantasy");
}

function playerName(r) {
  return r.player || r.playerName || r.name || "";
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  if (s === "MORE" || s === "LESS") return s;
  return "";
}

function getSide(r) {
  return sideNorm(
    r.side ??
    r.pick ??
    r.recommendedSide ??
    r.projectionSide ??
    r.selection ??
    r.direction ??
    r.choice ??
    r.type
  );
}

function resultNorm(r) {
  const s = String(r.result ?? r.gradeResult ?? r.outcome ?? r.status ?? r.hitMiss ?? "").toUpperCase().trim();
  if (["HIT", "WIN", "W", "CASH", "CORRECT"].includes(s)) return "HIT";
  if (["MISS", "LOSS", "L", "LOSE", "INCORRECT"].includes(s)) return "MISS";
  if (["PUSH", "VOID", "REFUND", "DNP"].includes(s)) return s;
  return "";
}

function actualVal(r) {
  return num(r.actual ?? r.actualValue ?? r.final ?? r.value ?? r.statValue, null);
}

function repairedResult(row, repairedSide) {
  const existing = resultNorm(row);
  if (existing) return existing;

  const actual = actualVal(row);
  const line = lineVal(row);
  const side = sideNorm(repairedSide);

  if (actual === null || line === null || !side) return "UNKNOWN";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNKNOWN";
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function lineVal(r) {
  return num(r.line ?? r.ppLine ?? r.prizepicksLine ?? r.target ?? r.threshold, null);
}

function keyNoSide(r) {
  return [
    norm(playerName(r)),
    marketNorm(r.market || r.stat || r.statType),
    String(lineVal(r) ?? "")
  ].join("|");
}

function keyWithSide(r) {
  return [
    norm(playerName(r)),
    marketNorm(r.market || r.stat || r.statType),
    getSide(r),
    String(lineVal(r) ?? "")
  ].join("|");
}

function lineBucket(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 2.5) return "<=2.5";
  if (n <= 5.5) return "3.0-5.5";
  if (n <= 8.5) return "6.0-8.5";
  if (n <= 12.5) return "9.0-12.5";
  return "13.0+";
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

  const result = resultNorm(r);
  if (result === "HIT") {
    b.graded++;
    b.hits++;
  } else if (result === "MISS") {
    b.graded++;
    b.misses++;
  } else if (result === "PUSH") {
    b.pushes++;
  } else if (["REFUND", "VOID", "DNP"].includes(result)) {
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

function rowLine(x) {
  return `${x.bucket}: total=${x.total} graded=${x.graded} hits=${x.hits} misses=${x.misses} pending=${x.pending} hitRate=${pct(x.hitRate)} roiProxy=${pct(x.roiProxy)}`;
}

const fantasyGradeFiles = [
  `outputs/history/${DATE}-fantasy-grades.json`,
  "outputs/fantasy-graded.json"
];

const sideSourceFiles = [
  "outputs/priced-board.json",
  "outputs/slips.json",
  "outputs/slips-priced.json",
  "outputs/slips-distribution-enriched.json",
  "outputs/final-slips.json",
  "outputs/lean-final-slips.json",
  `outputs/lean-final-slips-${DATE}.json`,
  "outputs/lean-watchlist-candidates.json",
  "outputs/production-candidates.json",
  `outputs/production-candidates-${DATE}.json`,
  "outputs/history.json"
];

const gradeRows = fantasyGradeFiles
  .flatMap(file => flat(read(file, []), []).map(r => ({ ...r, sourceFile: file })))
  .filter(isFantasy);

const sideRows = sideSourceFiles
  .flatMap(file => flat(read(file, []), []).map(r => ({ ...r, sourceFile: file })))
  .filter(r => isFantasy(r) && getSide(r));

const sideByNoSideKey = new Map();
const sideByPlayerMarket = new Map();

for (const r of sideRows) {
  const noSide = keyNoSide(r);
  const playerMarket = [norm(playerName(r)), marketNorm(r.market || r.stat || r.statType)].join("|");

  if (!sideByNoSideKey.has(noSide)) sideByNoSideKey.set(noSide, []);
  sideByNoSideKey.get(noSide).push(r);

  if (!sideByPlayerMarket.has(playerMarket)) sideByPlayerMarket.set(playerMarket, []);
  sideByPlayerMarket.get(playerMarket).push(r);
}

function repairSide(r) {
  const existing = getSide(r);
  if (existing) return { side: existing, source: "existing_side" };

  const noSideMatches = sideByNoSideKey.get(keyNoSide(r)) || [];
  const noSideUnique = [...new Set(noSideMatches.map(getSide).filter(Boolean))];
  if (noSideUnique.length === 1) {
    return { side: noSideUnique[0], source: "matched_player_market_line" };
  }

  const playerMarket = [norm(playerName(r)), marketNorm(r.market || r.stat || r.statType)].join("|");
  const pmMatches = sideByPlayerMarket.get(playerMarket) || [];
  const line = lineVal(r);

  const nearby = pmMatches.filter(x => {
    const lx = lineVal(x);
    return line !== null && lx !== null && Math.abs(line - lx) <= 0.01;
  });
  const nearbyUnique = [...new Set(nearby.map(getSide).filter(Boolean))];
  if (nearbyUnique.length === 1) {
    return { side: nearbyUnique[0], source: "matched_nearby_line" };
  }

  return { side: "UNKNOWN", source: "unresolved_side" };
}

const repairedRows = gradeRows.map(r => {
  const repaired = repairSide(r);
  const finalResult = repairedResult(r, repaired.side);
  return {
    date: DATE,
    player: playerName(r),
    team: r.team || null,
    market: marketNorm(r.market || r.stat || r.statType),
    side: repaired.side,
    sideRepairSource: repaired.source,
    line: lineVal(r),
    result: finalResult,
    actual: actualVal(r),
    tier: r.tier ?? r.oddsTier ?? null,
    sourceFile: r.sourceFile,
    raw: r
  };
});

const bySide = new Map();
const bySideLine = new Map();
const byRepairSource = new Map();

for (const r of repairedRows) {
  add(bySide, r.side || "UNKNOWN", r);
  add(bySideLine, `${r.side || "UNKNOWN"}|${lineBucket(r.line)}`, r);
  add(byRepairSource, r.sideRepairSource, r);
}

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  fantasyGradeFiles,
  sideSourceFiles,
  gradeRows: gradeRows.length,
  sideSourceRows: sideRows.length,
  repairedRows,
  bySide: finalize(bySide),
  bySideLine: finalize(bySideLine),
  byRepairSource: finalize(byRepairSource),
  unresolved: repairedRows.filter(r => r.side === "UNKNOWN")
};

const txt = [
  "FANTASY SIDE REPAIR REPORT",
  "==========================",
  `date: ${DATE}`,
  `gradeRows: ${gradeRows.length}`,
  `sideSourceRows: ${sideRows.length}`,
  `unresolvedSideRows: ${report.unresolved.length}`,
  "",
  "BY SIDE",
  "-------",
  ...report.bySide.map(rowLine),
  "",
  "BY SIDE + LINE",
  "--------------",
  ...report.bySideLine.map(rowLine),
  "",
  "BY REPAIR SOURCE",
  "----------------",
  ...report.byRepairSource.map(rowLine),
  "",
  "UNRESOLVED SAMPLE",
  "-----------------",
  ...report.unresolved.slice(0, 25).map(r => `${r.player} | ${r.market} ${r.line} | result=${r.result} | actual=${r.actual ?? "n/a"} | source=${r.sourceFile}`)
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
