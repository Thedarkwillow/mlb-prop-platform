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

function legKey(l) {
  return [
    String(l.player || "").toLowerCase().trim(),
    String(l.market || l.stat || "").toLowerCase().trim(),
    String(l.side || l.recommendedSide || "").toUpperCase().trim(),
    String(l.line ?? "").trim()
  ].join("|");
}

function dedupeLegs(legs = []) {
  const seen = new Set();
  return legs.filter(l => {
    const k = legKey(l);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function legLine(l, i) {
  const intel = l.intelAdjustedEdge != null ? ` | intelEdge=${num(l.intelAdjustedEdge)}` : "";
  const notes = Array.isArray(l.intelNotes) && l.intelNotes.length ? ` | intel=${l.intelNotes.join("; ")}` : "";
  return `${i + 1}. ${l.player} | ${l.team || ""} | ${l.game || ""} | ${l.market} ${l.side} ${l.line} | prob=${num(l.prob ?? l.calibratedDistributionProb)} | edge=${num(l.edge ?? l.sportsbookEdge)}${intel} | books=${l.books ?? l.sportsbookBookCount ?? "?"} | grade=${l.validationGrade || l.grade || "?"}${notes}`;
}
function leanWatchlistLine(l, i) {
  const reasons = Array.isArray(l.reasons) ? l.reasons.join(",") : (l.reason || "n/a");
  return `${i + 1}. ${l.classification || "WATCHLIST"} | ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | prob=${num(l.prob)} | edge=${num(l.edge)} | score=${num(l.score)} | confidence=${l.confidence || "?"} | stake=${l.stakeGuidance || "track only"} | reasons=${reasons} | note=${l.note || ""}`;
}

function productionLine(l, i) {
  const reasons = Array.isArray(l.reasons) ? l.reasons.join(",") : "n/a";
  return [
    `${i + 1}. ${l.class || "?"} | ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line}`,
    `   tier=${l.oddsTier || "standard"} | prob=${num(l.prob)} | edge=${num(l.edge)} | books=${l.books ?? "?"} | support=${l.support || "?"} | grade=${l.grade || "?"} | sideBias=${l.sideBias?.tier || "?"}`,
    `   stake=${l.stakeGuidance || "track only"}`,
    `   reasons=${reasons}`
  ].join("\n");
}

function slipLabel(size) {
  if (size === 2) return "2-MAN POWER";
  if (size === 3) return "3-MAN FLEX";
  if (size === 4) return "4-MAN FLEX";
  if (size === 5) return "5-MAN FLEX";
  if (size === 6) return "6-MAN FLEX";
  return `${size}-MAN`;
}

const validated = read("outputs/final-slips-validated.json", []);
const playable = read("outputs/official-slip.json", []);
const watchlist = read("outputs/watchlist-final-slips.json", []);
const leanWatchlistCandidates = read("outputs/lean-watchlist-candidates.json", []);
const productionCandidates = read("outputs/production-candidates.json", null);
const coverage = read("outputs/distribution-coverage-report.json", {});
const validationRules = read("data/results/validation-rules.json", null);

const clvRows = read(`outputs/clv-report-${DATE}.json`, []);
const clv = Array.isArray(clvRows) && clvRows.length
  ? {
      trackedLegs: clvRows.length,
      avgClv: clvRows.reduce((a, x) => a + Number(x.clv || 0), 0) / clvRows.length,
      beatCloseRate: clvRows.filter(x => x.beatClose).length / clvRows.length
    }
  : null;

const roi = read(`outputs/roi-summary-${DATE}.json`, null);
const graded = read(`outputs/playable-final-slips-graded-${DATE}.json`, []);

const validatedRows = Array.isArray(validated) ? validated : [];
const validatedLegs = validatedRows
  .flatMap(x => Array.isArray(x.legs) ? x.legs : [x])
  .filter(l => l && l.player)
  .filter(l => (l.validationGrade || l.grade || "GREEN") !== "WATCHLIST");
const sourceSlips = playable;
const allLegs = sourceSlips.flatMap(s => s.legs || [])
  .filter(l => (l.validationGrade || l.grade || "GREEN") !== "WATCHLIST");

const unique = [];
const seen = new Set();

for (const l of allLegs) {
  const k = [l.player, l.market, l.side, l.line].join("|").toLowerCase();
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(l);
}

unique.sort((a, b) => {
  const aScore = Number(a.intelAdjustedEdge ?? a.score ?? a.sportsbookAdjustedEdge ?? a.edge ?? 0);
  const bScore = Number(b.intelAdjustedEdge ?? b.score ?? b.sportsbookAdjustedEdge ?? b.edge ?? 0);

  if (bScore !== aScore) return bScore - aScore;

  const aProb = Number(a.prob ?? a.calibratedDistributionProb ?? 0);
  const bProb = Number(b.prob ?? b.calibratedDistributionProb ?? 0);

  if (bProb !== aProb) return bProb - aProb;

  return Number(b.books ?? b.sportsbookBookCount ?? 0) -
    Number(a.books ?? a.sportsbookBookCount ?? 0);
});

const gradedLegs = Array.isArray(graded) ? graded.flatMap(s => s.legs || []) : [];
const unknownGraded = gradedLegs.filter(l => l.result === "UNKNOWN").length;
const finishedGraded = gradedLegs.filter(l => ["HIT", "MISS", "PUSH"].includes(l.result)).length;

const validatedCandidates = [];
if (unique.length >= 2) {
  validatedCandidates.push({ name: "2-MAN POWER", status: "PLAYABLE", legs: unique.slice(0, 2), neutral: 0 });
}
if (validatedLegs.length >= 3) {
  validatedCandidates.push({ name: "3-MAN FLEX", status: "PLAYABLE", legs: validatedLegs.slice(0, 3), neutral: 0 });
}

const bestValidated =
  validatedCandidates.find(s => (s.legs || []).length === 2) ||
  validatedCandidates[0] ||
  null;

console.log("MOBILE MLB PROP COMMAND CENTER");
console.log("==============================");
console.log(`Slate date: ${DATE}`);
console.log(`Playable slips: ${playable.length}`);
console.log(`Watchlist slips: ${watchlist.length}`);
console.log(`Distribution coverage: ${coverage.coverage ?? coverage.overallCoverage ?? "unknown"}`);

console.log("");
console.log("BEST VALIDATED SLIP");
console.log("-------------------");
if (!bestValidated) {
  console.log("None.");
} else {
  const bestLegs = dedupeLegs(bestValidated.legs || []);
  const size = bestLegs.length;
  const green = bestLegs.filter(l => (l.validationGrade || l.grade) === "GREEN").length;
  const neutral = bestLegs.filter(l => (l.validationGrade || l.grade) === "NEUTRAL").length;
  const status = green === size ? "PLAYABLE" : green > 0 ? "MIXED" : "PASS";
  console.log(`${slipLabel(size)} | status=${status} | green=${green} | neutral=${neutral}`);
  bestLegs.forEach((l, i) => console.log(legLine(l, i)));
}

console.log("");
console.log("TOP UNIQUE LEGS");
console.log("---------------");
unique.slice(0, 10).forEach((l, i) => console.log(legLine(l, i)));
if (!unique.length) console.log("None.");

console.log("");
console.log("PRODUCTION CANDIDATE CLASSES");
console.log("----------------------------");
const productionRows = Array.isArray(productionCandidates?.all) ? productionCandidates.all : [];
const productionCounts = productionCandidates?.counts || null;

if (productionCounts) {
  console.log(`CORE=${productionCounts.core ?? 0} | LEAN=${productionCounts.lean ?? 0} | WATCHLIST=${productionCounts.watchlist ?? 0} | RESEARCH=${productionCounts.research ?? 0} | BLOCKED=${productionCounts.blocked ?? 0} | SHADOW_BLOCKED=${productionCounts.shadowBlocked ?? 0}`);
}

if (!productionRows.length) {
  console.log("No production candidate report yet. Run: node src/research/production-candidate-report.cjs");
} else {
  for (const className of ["CORE", "LEAN", "WATCHLIST", "RESEARCH", "BLOCKED", "SHADOW_BLOCKED"]) {
    const rows = productionRows
      .filter(r => String(r.class || "").toUpperCase() === className)
      .slice()
      .sort((a, b) => {
        const aProb = Number(a.prob ?? 0);
        const bProb = Number(b.prob ?? 0);
        if (bProb !== aProb) return bProb - aProb;
        return Number(b.edge ?? 0) - Number(a.edge ?? 0);
      })
      .slice(0, className === "BLOCKED" ? 8 : className === "SHADOW_BLOCKED" ? 5 : 5);

    console.log("");
    console.log(className);
    console.log("-".repeat(className.length));

    if (!rows.length) {
      console.log("none");
    } else {
      rows.forEach((l, i) => console.log(productionLine(l, i)));
    }
  }
}

console.log("");
console.log("LEGACY LEAN / WATCHLIST CANDIDATES");
console.log("----------------------------------");
if (!Array.isArray(leanWatchlistCandidates) || !leanWatchlistCandidates.length) {
  console.log("None.");
} else {
  leanWatchlistCandidates
    .slice()
    .sort((a, b) => {
      const aClass = String(a.classification || "").toUpperCase() === "LEAN" ? 1 : 0;
      const bClass = String(b.classification || "").toUpperCase() === "LEAN" ? 1 : 0;
      if (bClass !== aClass) return bClass - aClass;
      const aScore = Number(a.score ?? 0);
      const bScore = Number(b.score ?? 0);
      if (bScore !== aScore) return bScore - aScore;
      return Number(b.prob ?? 0) - Number(a.prob ?? 0);
    })
    .slice(0, 5)
    .forEach((l, i) => console.log(leanWatchlistLine(l, i)));
}
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

  // PRODUCTION_CLASS_ROI_MOBILE_SECTION_V1
  (function printProductionClassRoiMobileSection() {
    const fs = require("fs");
    const file = "outputs/production-candidate-class-roi-latest.json";

    function readJson(path, fallback) {
      try {
        return JSON.parse(fs.readFileSync(path, "utf8"));
      } catch {
        return fallback;
      }
    }

    function pct(v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return "n/a";
      return `${(n * 100).toFixed(1)}%`;
    }

    function fmt(row) {
      if (!row) return "total=0 graded=0 hitRate=n/a roiProxy=n/a";
      const total = Number(row.total ?? 0);
      const graded = Number(row.graded ?? 0);
      const hits = Number(row.hits ?? 0);
      const misses = Number(row.misses ?? 0);
      const pushes = Number(row.pushes ?? 0);
      const refunds = Number(row.refunds ?? 0);
      const unmatched = Number(row.unmatched ?? 0);
      const pending = Number(row.pending ?? 0);
      const shadowUngraded = Number(row.shadowUngraded ?? row.shadow_ungraded ?? 0);
      const hitRate = graded ? (row.hitRate ?? hits / graded) : null;
      const roiProxy = graded ? (row.roiProxy ?? (hits - misses) / graded) : null;
      const extra = shadowUngraded ? ` shadowUngraded=${shadowUngraded}` : "";
      const shownHitRate = graded > 0 ? pct(hitRate) : "n/a";
      const shownRoiProxy = graded > 0 ? pct(roiProxy) : "n/a";
      return `total=${total} graded=${graded} hits=${hits} misses=${misses} pushes=${pushes} refunds=${refunds} unmatched=${unmatched} pending=${pending}${extra} hitRate=${shownHitRate} roiProxy=${shownRoiProxy}`;
    }

    const report = readJson(file, null);

    console.log("");
    console.log("PRODUCTION CLASS ROI");
    console.log("--------------------");

    if (!report) {
      console.log("No production candidate ROI yet. Run: npm run grade:production-candidates -- YYYY-MM-DD");
      return;
    }

    console.log(`date=${report.date || "latest"} | candidateRows=${report.candidateRows ?? "n/a"} | gradeRows=${report.gradeRows ?? "n/a"}`);

    const rows = Array.isArray(report.byClass) ? report.byClass : [];
    const byClass = new Map(rows.map(r => [String(r.bucket || "").toUpperCase(), r]));

    for (const cls of ["CORE", "LEAN", "WATCHLIST", "RESEARCH", "BLOCKED", "SHADOW_BLOCKED"]) {
      console.log(`${cls}: ${fmt(byClass.get(cls))}`);
    }
  })();


console.log("VALIDATION SAMPLE WARNINGS");
console.log("--------------------------");
if (!validationRules) {
  console.log("No validation rules found. Run: npm run validation:rules");
} else {
  const lowSampleRules = [
    ...(validationRules.byProb || []),
    ...(validationRules.byMarket || []),
    ...(validationRules.byBooks || [])
  ].filter(r => r.action === "sample-too-small" || r.action === "light-sample");

  if (!lowSampleRules.length) {
    console.log("No low-sample warnings.");
  } else {
    lowSampleRules.slice(0, 8).forEach(r => {
      console.log(`${r.type} ${r.bucket}: count=${r.count}, action=${r.action}, edge=${num(r.calibrationEdge)}, heldAdjustment=${num(r.adjustment)}`);
    });
  }
}

console.log("");
console.log("WARNINGS");
console.log("--------");
if (unknownGraded > 0) console.log(`Games not final / unresolved graded legs: ${unknownGraded}`);
if ((roi?.gradedLegs || finishedGraded) === 0) console.log("No finished graded legs yet. ROI is not meaningful until games finish.");
if (unique.some(l => Number(l.books ?? l.sportsbookBookCount ?? 0) < 2)) console.log("Some legs have low book support.");
if (!clv) console.log("CLV needs snapshots from: npm run snap");
if (!playable.length && !watchlist.length) console.log("No slips found. Run: npm run picks");


// CANDIDATE_ROI_MOBILE_SECTION_V1
(function printCandidateRoiMobileSection() {
  const fs = require("fs");

  const file = "outputs/candidate-class-roi-report.json";
  if (!fs.existsSync(file)) {
    console.log("");
    console.log("CANDIDATE ROI SUMMARY");
    console.log("---------------------");
    console.log("No candidate ROI report yet. Run: npm run roi:candidates");
    return;
  }

  function readJson(path, fallback) {
    try {
      return JSON.parse(fs.readFileSync(path, "utf8"));
    } catch {
      return fallback;
    }
  }

  function arr(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object") {
      return Object.entries(v).map(([bucket, x]) => ({
        bucket,
        ...(x && typeof x === "object" ? x : {})
      }));
    }
    return [];
  }

  function pickRows(report, keys) {
    for (const key of keys) {
      const v = report?.[key];
      if (v) return arr(v);
    }
    return [];
  }

  function pct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "n/a";
    return `${(n * 100).toFixed(1)}%`;
  }

  function fmtStat(x) {
    if (!x) return "n/a";
    const graded = Number(x.graded ?? x.count ?? x.picks ?? 0);
    const hits = Number(x.hits ?? 0);
    const misses = Number(x.misses ?? 0);
    const unmatched = Number(x.unmatched ?? 0);
    const hitRate = x.hitRate ?? (graded ? hits / graded : null);
    const roi = x.roi ?? (graded ? (hits - misses) / graded : null);
    return `graded=${graded} hits=${hits} misses=${misses} unmatched=${unmatched} hitRate=${pct(hitRate)} roi=${pct(roi)}`;
  }

  function bucketName(x) {
    return String(x.bucket ?? x.layer ?? x.key ?? x.date ?? x.name ?? "unknown");
  }

  function uniqueByBucket(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows || []) {
      const key = bucketName(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  function topByRoi(rows, minGraded = 2, limit = 5, exclude = new Set()) {
    return uniqueByBucket(rows)
      .filter(x => Number(x.graded ?? x.count ?? 0) >= minGraded)
      .filter(x => !exclude.has(bucketName(x)))
      .sort((a, b) => Number(b.roi ?? -999) - Number(a.roi ?? -999))
      .slice(0, limit);
  }

  function bottomByRoi(rows, minGraded = 2, limit = 5, exclude = new Set()) {
    return uniqueByBucket(rows)
      .filter(x => Number(x.graded ?? x.count ?? 0) >= minGraded)
      .filter(x => !exclude.has(bucketName(x)))
      .sort((a, b) => Number(a.roi ?? 999) - Number(b.roi ?? 999))
      .slice(0, limit);
  }

  const report = readJson(file, null);
  if (!report) return;

  const overall =
    report.overall ||
    report.summary ||
    report.total ||
    report.all ||
    null;

  const byDate = pickRows(report, ["byDate", "date", "dates"]);
  const byLayer = pickRows(report, ["byLayer", "layer", "layers"]);
  const byMarketSide = pickRows(report, ["byMarketSide", "byMarketAndSide", "marketSide"]);
  const bySideBias = pickRows(report, ["bySideBias", "sideBias"]);
  const byTier = pickRows(report, ["byTier", "tier", "tiers"]);
  const byProbBucket = pickRows(report, ["byProbBucket", "byProbabilityBucket", "probBucket"]);
  const latestDate = byDate
    .slice()
    .sort((a, b) => String(b.bucket ?? b.date ?? "").localeCompare(String(a.bucket ?? a.date ?? "")))[0];

  console.log("");
  console.log("CANDIDATE ROI SUMMARY");
  console.log("---------------------");

  if (overall) {
    console.log(`Overall: ${fmtStat(overall)}`);
  }

  if (latestDate) {
    console.log(`Latest date ${bucketName(latestDate)}: ${fmtStat(latestDate)}`);
  }

  const bestLayers = topByRoi(byLayer, 2, 4);
  if (bestLayers.length) {
    console.log("Best layers:");
    for (const row of bestLayers) {
      console.log(`- ${bucketName(row)}: ${fmtStat(row)}`);
    }
  }

  const bestLayerNames = new Set(bestLayers.map(bucketName));
  const weakLayers = bottomByRoi(byLayer, 2, 4, bestLayerNames);
  if (weakLayers.length) {
    console.log("Weak layers:");
    for (const row of weakLayers) {
      console.log(`- ${bucketName(row)}: ${fmtStat(row)}`);
    }
  }

  const bucketRows = [
    ...byMarketSide,
    ...bySideBias,
    ...byTier,
    ...byProbBucket
  ];
  const bestBuckets = topByRoi(bucketRows, 3, 8);

  if (bestBuckets.length) {
    console.log("Best candidate buckets:");
    for (const row of bestBuckets) {
      console.log(`- ${bucketName(row)}: ${fmtStat(row)}`);
    }
  }

  const bestBucketNames = new Set(bestBuckets.map(bucketName));
  const weakBuckets = bottomByRoi(bucketRows, 3, 8, bestBucketNames);

  if (weakBuckets.length) {
    console.log("Weak candidate buckets:");
    for (const row of weakBuckets) {
      console.log(`- ${bucketName(row)}: ${fmtStat(row)}`);
    }
  }
})();

// MANUAL_PROPS_MOBILE_SECTION_V1
(function printManualPropsMobileSection() {
  const fs = require("fs");

  const summaryFile = "outputs/manual/manual-research-summary.json";
  const edgeFile = "outputs/manual/manual-edge-mining-report.json";

  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  function arr(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object") {
      return Object.entries(v).map(([key, x]) => ({
        key,
        ...(x && typeof x === "object" ? x : {})
      }));
    }
    return [];
  }

  function pct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "n/a";
    return `${(n * 100).toFixed(1)}%`;
  }

  function roiProxy(x) {
    const hits = Number(x?.hits ?? 0);
    const misses = Number(x?.misses ?? 0);
    const denom = hits + misses;
    if (!denom) return null;
    return (hits - misses) / denom;
  }

  function fmt(x) {
    if (!x) return "n/a";
    const total = Number(x.total ?? x.rows ?? 0);
    const graded = Number(x.graded ?? x.gradedRows ?? 0);
    const hits = Number(x.hits ?? 0);
    const misses = Number(x.misses ?? 0);
    const pushes = Number(x.pushes ?? 0);
    const pending = Number(x.pending ?? 0);
    const refunds = Number(x.refunds ?? 0);
    const hitRate = x.hitRate ?? (hits + misses ? hits / (hits + misses) : null);
    const roi = x.roiProxy ?? x.roi ?? roiProxy(x);
    return `total=${total} graded=${graded} hits=${hits} misses=${misses} pushes=${pushes} pending=${pending} refunds=${refunds} hitRate=${pct(hitRate)} roiProxy=${pct(roi)}`;
  }

  function keyOf(x) {
    return String(x.key ?? x.bucket ?? x.market ?? x.name ?? "unknown");
  }

  function eligible(rows, minGraded = 3) {
    return arr(rows).filter(x => Number(x.graded ?? x.gradedRows ?? 0) >= minGraded);
  }

  function best(rows, minGraded = 3, limit = 5) {
    return eligible(rows, minGraded)
      .sort((a, b) => {
        const ar = Number(a.roiProxy ?? a.roi ?? roiProxy(a) ?? -999);
        const br = Number(b.roiProxy ?? b.roi ?? roiProxy(b) ?? -999);
        return br - ar;
      })
      .slice(0, limit);
  }

  function weak(rows, minGraded = 3, limit = 5) {
    return eligible(rows, minGraded)
      .sort((a, b) => {
        const ar = Number(a.roiProxy ?? a.roi ?? roiProxy(a) ?? 999);
        const br = Number(b.roiProxy ?? b.roi ?? roiProxy(b) ?? 999);
        return ar - br;
      })
      .slice(0, limit);
  }

  const summary = readJson(summaryFile, null);
  const edge = readJson(edgeFile, null);

  console.log("");
  console.log("MANUAL PROPS SUMMARY");
  console.log("--------------------");

  if (!summary) {
    console.log("No manual summary yet. Run: npm run manual");
    return;
  }

  if (summary.overall) {
    console.log(`Overall: ${fmt(summary.overall)}`);
  }

  const bySource = arr(summary.bySource);
  if (bySource.length) {
    console.log("By source:");
    for (const row of bySource) {
      console.log(`- ${keyOf(row)}: ${fmt(row)}`);
    }
  }

  const bestMarkets = best(summary.byMarketSide, 3, 5);
  if (bestMarkets.length) {
    console.log("Best manual markets:");
    for (const row of bestMarkets) {
      console.log(`- ${keyOf(row)}: ${fmt(row)}`);
    }
  }

  const weakMarkets = weak(summary.byMarketSide, 3, 5);
  if (weakMarkets.length) {
    console.log("Lowest manual markets, not downgrade rules:");
    for (const row of weakMarkets) {
      console.log(`- ${keyOf(row)}: ${fmt(row)}`);
    }
  }

  const bestTiers = best(summary.byMarketSideTier, 3, 5);
  if (bestTiers.length) {
    console.log("Best manual market/tier buckets:");
    for (const row of bestTiers) {
      console.log(`- ${keyOf(row)}: ${fmt(row)}`);
    }
  }

  if (edge?.automationCandidates?.length) {
    console.log("Automation candidates:");
    for (const row of edge.automationCandidates.slice(0, 5)) {
      console.log(`- ${keyOf(row)}: graded=${row.graded} hits=${row.hits} misses=${row.misses} hitRate=${pct(Number(row.hitRate) / 100)} roiProxy=${pct(row.roiProxy)}`);
    }
  }

  if (edge?.watchMoreSample?.length) {
    console.log("Watch more sample:");
    for (const row of edge.watchMoreSample.slice(0, 5)) {
      console.log(`- ${keyOf(row)}: graded=${row.graded} hits=${row.hits} misses=${row.misses} hitRate=${pct(Number(row.hitRate) / 100)} roiProxy=${pct(row.roiProxy)}`);
    }
  }

  if (edge?.avoidOrDowngrade?.length) {
    console.log("Manual avoid / downgrade from edge mining:");
    for (const row of edge.avoidOrDowngrade.slice(0, 5)) {
      console.log(`- ${keyOf(row)}: graded=${row.graded} hits=${row.hits} misses=${row.misses} hitRate=${pct(Number(row.hitRate) / 100)} roiProxy=${pct(row.roiProxy)}`);
    }
  }
})();


// SHADOW_WATCHLIST_MOBILE_SECTION_V1
(function printShadowWatchlistMobileSection() {
  const fs = require("fs");
  const path = require("path");

  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  function pct(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "n/a";
    return `${(n * 100).toFixed(1)}%`;
  }

  function fmtRow(row) {
    const graded = Number(row.graded ?? row.totalGraded ?? row.count ?? 0);
    const hits = Number(row.hits ?? 0);
    const misses = Number(row.misses ?? 0);
    const pushes = Number(row.pushes ?? 0);
    const pending = Number(row.pending ?? 0);
    const hitRate = row.hitRate ?? (graded ? hits / graded : null);
    const roi = row.roi ?? (graded ? (hits - misses) / graded : null);
    return `graded=${graded} hits=${hits} misses=${misses} pushes=${pushes} pending=${pending} hitRate=${pct(hitRate)} roi=${pct(roi)}`;
  }

  function fileDateFromName(file) {
    const m = String(file).match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  function latestHistoryFile(kind) {
    const dir = "outputs/history";
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith(`-${kind}.json`))
      .map(f => path.join(dir, f))
      .sort((a, b) => String(fileDateFromName(b) || "").localeCompare(String(fileDateFromName(a) || "")));
    return files[0] || null;
  }

  function countRows(v) {
    if (!v) return 0;
    if (Array.isArray(v)) return v.length;
    if (Array.isArray(v.rows)) return v.rows.length;
    if (Array.isArray(v.watch)) return v.watch.length;
    if (Array.isArray(v.promoted)) return v.promoted.length;
    return 0;
  }

  function topRows(rows, minGraded = 3, limit = 5) {
    return (rows || [])
      .filter(r => Number(r.graded ?? 0) >= minGraded)
      .sort((a, b) =>
        Number(b.roi ?? -999) - Number(a.roi ?? -999) ||
        Number(b.hitRate ?? -999) - Number(a.hitRate ?? -999) ||
        Number(b.graded ?? 0) - Number(a.graded ?? 0)
      )
      .slice(0, limit);
  }

  console.log("");
  console.log("SHADOW / WATCHLIST SUMMARY");
  console.log("--------------------------");

  const auditFile = "outputs/shadow-promotion-audit-latest.json";
  const audit = readJson(auditFile, null);

  if (!audit) {
    console.log("No shadow promotion audit found. Run the shadow promotion audit script before trusting shadow buckets.");
  } else {
    const auditDate = audit.date || "unknown";
    const promoted = Array.isArray(audit.promoted) ? audit.promoted : [];
    const watch = Array.isArray(audit.watch)
      ? audit.watch
      : (Array.isArray(audit.rows) ? audit.rows : []);

    console.log(`Promotion audit date: ${auditDate}`);
    console.log(`Promoted buckets: ${promoted.length}`);
    console.log(`Watch buckets: ${watch.length}`);

    if (auditDate !== "unknown") {
      console.log(`Audit source: ${audit.source || auditFile}`);
    }

    const topWatch = topRows(watch, 3, 5);
    if (topWatch.length) {
      console.log("Top shadow watch buckets:");
      for (const row of topWatch) {
        console.log(`- ${row.bucket || row.key || "unknown"}: ${fmtRow(row)} | action=${row.action || "TRACK_ONLY"} | reason=${row.reason || "n/a"}`);
      }
    } else {
      console.log("Top shadow watch buckets: none with enough graded sample.");
    }
  }

  const unsupportedFile = "outputs/unsupported-market-shadow-report.json";
  const unsupported = readJson(unsupportedFile, null);
  if (unsupported) {
    const summary = Array.isArray(unsupported.summary) ? unsupported.summary : [];
    console.log(`Unsupported shadow date: ${unsupported.date || "unknown"}`);
    if (summary.length) {
      console.log("Unsupported market shadow:");
      for (const row of summary.slice(0, 5)) {
        const bucket = `${row.market || "unknown"} ${row.side || ""}`.trim();
        console.log(`- ${bucket}: plays=${row.plays ?? row.totalRows ?? 0} graded=${row.graded ?? 0} hits=${row.hits ?? 0} misses=${row.misses ?? 0} hitRate=${pct(row.hitRate)} action=${row.action || "n/a"}`);
      }
    }
  } else {
    console.log("Unsupported market shadow: missing.");
  }

  const latestCandidatesFile = latestHistoryFile("shadow-candidates");
  const latestGradedFile = latestHistoryFile("shadow-graded");

  if (latestCandidatesFile) {
    const rows = readJson(latestCandidatesFile, []);
    console.log(`Latest shadow candidates: ${fileDateFromName(latestCandidatesFile)} rows=${countRows(rows)} file=${latestCandidatesFile}`);
  } else {
    console.log("Latest shadow candidates: missing.");
  }

  if (latestGradedFile) {
    const rows = readJson(latestGradedFile, []);
    console.log(`Latest shadow graded: ${fileDateFromName(latestGradedFile)} rows=${countRows(rows)} file=${latestGradedFile}`);
  } else {
    console.log("Latest shadow graded: missing.");
  }

  console.log("Shadow policy: track-only unless separately promoted by validated thresholds.");
})();


// MOBILE_CONTEXT_HEALTH_SECTION_V1
(function printContextHealthSection() {
  const fs = require("fs");

  function readJson(file, fallback = null) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  function pick(obj, paths, fallback = null) {
    for (const path of paths) {
      const parts = path.split(".");
      let cur = obj;
      let ok = true;
      for (const part of parts) {
        if (!cur || typeof cur !== "object" || !(part in cur)) {
          ok = false;
          break;
        }
        cur = cur[part];
      }
      if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
    }
    return fallback;
  }

  function pct(v) {
    if (v === null || v === undefined || v === "") return "n/a";
    if (typeof v === "string") return v;
    const n = Number(v);
    if (!Number.isFinite(n)) return "n/a";
    if (n <= 1) return `${(n * 100).toFixed(1)}%`;
    return `${n.toFixed(1)}%`;
  }

  function statusFromPct(value, good = 80, warn = 50) {
    const raw = typeof value === "string" ? Number(value.replace("%", "")) : Number(value);
    if (!Number.isFinite(raw)) return "UNKNOWN";
    const n = raw <= 1 ? raw * 100 : raw;
    if (n >= good) return "GOOD";
    if (n >= warn) return "PARTIAL";
    return "WEAK";
  }

  const coverage = readJson("outputs/context/context-coverage-report-latest.json", {});
  const arsenal = readJson("outputs/context/arsenal-cache-report-latest.json", {});

  const totalRows = pick(coverage, ["coverage.totalRows", "totalRows"], 0);
  const lineupCoverage = pick(coverage, ["percentages.lineupCoverage", "lineupCoverage"], null);
  const bullpenCoverage = pick(coverage, ["percentages.bullpenCoverage", "bullpenCoverage"], null);
  const catcherCoverage = pick(coverage, ["percentages.catcherCoverage", "catcherCoverage"], null);
  const umpireCoverage = pick(coverage, ["percentages.umpireCoverage", "umpireCoverage"], null);
  const pitchTypeCoverage = pick(coverage, ["percentages.pitchTypeCoverage", "pitchTypeCoverage"], null);
  const handednessCoverage = pick(coverage, ["percentages.handednessCoverage", "handednessCoverage"], null);
  const contextAdjustedCoverage = pick(coverage, ["percentages.contextAdjustedCoverage", "contextAdjustedCoverage"], null);

  const sourcePitchers = pick(arsenal, ["sourcePitchers", "counts.sourcePitchers", "summary.sourcePitchers"], 0);
  const compactPitchers = pick(arsenal, ["compactPitchers", "counts.compactPitchers", "summary.compactPitchers"], 0);
  const starters = pick(arsenal, ["starters", "counts.starters", "summary.starters"], 0);
  const bullpen = pick(arsenal, ["bullpen", "counts.bullpen", "summary.bullpen"], 0);
  const unknownRole = pick(arsenal, ["unknownRole", "counts.unknownRole", "summary.unknownRole"], 0);
  const cleanup = pick(arsenal, ["cleanup", "rawCleanup"], {});
  const rawDeleted = pick(cleanup, ["deleted"], 0);
  const rawKept = pick(cleanup, ["kept"], 0);
  const retentionDays = pick(cleanup, ["retentionDays"], "n/a");

  console.log("");
  console.log("CONTEXT HEALTH");
  console.log("--------------");
  console.log(`Board rows checked: ${totalRows || "n/a"}`);
  console.table([
    {
      layer: "Lineup",
      coverage: pct(lineupCoverage),
      status: statusFromPct(lineupCoverage, 90, 70)
    },
    {
      layer: "Handedness",
      coverage: pct(handednessCoverage),
      status: statusFromPct(handednessCoverage, 90, 70)
    },
    {
      layer: "Pitch type",
      coverage: pct(pitchTypeCoverage),
      status: statusFromPct(pitchTypeCoverage, 70, 40)
    },
    {
      layer: "Catcher framing",
      coverage: pct(catcherCoverage),
      status: statusFromPct(catcherCoverage, 80, 55)
    },
    {
      layer: "Umpire",
      coverage: pct(umpireCoverage),
      status: statusFromPct(umpireCoverage, 70, 40)
    },
    {
      layer: "Bullpen fatigue",
      coverage: pct(bullpenCoverage),
      status: statusFromPct(bullpenCoverage, 70, 40)
    },
    {
      layer: "Context adjusted",
      coverage: pct(contextAdjustedCoverage),
      status: statusFromPct(contextAdjustedCoverage, 70, 40)
    }
  ]);

  console.log("ARSENAL CACHE");
  console.log("-------------");
  console.table([
    {
      sourcePitchers,
      compactPitchers,
      starters,
      bullpen,
      unknownRole,
      rawKept,
      rawDeleted,
      retentionDays
    }
  ]);

  const warnings = [];
  if (statusFromPct(pitchTypeCoverage, 70, 40) === "WEAK") warnings.push("pitch_type_context_weak");
  if (statusFromPct(bullpenCoverage, 70, 40) === "WEAK") warnings.push("bullpen_context_weak");
  if (statusFromPct(umpireCoverage, 70, 40) === "WEAK") warnings.push("umpire_context_weak");
  if (Number(compactPitchers || 0) < 60) warnings.push("arsenal_cache_low_pitcher_count");
  if (Number(bullpen || 0) < 30) warnings.push("bullpen_arsenal_low_count");

  console.log("");
  console.log("REAL CONTEXT QUALITY");
  console.log("--------------------");
  console.log("Note: CONTEXT HEALTH is field/fallback coverage. This section separates real signal from fallback where available.");

  const pricedBoard = readJson("outputs/priced-board.json", []);
  const boardRows = Array.isArray(pricedBoard)
    ? pricedBoard.filter(r => r && typeof r === "object" && r.recordType !== "pricing_summary")
    : [];
  const boardTotal = boardRows.length || Number(totalRows || 0) || 0;

  function qPct(n, d) {
    if (!d) return "n/a";
    return `${((Number(n || 0) / Number(d || 0)) * 100).toFixed(1)}%`;
  }

  function isBadText(v) {
    const s = String(v ?? "").trim().toLowerCase();
    return (
      !s ||
      ["unknown", "neutral", "fallback", "missing", "default", "n/a", "na", "null"].includes(s) ||
      s.includes("unknown") ||
      s.includes("neutral") ||
      s.includes("fallback") ||
      s.includes("missing")
    );
  }

  const pitchReconcile = readJson("outputs/context/pitch-type-real-coverage-reconcile-latest.json", null);
  const oldPitchReport = readJson("outputs/context/real-pitch-type-coverage-latest.json", null);
  const oldPitchCounts = oldPitchReport?.counts || oldPitchReport || {};
  const pitchRows = Number(
    pitchReconcile?.summary?.rows ||
    pitchReconcile?.rows ||
    oldPitchCounts.rows ||
    oldPitchCounts.totalRows ||
    0
  );
  const realPitchScored = Number(
    pitchReconcile?.summary?.coverageStyleReal ||
    pitchReconcile?.summary?.strictReal ||
    oldPitchCounts.realScored ||
    oldPitchCounts.realScoredRows ||
    0
  );
  const neutralPitchFallback = Math.max(0, pitchRows - realPitchScored);

  const lineupProjectionRows = boardRows.filter(r => r.lineupStrengthReady === true).length;

  const confirmedLineupRows = boardRows.filter(r => {
    const vals = [r.lineupStatus, r.confirmedLineup, r.isConfirmedLineup, r.lineupConfirmed]
      .map(v => String(v ?? "").toLowerCase());
    return vals.some(v => v === "true" || v === "confirmed" || v.includes("confirmed"));
  }).length;

  const handednessMatchedRows = boardRows.filter(r => r.handednessMatched === true || r.handednessContext).length;
  const handednessReadyRows = boardRows.filter(r => r.handednessReady === true).length;

  const realCatcherRows = boardRows.filter(r =>
    r.opponentCatcherFramingReady === true &&
    String(r.opponentCatcherFramingSource || "").toUpperCase() !== "NEUTRAL_FALLBACK" &&
    !isBadText(r.opponentCatcher)
  ).length;

  function isRealUmpireValue(v) {
    if (v === undefined || v === null || v === "") return false;
    if (typeof v === "object") {
      const source = String(v.source || "").toUpperCase();
      if (source.includes("NEUTRAL") || source.includes("FALLBACK")) return false;
      const name =
        v.name ||
        v.umpire ||
        v.plateUmpire ||
        v.homePlateUmpire ||
        v.fullName ||
        "";
      return isRealUmpireValue(name);
    }
    return !isBadText(v);
  }

  const realUmpireRows = boardRows.filter(r =>
    r.umpireFramingAdjusted === true &&
    (
      isRealUmpireValue(r.plateUmpire) ||
      isRealUmpireValue(r.umpire)
    )
  ).length;

  const realBullpenRows = boardRows.filter(r =>
    r.ownBullpenFatigueReady === true ||
    r.opponentBullpenFatigueReady === true ||
    r.ownBullpenFatigueTier ||
    r.opponentBullpenFatigueTier
  ).length;

  function nonZeroNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) > 0;
  }

  function hasRealContextAdjustmentImpact(r) {
    const adj = r.contextAdjustment && typeof r.contextAdjustment === "object"
      ? r.contextAdjustment
      : null;

    if (adj) {
      if (Array.isArray(adj.flags) && adj.flags.length > 0) return true;
      if (nonZeroNumber(adj.probDelta)) return true;
      if (nonZeroNumber(adj.projectionDeltaPct)) return true;
      if (nonZeroNumber(adj.adjustment)) return true;
      if (nonZeroNumber(adj.score)) return true;
    }

    if (Array.isArray(r.contextFlags) && r.contextFlags.length > 0) return true;

    return [
      r.contextAdjustmentValue,
      r.contextAdjustmentScore,
      r.lineupAdjustment,
      r.handednessAdjustmentValue,
      r.pitchTypeMatchupScore,
      r.umpireFramingAdjustment,
      r.catcherFramingAdjustment,
      r.bullpenFatigueAdjustment,
      r.contactQualityAdjustment,
      r.calibrationAdjustment
    ].some(nonZeroNumber);
  }

  const contextAdjustmentRows = boardRows.filter(hasRealContextAdjustmentImpact).length;

  console.table([
    {
      layer: "Lineup projection",
      contextFieldCoverage: pct(lineupCoverage),
      realSignal: qPct(lineupProjectionRows, boardTotal),
      neutralFallback: qPct(boardTotal - lineupProjectionRows, boardTotal),
      realRows: `${lineupProjectionRows}/${boardTotal}`,
      note: "Lineup strength/projection context; not confirmed lineup status."
    },
    {
      layer: "Confirmed lineup",
      contextFieldCoverage: "n/a",
      realSignal: qPct(confirmedLineupRows, boardTotal),
      neutralFallback: qPct(boardTotal - confirmedLineupRows, boardTotal),
      realRows: `${confirmedLineupRows}/${boardTotal}`,
      note: "Confirmed lineup status attached from MLB live feed; coverage rises as teams post lineups."
    },
    {
      layer: "Handedness",
      contextFieldCoverage: pct(handednessCoverage),
      realSignal: qPct(handednessMatchedRows, boardTotal),
      neutralFallback: qPct(boardTotal - handednessMatchedRows, boardTotal),
      realRows: `${handednessMatchedRows}/${boardTotal}`,
      note: `Ready rows: ${handednessReadyRows}/${boardTotal}. Matched/context rows shown as real signal.`
    },
    {
      layer: "Pitch type scored",
      contextFieldCoverage: pct(pitchTypeCoverage),
      realSignal: pitchRows ? qPct(realPitchScored, pitchRows) : "n/a",
      neutralFallback: pitchRows ? qPct(neutralPitchFallback, pitchRows) : "n/a",
      realRows: pitchRows ? `${realPitchScored}/${pitchRows}` : "n/a",
      note: "Uses pitch-type reconcile report; missing rows are mostly missing pitcher arsenal or hitter profile."
    },
    {
      layer: "Catcher framing",
      contextFieldCoverage: pct(catcherCoverage),
      realSignal: qPct(realCatcherRows, boardTotal),
      neutralFallback: qPct(boardTotal - realCatcherRows, boardTotal),
      realRows: `${realCatcherRows}/${boardTotal}`,
      note: "Real catcher identity attached; neutral tier can still be a real confirmed catcher with no strong framing edge."
    },
    {
      layer: "Umpire",
      contextFieldCoverage: pct(umpireCoverage),
      realSignal: qPct(realUmpireRows, boardTotal),
      neutralFallback: qPct(boardTotal - realUmpireRows, boardTotal),
      realRows: `${realUmpireRows}/${boardTotal}`,
      note: "Confirmed plate umpire assignment attached where posted; remaining rows are missing/fallback."
    },
    {
      layer: "Bullpen fatigue",
      contextFieldCoverage: pct(bullpenCoverage),
      realSignal: qPct(realBullpenRows, boardTotal),
      neutralFallback: qPct(boardTotal - realBullpenRows, boardTotal),
      realRows: `${realBullpenRows}/${boardTotal}`,
      note: "Bullpen fatigue tiers/ready flags are populated."
    },
    {
      layer: "Context adjustment",
      contextFieldCoverage: pct(contextAdjustedCoverage),
      realSignal: qPct(contextAdjustmentRows, boardTotal),
      neutralFallback: qPct(boardTotal - contextAdjustmentRows, boardTotal),
      realRows: `${contextAdjustmentRows}/${boardTotal}`,
      note: "Rows with real non-zero context movement or explicit context flags; contextAdjustedReady alone is fallback/ready state."
    }
  ]);
})();

