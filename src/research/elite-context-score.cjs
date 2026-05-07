function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function scoreEliteContext(leg = {}) {
  let score = 0;
  const notes = [];

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
  if (books >= 3) {
    score += 0.015;
    notes.push("strong book support");
  } else if (books <= 1) {
    score -= 0.018;
    notes.push("low book support");
  }

  const edge = Number(leg.edge || 0);
  if (edge >= 0.25) {
    score += 0.01;
    notes.push("large raw edge");
  }

  return {
    contextScore: Number(clamp(score, -0.05, 0.05).toFixed(4)),
    contextNotes: notes
  };
}

module.exports = {
  scoreEliteContext
};
