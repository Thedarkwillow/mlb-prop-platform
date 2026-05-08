function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(x, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, x));
}

function gradeFromEdge(edge) {
  edge = num(edge);
  if (edge >= 0.08) return "GREEN";
  if (edge >= 0.04) return "NEUTRAL";
  return "WATCHLIST";
}

module.exports = { num, clamp, gradeFromEdge };
