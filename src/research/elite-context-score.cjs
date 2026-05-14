function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function normMarket(s) {
  s = String(s || "").toLowerCase().trim();
  if (s.includes("strikeout")) return "strikeouts";
  if (s.includes("pitching_outs") || s.includes("pitching outs") || s.includes("outs")) return "pitching_outs";
  if (s.includes("hrr") || s.includes("hits + runs + rbis")) return "hrr";
  if (s.includes("total bases")) return "bases";
  if (s.includes("runs")) return "runs";
  if (s.includes("rbi")) return "rbis";
  if (s.includes("home_runs") || s.includes("home runs") || s.includes("homer")) return "home_runs";
  if (s.includes("hits allowed")) return "hits_allowed";
  if (s.includes("earned runs")) return "earned_runs_allowed";
  if (s.includes("hits")) return "hits";
  return s;
}

function scoreEliteContext(leg = {}) {
  let score = 0;
  const notes = [];

  const market = normMarket(leg.market || leg.stat);
  const side = String(leg.side || leg.recommendedSide || "").toUpperCase();

  const savant = String(leg.savant || leg.savantSignal || "").toUpperCase();
  if (savant === "BOOST") {
    score += 0.012;
    notes.push("savant boost");
  }
  if (savant === "DOWNGRADE") {
    score -= 0.012;
    notes.push("savant downgrade");
  }

  const books = Number(leg.books || leg.bookCount || 0);
  if (books >= 5) {
    score += 0.02;
    notes.push("elite book support");
  } else if (books >= 3) {
    score += 0.015;
    notes.push("strong book support");
  } else if (books <= 1) {
    score -= 0.018;
    notes.push("low book support");
  }

  const edge = Number(leg.edge || leg.sportsbookEdge || 0);
  if (edge >= 0.25) {
    score += 0.01;
    notes.push("large raw edge");
  }

  // Market-specific caution: these markets are noisier and should not get full context boost.
  if (market === "runs" || market === "rbis" || market === "home_runs") {
    score -= 0.006;
    notes.push("volatile market shrink");
  }

  // HRR LESS remains dangerous/noisy in this platform.
  if (market === "hrr" && side === "LESS") {
    score -= 0.025;
    notes.push("hrr less suppression");
  }

  const contextScore = Number(clamp(score, -0.05, 0.05).toFixed(4));

  return {
    contextScore,
    probabilityAdjustment: contextScore,
    contextNotes: notes
  };
}

function applyContextToProbability(prob, leg = {}) {
  if (!Number.isFinite(prob)) {
    return {
      probability: prob,
      contextAdjustment: 0,
      eliteContext: scoreEliteContext(leg)
    };
  }

  const eliteContext = scoreEliteContext(leg);
  const adjustment = Number(eliteContext.probabilityAdjustment || 0);

  // Conservative direct probability move.
  // Cap prevents context from overpowering base model.
  const contextAdjustment = clamp(adjustment, -0.035, 0.035);
  const probability = Number(clamp(prob + contextAdjustment, 0.02, 0.98).toFixed(4));

  return {
    probability,
    contextAdjustment: Number(contextAdjustment.toFixed(4)),
    eliteContext
  };
}

module.exports = {
  scoreEliteContext,
  applyContextToProbability
};
