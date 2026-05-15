const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function arr(x) {
  if (Array.isArray(x)) return x;
  if (Array.isArray(x?.rows)) return x.rows;
  if (Array.isArray(x?.legs)) return x.legs;
  return [];
}

function keyMarket(r) {
  return String(r.market || r.stat || "unknown").toLowerCase().replace(/\s+/g, "_");
}

function keySide(r) {
  return String(r.side || r.recommendedSide || "UNKNOWN").toUpperCase();
}

function resultOf(r) {
  return String(r.result || r.outcome || "").toUpperCase();
}

function probOf(r) {
  const n = Number(
    r.calibratedDistributionProb ??
    r.prob ??
    r.recommendedProb ??
    r.probability
  );
  return Number.isFinite(n) ? n : null;
}

function edgeOf(r) {
  const n = Number(
    r.adjustedEdge ??
    r.sportsbookAdjustedEdge ??
    r.edge ??
    r.sportsbookEdge
  );
  return Number.isFinite(n) ? n : null;
}

function bucketProb(p) {
  if (!Number.isFinite(p)) return "unknown";
  if (p < 0.55) return "<55";
  if (p < 0.60) return "55-60";
  if (p < 0.65) return "60-65";
  if (p < 0.70) return "65-70";
  if (p < 0.75) return "70-75";
  return "75+";
}

function bucketEdge(e) {
  if (!Number.isFinite(e)) return "unknown";
  if (e < 0.05) return "<5%";
  if (e < 0.10) return "5-10%";
  if (e < 0.15) return "10-15%";
  return "15%+";
}

function gradeOf(r) {
  return String(r.grade || r.qualityGrade || r.confidence || "unknown").toLowerCase();
}

function add(group, key, r) {
  if (!group[key]) group[key] = {
    bucket: key,
    count: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    unknown: 0,
    profit: 0,
    avgProbSum: 0,
    avgProbCount: 0,
    avgEdgeSum: 0,
    avgEdgeCount: 0
  };

  const g = group[key];
  const res = resultOf(r);
  const p = probOf(r);
  const e = edgeOf(r);

  g.count++;
  if (res === "HIT" || res === "WIN") {
    g.wins++;
    g.profit += 1;
  } else if (res === "MISS" || res === "LOSS") {
    g.losses++;
    g.profit -= 1;
  } else if (res === "PUSH") {
    g.pushes++;
  } else {
    g.unknown++;
  }

  if (Number.isFinite(p)) {
    g.avgProbSum += p;
    g.avgProbCount++;
  }

  if (Number.isFinite(e)) {
    g.avgEdgeSum += e;
    g.avgEdgeCount++;
  }
}

function finalize(group) {
  return Object.values(group)
    .map(g => {
      const graded = g.wins + g.losses;
      return {
        bucket: g.bucket,
        count: g.count,
        graded,
        wins: g.wins,
        losses: g.losses,
        pushes: g.pushes,
        unknown: g.unknown,
        hitRate: graded ? Number((g.wins / graded).toFixed(4)) : null,
        roi: graded ? Number((g.profit / graded).toFixed(4)) : null,
        avgProb: g.avgProbCount ? Number((g.avgProbSum / g.avgProbCount).toFixed(4)) : null,
        avgEdge: g.avgEdgeCount ? Number((g.avgEdgeSum / g.avgEdgeCount).toFixed(4)) : null
      };
    })
    .sort((a, b) => (b.graded - a.graded) || String(a.bucket).localeCompare(String(b.bucket)));
}

const history = arr(read("data/results/graded-leg-history.json", []));
const rolling = read("data/results/rolling-roi-windows.json", {});
const validationRules = read("data/results/validation-rules.json", {});
const volatility = read("data/results/volatility-scoring.json", {});
const regime = read("data/results/regime-detection.json", {});
const phase6Calibration = read("data/learning/phase6-calibration-shrinkage.json", {});
const phase6Features = read("data/learning/phase6-feature-attribution.json", {});
const phase6Regime = read("data/learning/phase6-regime-detection.json", {});
const phase6Exposure = read("data/learning/phase6-exposure-governor.json", {});

const byMarket = {};
const byMarketSide = {};
const byMarketSideTier = {};
const byProb = {};
const byEdge = {};
const byConfidence = {};
const bySavant = {};
const byContext = {};

for (const r of history) {
  const market = keyMarket(r);
  const side = keySide(r);
  add(byMarket, market, r);
  add(byMarketSide, `${market}_${side}`, r);
  const tier = String(r.oddsTier || r.tier || "standard").toLowerCase().trim();
  add(byMarketSideTier, `${market}_${side}_${tier}`, r);
  add(byProb, bucketProb(probOf(r)), r);
  add(byEdge, bucketEdge(edgeOf(r)), r);
  add(byConfidence, gradeOf(r), r);

  const sav = String(r.savant || r.savantReportGrade || "unknown").toLowerCase();
  add(bySavant, sav, r);

  const notes = [
    ...(r.eliteContext?.contextNotes || []),
    ...(r.marketModel?.marketModelNotes || []),
    ...(r.distributionModel?.savantV2?.notes || []),
    ...(r.savantV2?.notes || [])
  ];

  for (const n of notes) add(byContext, String(n).toLowerCase(), r);
}

const report = {
  generatedAt: new Date().toISOString(),
  gradedRows: history.length,
  phase5Status: {
    complete: true,
    note: "Phase 5 validation reporting is complete when this file is generated after nightly grading.",
    requiredArtifacts: {
      gradedHistory: fs.existsSync("data/results/graded-leg-history.json"),
      rollingRoi: fs.existsSync("data/results/rolling-roi-windows.json"),
      validationRules: fs.existsSync("data/results/validation-rules.json"),
      volatilityScoring: fs.existsSync("data/results/volatility-scoring.json")
    }
  },
  roi: {
    byMarket: finalize(byMarket),
    byMarketSide: finalize(byMarketSide),
    byMarketSideTier: finalize(byMarketSideTier),
    byProbabilityBucket: finalize(byProb),
    byEdgeBucket: finalize(byEdge),
    byConfidence: finalize(byConfidence),
    bySavant: finalize(bySavant),
    byContext: finalize(byContext)
  },
  currentLearningInputs: {
    rolling,
    validationRules,
    volatility,
    regime,
    phase6Calibration,
    phase6FeaturesSummary: {
      generatedAt: phase6Features.createdAt || null,
      gradedRows: phase6Features.gradedRows || null,
      topPositive: phase6Features.topPositive || [],
      topNegative: phase6Features.topNegative || []
    },
    phase6Regime,
    phase6Exposure
  }
};

fs.writeFileSync("outputs/phase5-master-validation-report.json", JSON.stringify(report, null, 2));

console.log("PHASE 5 MASTER VALIDATION REPORT");
console.log("================================");
console.log("graded rows:", history.length);
console.log("\nROI by market");
console.table(report.roi.byMarket.slice(0, 20));
console.log("\nROI by market side");
console.table(report.roi.byMarketSide.slice(0, 25));
console.log("\nROI by market side tier");
console.table(report.roi.byMarketSideTier.slice(0, 25));
console.log("\nROI by probability bucket");
console.table(report.roi.byProbabilityBucket);
console.log("\nROI by edge bucket");
console.table(report.roi.byEdgeBucket);
console.log("\nROI by context");
console.table(report.roi.byContext.filter(x => x.graded >= 5).slice(0, 25));
console.log("Wrote outputs/phase5-master-validation-report.json");
