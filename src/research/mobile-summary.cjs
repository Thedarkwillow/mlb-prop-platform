const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(x) {
  if (x == null || !Number.isFinite(Number(x))) return "n/a";
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function num(x, d = 4) {
  if (x == null || !Number.isFinite(Number(x))) return "n/a";
  return Number(x).toFixed(d);
}

function legLine(l, i) {
  return `${i + 1}. ${l.player} | ${l.team || ""} | ${l.game || ""} | ${l.market} ${l.side} ${l.line} | prob=${num(l.prob ?? l.calibratedDistributionProb)} | edge=${num(l.edge ?? l.sportsbookEdge)} | books=${l.books ?? l.sportsbookBookCount ?? "?"}`;
}

const playable = read("outputs/playable-final-slips.json", []);
const watchlist = read("outputs/watchlist-final-slips.json", []);
const coverage = read("outputs/distribution-coverage-report.json", {});
const clvRows = read(`outputs/clv-report-${DATE}.json`, []);
const clv = Array.isArray(clvRows) && clvRows.length
  ? {
      trackedLegs: clvRows.length,
      avgClv: clvRows.reduce((a, x) => a + Number(x.clv || 0), 0) / clvRows.length,
      beatCloseRate: clvRows.filter(x => x.beatClose).length / clvRows.length
    }
  : null;
const roi = read(`outputs/roi-summary-${DATE}.json`, read("outputs/roi-summary.json", null));
const graded = read(`outputs/playable-final-slips-graded-${DATE}.json`, []);

const allLegs = playable.flatMap(s => s.legs || []);
const unique = [];
const seen = new Set();
for (const l of allLegs) {
  const k = [l.player, l.market, l.side, l.line].join("|").toLowerCase();
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(l);
}
unique.sort((a, b) =>
  Number(b.score ?? b.sportsbookAdjustedEdge ?? b.edge ?? 0) -
  Number(a.score ?? a.sportsbookAdjustedEdge ?? a.edge ?? 0)
);

const gradedLegs = Array.isArray(graded)
  ? graded.flatMap(s => s.legs || [])
  : [];
const unknownGraded = gradedLegs.filter(l => l.result === "UNKNOWN").length;
const finishedGraded = gradedLegs.filter(l => ["HIT", "MISS", "PUSH"].includes(l.result)).length;

console.log("MOBILE MLB PROP COMMAND CENTER");
console.log("==============================");
console.log(`Slate date: ${DATE}`);
console.log(`Playable slips: ${playable.length}`);
console.log(`Watchlist slips: ${watchlist.length}`);
console.log(`Distribution coverage: ${coverage.coverage ?? coverage.overallCoverage ?? "unknown"}`);
console.log("");

console.log("BEST PLAYABLE SLIP");
console.log("------------------");
if (!playable.length) {
  console.log("None.");
} else {
  const s = playable[0];
  console.log(`${s.name || s.slip} | status=${s.status} | green=${s.green ?? "?"} | neutral=${s.neutral ?? 0}`);
  (s.legs || []).forEach((l, i) => console.log(legLine(l, i)));
}
console.log("");

console.log("TOP UNIQUE LEGS");
console.log("---------------");
unique.slice(0, 10).forEach((l, i) => console.log(legLine(l, i)));
if (!unique.length) console.log("None.");
console.log("");

console.log("CLV SUMMARY");
console.log("-----------");
if (!clv) {
  console.log("No CLV report yet. Run: npm run clv --date=YYYY-MM-DD");
} else {
  console.log(`Tracked legs: ${clv.trackedLegs}`);
  console.log(`Average CLV: ${Number(clv.avgClv).toFixed(2)} cents`);
  console.log(`Beat close: ${pct(clv.beatCloseRate)}`);
}
console.log("");

console.log("ROI SUMMARY");
console.log("-----------");
if (!roi) {
  console.log("No ROI report yet. Run after grading: npm run roi --date=YYYY-MM-DD");
} else {
  console.log(`Graded legs: ${roi.gradedLegs ?? "?"}`);
  if (roi.byMarket) {
    for (const [market, r] of Object.entries(roi.byMarket).slice(0, 8)) {
      console.log(`${market}: picks=${r.picks} hitRate=${pct(r.hitRate)} roi=${pct(r.roi)}`);
    }
  }
}
console.log("");

console.log("WARNINGS");
console.log("--------");
if (unknownGraded > 0) console.log(`Games not final / unresolved graded legs: ${unknownGraded}`);
if (finishedGraded === 0) console.log("No finished graded legs yet. ROI is not meaningful until games finish.");
if (unique.some(l => Number(l.books ?? l.sportsbookBookCount ?? 0) < 2)) {
  console.log("Some legs have low book support.");
}
if (!clv) console.log("CLV needs snapshots from: npm run snap");
if (!playable.length && !watchlist.length) console.log("No slips found. Run: npm run picks");
