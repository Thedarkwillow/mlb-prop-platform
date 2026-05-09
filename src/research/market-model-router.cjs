function normMarket(x) {
  return String(x.market || x.stat || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function marketModelScore(x = {}) {
  const market = normMarket(x);
  const side = String(x.side || "").toUpperCase();
  const line = Number(x.line);
  const cal = Number(x.calibratedDistributionProb);
  const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? 0);
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);
  const savant = String(x.savantReportGrade || x.savant || "").toUpperCase();

  let score = 0;
  const notes = [];

  if (Number.isFinite(cal)) {
    if (cal >= 0.72) { score += 0.018; notes.push("high calibrated probability"); }
    else if (cal >= 0.66) { score += 0.01; notes.push("solid calibrated probability"); }
    else if (cal < 0.58) { score -= 0.015; notes.push("thin calibrated probability"); }
  }

  if (edge >= 0.085) { score += 0.01; notes.push("strong adjusted edge"); }
  if (books <= 1) { score -= 0.012; notes.push("low book support"); }
  if (books >= 3) { score += 0.012; notes.push("multi-book support"); }

  if (savant === "BOOST") score += 0.006;
  if (savant === "DOWNGRADE") score -= 0.01;

  if (market === "hrr") {
    score += line === 0.5 && side === "MORE" ? 0.004 : 0;
    notes.push("hrr model");
  } else if (market === "bases") {
    score += 0.006;
    notes.push("total bases model");
  } else if (market === "hits") {
    score += 0.005;
    notes.push("hitter hits model");
  } else if (market.includes("strikeout")) {
    score += 0.008;
    notes.push("pitcher strikeouts model");
  } else if (market === "pitching_outs") {
    score += 0.007;
    notes.push("pitching outs model");
  } else if (market === "hits_allowed") {
    score += 0.005;
    notes.push("hits allowed model");
  } else if (market === "earned_runs_allowed") {
    score += 0.004;
    notes.push("earned runs model");
  } else if (market.includes("hitter_fantasy") || market.includes("hitter_fantasy_score")) {
    score += 0.006;
    notes.push("verified hitter fantasy model");
  } else if (market.includes("pitcher_fantasy") || market.includes("pitcher_fantasy_score")) {
    score += 0.006;
    notes.push("verified pitcher fantasy model");
  } else if (market.includes("fantasy")) {
    score += 0.004;
    notes.push("verified fantasy scoring model");
  } else {
    score -= 0.01;
    notes.push("unsupported market model");
  }

  return {
    marketModel: market,
    marketModelScore: Number(clamp(score, -0.05, 0.05).toFixed(4)),
    marketModelNotes: notes
  };
}

module.exports = { normMarket, marketModelScore };
