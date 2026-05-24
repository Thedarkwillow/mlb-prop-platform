const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = "data/live/mlb-live-board-history.json";
const OUT = `outputs/live/live-micro-market-coverage-${date}.json`;
const LATEST = "outputs/live/live-micro-market-coverage-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function marketKey(r) {
  return String(r.market || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function isGradeable(r) {
  const m = marketKey(r);
  const win = String(r.inningWindow || "");

  if (m === "strikeouts") return true;
  if (m === "pitches_thrown") return true;
  if (m === "pitching_outs") return true;
  if (m === "hits_allowed") return true;
  if (m === "walks_allowed") return true;
  if (m === "earned_runs_allowed") return true;
    if (m === "hrr") return true;
    if (m === "hitter_fantasy_score") return true;

  if (m === "runs_allowed" && win === "1") return true;

  return false;
}

const rows = read(INPUT, []).filter(r => r.date === date);

const groups = new Map();

for (const r of rows) {
  const key = [
    r.inningWindow || "unknown",
    marketKey(r),
    r.oddsTier || "standard",
    r.side || "UNKNOWN"
  ].join("|");

  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}

const report = [...groups.entries()]
  .map(([key, group]) => {
    const [inningWindow, market, tier, side] = key.split("|");
    const gradeable = group.some(isGradeable);
    return {
      inningWindow,
      market,
      tier,
      side,
      count: group.length,
      gradeable,
      action: gradeable ? "GRADE_SUPPORTED" : "NEEDS_GRADER_SUPPORT",
      examples: group.slice(0, 5).map(r => ({
        player: r.player,
        game: r.game,
        line: r.line,
        status: r.status,
        isLive: r.isLive,
        inGame: r.inGame
      }))
    };
  })
  .sort((a, b) => a.market.localeCompare(b.market) || a.inningWindow.localeCompare(b.inningWindow));

const out = {
  date,
  generatedAt: new Date().toISOString(),
  rows: rows.length,
  report
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
fs.writeFileSync(LATEST, JSON.stringify(out, null, 2));

console.log("MLB LIVE MICRO MARKET COVERAGE");
console.log("------------------------------");
console.log("date:", date);
console.log("rows:", rows.length);
console.table(report.map(r => ({
  inning: r.inningWindow,
  market: r.market,
  tier: r.tier,
  side: r.side,
  count: r.count,
  gradeable: r.gradeable,
  action: r.action
})));
console.log("saved:", OUT);
console.log("saved:", LATEST);
