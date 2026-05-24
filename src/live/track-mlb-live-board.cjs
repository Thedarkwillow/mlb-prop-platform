const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const input = process.argv[3] || "outputs/mlb-live-board-raw.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function normMarket(x) {
  return String(x || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/pitcher_strikeouts|strikeouts|ks/g, "strikeouts")
    .replace(/pitches_thrown|pitch_count/g, "pitches_thrown")
    .replace(/outs_recorded|pitching_outs/g, "pitching_outs")
    .replace(/hits_allowed/g, "hits_allowed")
    .replace(/runs_allowed/g, "runs_allowed")
    .replace(/walks_allowed/g, "walks_allowed")
    .trim();
}

function inferInningWindow(r) {
  const raw = String(r.inningWindow || r.window || r.period || r.market || r.stat || "");
  const m = raw.match(/([1-5])(?:st|nd|rd|th)?\s*inning/i) || raw.match(/\b([1-5])\b/);
  return m ? Number(m[1]) : null;
}

function normalizeRow(r) {
  return {
    date,
    snapshotTime: new Date().toISOString(),
    source: "manual_or_raw_live_board",
    player: r.player || r.playerName || r.name || null,
    team: r.team || r.teamAbbr || null,
    game: r.game || r.matchup || null,
    gamePk: r.gamePk || r.resolvedGamePk || null,
    inningWindow: inferInningWindow(r),
    market: normMarket(r.market || r.stat || r.statType),
    side: String(r.side || r.recommendedSide || r.direction || "").toUpperCase() || null,
    line: Number.isFinite(Number(r.line)) ? Number(r.line) : null,
    oddsTier: r.oddsTier || r.tier || r.specialTier || "standard",
    raw: r
  };
}

const raw = read(input, []);
const rows = (Array.isArray(raw) ? raw : raw.rows || raw.data || [])
  .map(normalizeRow)
  .filter(r => r.player && r.market && Number.isFinite(r.line));

const latestPath = "outputs/live/mlb-live-board-latest.json";
const historyPath = "data/live/mlb-live-board-history.json";

const history = read(historyPath, []);
const updated = [...history, ...rows];

write(latestPath, rows);
write(historyPath, updated);

console.log("MLB LIVE BOARD TRACKER");
console.log("----------------------");
console.log("date:", date);
console.log("input:", input);
console.log("snapshot rows:", rows.length);
console.log("history rows:", updated.length);
console.table(
  Object.entries(rows.reduce((acc, r) => {
    const k = `${r.inningWindow || "live"} ${r.market}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {})).map(([bucket, count]) => ({ bucket, count }))
);
console.log("saved:", latestPath);
console.log("saved:", historyPath);
