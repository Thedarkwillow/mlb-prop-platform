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
      console.log(`${r.type} ${r.bucket}: count=${r.count}, action=${r.action}, edge=${num(r.calibrationEdge)}, heldAdjustment=${num(r.adjustment)}` + "\n");
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
    console.log("Weak manual markets:");
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
    console.log("Avoid / downgrade:");
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

