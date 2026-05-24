const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = "outputs/mlb-live-board-raw.json";
const LATEST = "outputs/live/mlb-live-board-latest.json";
const HISTORY = "data/live/mlb-live-board-history.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function normMarket(x) {
  const s = String(x || "").toLowerCase();

  if (s.includes("hitter fantasy score") || s.includes("fantasy score")) return "hitter_fantasy_score";
  if (s.includes("hits+runs+rbis") || s.includes("hits + runs + rbis") || s.includes("hrr")) return "hrr";
  if (s.includes("pitcher strikeout") || s.includes("strikeout") || /\bks\b/.test(s)) return "strikeouts";
  if (s.includes("earned runs allowed")) return "earned_runs_allowed";
  if (s.includes("1st inning runs allowed")) return "runs_allowed";
  if (s.includes("runs allowed")) return "runs_allowed";
  if (s.includes("walks allowed")) return "walks_allowed";
  if (s.includes("pitches thrown") || s.includes("pitch_count") || s.includes("pitches_thrown")) return "pitches_thrown";
  if (s.includes("outs recorded") || s.includes("pitching outs") || s.includes("pitching_outs")) return "pitching_outs";
  if (s.includes("hits allowed")) return "hits_allowed";

  return s.replace(/\s+/g, "_").trim();
}

function normSide(x) {
  return String(x || "").toUpperCase().trim();
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function rowKey(r) {
  return [
    r.date,
    r.prizepicksId,
    r.player,
    r.team,
    r.game,
    r.market,
    r.side,
    r.line,
    r.inningWindow,
    r.oddsTier,
    r.sourceType
  ].join("|");
}

const rawRows = read(INPUT, []);

if (!Array.isArray(rawRows)) {
  console.error(`Expected array input: ${INPUT}`);
  process.exit(1);
}

const capturedAt = new Date().toISOString();

const snapshot = rawRows
  .filter(r => r && typeof r === "object")
  .map(r => ({
    date: r.date || date,
    capturedAt,
    prizepicksId: r.prizepicksId || r.id || null,
    sourceType: r.sourceType || null,
    trackOnly: r.trackOnly === true,
    player: r.player || r.name || r.playerName || null,
    team: r.team || null,
    game: r.game || null,
    market: normMarket(r.market || r.stat_type || r.statDisplayName),
    side: normSide(r.side),
    line: num(r.line ?? r.line_score),
    inningWindow: String(r.inningWindow || r.inningRange || "full"),
    oddsTier: String(r.oddsTier || r.tier || "standard").toLowerCase(),
    status: r.status || null,
    startTime: r.startTime || r.start_time || null,
    gameId: r.gameId || r.game_id || null,
    durationId: r.durationId || null,
    durationName: r.durationName || null
  }))
  .filter(r => r.market && r.side && r.line !== null && r.player);

const history = read(HISTORY, []);
const merged = [];
const seen = new Set();

for (const r of [...history, ...snapshot]) {
  const k = rowKey(r);
  if (seen.has(k)) continue;
  seen.add(k);
  merged.push(r);
}

write(LATEST, snapshot);
write(HISTORY, merged);

const buckets = Object.entries(
  snapshot.reduce((acc, r) => {
    const key = `${r.sourceType || "unknown"} | ${r.inningWindow} | ${r.market} | ${r.oddsTier}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})
).map(([bucket, count]) => ({ bucket, count }))
 .sort((a, b) => b.count - a.count);

console.log("MLB LIVE BOARD TRACKER");
console.log("----------------------");
console.log("date:", date);
console.log("input:", INPUT);
console.log("snapshot rows:", snapshot.length);
console.log("history rows:", merged.length);
console.table(buckets);
console.log("saved:", LATEST);
console.log("saved:", HISTORY);