// REAL_PITCH_TYPE_QUALITY_SECTION_V1
(function printRealPitchTypeQualitySection() {
  const fs = require("fs");

  function readJson(file, fallback = null) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  function pct(n, d) {
    if (!d) return "0.0%";
    return `${((Number(n || 0) / Number(d || 0)) * 100).toFixed(1)}%`;
  }

  const report = readJson("outputs/context/pitch-type-real-coverage-reconcile-latest.json", null);
  const targets = readJson("outputs/context/real-pitch-type-target-list-latest.json", null);
  if (!report && !targets) return;
  const summary = report?.summary || report || {};
  const rows = summary.rows || report?.rows || 0;
  const realScored = summary.coverageStyleReal || summary.strictReal || 0;
  const fallback = rows ? rows - realScored : 0;
  const missing = fallback;

  console.log("");
  console.log("REAL PITCH TYPE QUALITY");
  console.log("-----------------------");
  const pitchQualityBoardRowsRaw = readJson("outputs/priced-board.json", []);
  const pitchQualityBoardRows = Array.isArray(pitchQualityBoardRowsRaw)
    ? pitchQualityBoardRowsRaw
    : [];
  const pitchQualitySlateDate =
    process.env.SLATE_DATE ||
    process.env.npm_config_date ||
    process.argv[2] ||
    slateDate;
  function _dateOnly(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  }
  function _market(row) {
    return String(row.market || row.stat || "").toLowerCase().trim();
  }
  function _isPitcherMarket(row) {
    const m = _market(row);
    const st = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();
    const pos = String(row.position || row.playerPosition || "").toUpperCase();
    if (st === "pitcher" || pos === "P") return true;
    return [
      "strikeouts",
      "pitching_outs",
      "pitches_thrown",
      "pitcher_fantasy_score",
      "hits_allowed",
      "earned_runs_allowed",
      "walks_allowed",
      "1st_inning_runs_allowed",
      "1st_inning_walks_allowed",
      "pitcher_strikeouts_(combo)"
    ].includes(m);
  }
  function _eligible(row) {
    if (!row || row.recordType !== "merged_prop") return false;
    if (row.comboProp === true || row.contextEligible === false) return false;
    if (_isPitcherMarket(row)) return false;
    return [
      "hitter_fantasy_score",
      "hrr",
      "bases",
      "hits",
      "singles",
      "doubles",
      "triples",
      "home_runs",
      "hr",
      "runs",
      "rbis",
      "walks",
      "stolen_bases",
      "hitter_strikeouts"
    ].includes(_market(row));
  }

  const scopedPitchRows = pitchQualityBoardRows.filter(row => {
    const d = _dateOnly(row.startTime || row.game_start || row.start_time || row.board_time || row.updated_at);
    if (d !== pitchQualitySlateDate) return false;
    if (!_eligible(row)) return false;

    // Clean pitch-type denominator:
    // only rows that have an opponent pitcher/hand and were evaluated by pitch-type context.
    const hasPitcher =
      !!(row.pitchTypeOpponentPitcher || row.opponentPitcher || row.handednessContext?.opposingPitcher);
    const hasHand =
      !!(row.pitchTypeOpponentPitcherHand || row.opponentPitcherHand || row.handednessContext?.opposingPitcherHand);
    const touchedByPitchType =
      row.pitchTypeMatchupAvailable === true ||
      row.pitchTypeMatchupScored === true ||
      row.pitchTypeMatchupReady === true ||
      Array.isArray(row.pitchTypeMatchupFlags);

    // Do not require explicit hand field here.
    // Some restored/pre-game boards have pitch-type context already scored,
    // but only sparse pitchTypeOpponentPitcherHand fields.
    return hasPitcher && touchedByPitchType;
  });
  const scopedReal = scopedPitchRows.filter(row =>
    row.pitchTypeMatchupScored === true &&
    row.pitchTypeMatchupSource === "REAL_HITTER_PITCH_TYPE_MATCHUP"
  ).length;
  const scopedNeutral = scopedPitchRows.filter(row =>
    row.pitchTypeMatchupScored === true &&
    String(row.pitchTypeMatchupSource || "").includes("NEUTRAL")
  ).length;
  const scopedUnscored = scopedPitchRows.filter(row => row.pitchTypeMatchupScored !== true).length;

  console.table([{
    rows: scopedPitchRows.length,
    realScored: scopedReal,
    neutralFallback: scopedNeutral,
    missingRealData: scopedNeutral + scopedUnscored,
    realCoverage: pct(scopedReal, scopedPitchRows.length),
    fallbackRate: pct(scopedNeutral + scopedUnscored, scopedPitchRows.length)
  }]);

  const reasonCounts =
    report?.reasonCounts ||
    report?.byReason ||
    report?.summary?.byReason ||
    [];

  if (Array.isArray(reasonCounts) && reasonCounts.length) {
    console.log("Top real pitch-type gaps:");
    console.table(reasonCounts.slice(0, 8));
  }

  const pitcherTargets = targets?.pitcherArsenalTargets || [];
  const hitterTargets = targets?.hitterMatchupTargets || [];

  if (pitcherTargets.length) {
    console.log("Top pitcher arsenal targets:");
    console.table(pitcherTargets.slice(0, 8).map(r => ({
      pitcher: r.pitcher || r.player,
      team: r.team,
      rows: r.rows,
      topMarket: r.marketList?.[0]?.market || r.topMarket || null
    })));
  }

  if (hitterTargets.length) {
    console.log("Top hitter matchup targets:");
    console.table(hitterTargets.slice(0, 8).map(r => ({
      player: r.player,
      pitcher: r.pitcher,
      team: r.team,
      game: r.game,
      rows: r.rows,
      topMarket: r.marketList?.[0]?.market || r.topMarket || null
    })));
  }
})();

