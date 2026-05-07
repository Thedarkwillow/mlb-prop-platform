const fs = require("fs");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const priced = readJson("outputs/slips-distribution-enriched.json", []);
const final = readJson("outputs/final-slips.json", {});
const topLegs = final.topLegs || [];

function displayGrade(x) {
  const grade = x.grade || x.qualityGrade;
  const market = String(x.market || x.stat || "").toLowerCase();
  const adj = Number(x.sportsbookAdjustedEdge ?? x.adjustedEdge);
  const calibrated = Number(x.calibratedDistributionProb ?? x.distributionProb);
  const edge = Number(x.sportsbookEdge ?? x.edge);

  if (
    grade !== "FADE" &&
    Number.isFinite(adj) &&
    Number.isFinite(calibrated) &&
    adj >= 0.085 &&
    calibrated >= 0.67
  ) return "GREEN";

  if (
    grade === "FADE" &&
    ["bases", "hits", "runs", "rbis"].includes(market) &&
    Number.isFinite(edge) &&
    Number.isFinite(adj) &&
    Number.isFinite(calibrated) &&
    edge > 0 &&
    adj >= 0.015 &&
    calibrated >= 0.55
  ) return "WATCHLIST";

  return grade;
}

function marketOf(x) {
  return String(x.market || x.stat || "unknown").toLowerCase();
}

function summarize(rows) {
  const out = {};
  for (const x of rows) {
    const m = marketOf(x);
    out[m] ||= {
      total: 0,
      matched: 0,
      modeled: 0,
      green: 0,
      neutral: 0,
      watchlist: 0,
      fade: 0,
      avgEdge: 0,
      avgAdjEdge: 0,
      avgProb: 0
    };

    const r = out[m];
    r.total++;
    if (x.sportsbookMatch) r.matched++;
    if (x.calibratedDistributionProb != null || x.distributionProb != null) r.modeled++;

    const grade = displayGrade(x);
    if (grade === "GREEN") r.green++;
    else if (grade === "NEUTRAL") r.neutral++;
    else if (grade === "WATCHLIST") r.watchlist++;
    else if (grade === "FADE") r.fade++;

    r.avgEdge += Number(x.sportsbookEdge || x.edge || 0);
    r.avgAdjEdge += Number(x.sportsbookAdjustedEdge || x.adjustedEdge || 0);
    r.avgProb += Number(x.calibratedDistributionProb || x.distributionProb || 0);
  }

  return Object.entries(out).map(([market, r]) => ({
    market,
    total: r.total,
    matched: r.matched,
    modeled: r.modeled,
    green: r.green,
    neutral: r.neutral,
    watchlist: r.watchlist,
    fade: r.fade,
    avgEdge: Number((r.avgEdge / r.total).toFixed(4)),
    avgAdjEdge: Number((r.avgAdjEdge / r.total).toFixed(4)),
    avgProb: Number((r.avgProb / r.total).toFixed(4))
  })).sort((a, b) => b.total - a.total);
}

const allMarkets = summarize(priced);
const finalMarkets = summarize(topLegs);

console.log("\nMARKET EXPOSURE REPORT\n");
console.log("ALL PRICED / MODELED LEGS");
console.table(allMarkets);
console.log("FINAL TOP LEGS");
console.table(finalMarkets);

fs.writeFileSync("outputs/market-exposure-report.json", JSON.stringify({
  generatedAt: new Date().toISOString(),
  allMarkets,
  finalMarkets
}, null, 2));

console.log("Wrote outputs/market-exposure-report.json");
