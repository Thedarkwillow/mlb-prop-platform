const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = "data/prizepicks-raw-latest.json";
const OUT = `outputs/live/live-in-game-detector-${date}.json`;
const LATEST = "outputs/live/live-in-game-detector-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

const raw = read(INPUT, null);

if (!raw || !Array.isArray(raw.data)) {
  console.error(`Missing or invalid ${INPUT}`);
  process.exit(1);
}

const rows = raw.data.map(item => {
  const a = item.attributes || {};
  return {
    id: item.id,
    stat_type: a.stat_type,
    stat_display_name: a.stat_display_name,
    line_score: a.line_score,
    description: a.description,
    start_time: a.start_time,
    game_id: a.game_id,
    projection_type: a.projection_type,
    event_type: a.event_type,
    in_game: a.in_game,
    is_live: a.is_live,
    is_live_scored: a.is_live_scored,
    status: a.status,
    updated_at: a.updated_at
  };
});

const liveRows = rows.filter(r =>
  r.is_live === true ||
  r.in_game === true ||
  (r.status && r.status !== "pre_game")
);

const marketCounts = {};
for (const r of liveRows) {
  const k = `${r.status || "unknown"} | ${r.stat_display_name || r.stat_type || "unknown"}`;
  marketCounts[k] = (marketCounts[k] || 0) + 1;
}

const report = {
  date,
  generatedAt: new Date().toISOString(),
  totalRows: rows.length,
  liveRows: liveRows.length,
  hasActualInGameProps: liveRows.length > 0,
  marketCounts: Object.entries(marketCounts)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count),
  examples: liveRows.slice(0, 100)
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
fs.writeFileSync(LATEST, JSON.stringify(report, null, 2));

console.log("MLB TRUE IN-GAME PROP DETECTOR");
console.log("------------------------------");
console.log("date:", date);
console.log("total rows:", rows.length);
console.log("true in-game/live rows:", liveRows.length);
console.log("has actual in-game props:", liveRows.length > 0);
console.table(report.marketCounts);
console.log("saved:", OUT);
console.log("saved:", LATEST);
