const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normMarket(s) {
  return String(s || "unknown").toLowerCase().replace(/\s+/g, "_").trim();
}

function sideKey(x = {}) {
  return String(x.side || x.recommendedSide || "").toUpperCase().trim() || "NA";
}

function findRow(arr, bucket) {
  return (arr || []).find(x =>
    String(x.bucket || "").toLowerCase() === String(bucket || "").toLowerCase()
  ) || null;
}

function volatilityAdjustment(leg = {}) {
  const report = readJson("data/results/volatility-scoring.json", null);
  if (!report) {
    return {
      penalty: 0,
      volatility: "unknown",
      applied: false,
      reason: "no_volatility_report"
    };
  }

  const market = normMarket(leg.market || leg.stat);
  const side = sideKey(leg);
  const marketSide = `${market} ${side}`;

  const sideRow = findRow(report.byMarketSide, marketSide);
  const marketRow = findRow(report.byMarket, market);

  const chosen = sideRow && Number(sideRow.count || 0) >= 5 ? sideRow : marketRow;

  if (!chosen || Number(chosen.count || 0) < 5) {
    return {
      penalty: 0,
      volatility: "insufficient_sample",
      applied: false,
      market,
      marketSide,
      row: chosen || null
    };
  }

  return {
    penalty: Number(chosen.penalty || 0),
    volatility: chosen.volatility || "unknown",
    applied: Number(chosen.penalty || 0) !== 0,
    market,
    marketSide,
    row: chosen
  };
}

module.exports = {
  volatilityAdjustment
};
