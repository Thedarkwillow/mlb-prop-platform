const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const blocked = read("outputs/blocked-final-candidates.json", []);
const outPath = "outputs/near-miss-tracking.json";
const existing = read(outPath, []);

const today = new Date().toISOString().slice(0, 10);

function isTrackable(r) {
  if (!r) return false;

  // ONLY track strong plays that were blocked by adaptive logic
  if (r.reason !== "score_below_adaptive_minimum") return false;

  if (!Number.isFinite(r.prob) || !Number.isFinite(r.edge)) return false;

  if (r.prob < 0.62) return false; // strong only
  if (r.edge < 0.12) return false;

  return true;
}

const tracked = [];

for (const r of blocked) {
  if (!isTrackable(r)) continue;

  tracked.push({
    date: today,
    player: r.player,
    market: r.market,
    side: r.side,
    line: r.line,
    prob: r.prob,
    edge: r.edge,
    score: r.score,
    reasonBlocked: r.reason,
    thresholds: r.thresholds
  });
}

const updated = [...existing, ...tracked];

fs.writeFileSync(outPath, JSON.stringify(updated, null, 2));

console.log("Tracked near-misses:", tracked.length);
