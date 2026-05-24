const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = "data/prizepicks-raw-latest.json";
const OUT = `outputs/live/mlb-live-micro-discovery-${date}.json`;
const LATEST = "outputs/live/mlb-live-micro-discovery-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function norm(x) {
  return String(x || "").trim();
}

function looksMicro(a) {
  const stat = `${a.stat_type || ""} ${a.stat_display_name || ""}`.toLowerCase();
  return (
    stat.includes("inning") ||
    stat.includes("1st") ||
    stat.includes("2nd") ||
    stat.includes("3rd") ||
    stat.includes("4th") ||
    stat.includes("5th") ||
    stat.includes("1-2") ||
    stat.includes("1-3") ||
    stat.includes("pitcher strikeouts") ||
    stat.includes("runs allowed") ||
    stat.includes("walks allowed")
  );
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
    event_type: a.event_type,
    stat_type: a.stat_type,
    stat_display_name: a.stat_display_name,
    line_score: a.line_score,
    description: a.description,
    odds_type: a.odds_type,
    status: a.status,
    is_live: a.is_live,
    in_game: a.in_game,
    is_live_scored: a.is_live_scored,
    projection_type: a.projection_type,
    start_time: a.start_time,
    game_id: a.game_id,
    group_key: a.group_key
  };
});

const microRows = rows.filter(r => looksMicro({
  stat_type: r.stat_type,
  stat_display_name: r.stat_display_name
}));

function groupBy(arr, fn) {
  const m = new Map();
  for (const r of arr) {
    const k = fn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()].map(([key, rows]) => ({ key, count: rows.length, examples: rows.slice(0, 10) }));
}

const report = {
  date,
  generatedAt: new Date().toISOString(),
  rawRows: rows.length,
  liveFlags: {
    is_live_true: rows.filter(r => r.is_live === true).length,
    in_game_true: rows.filter(r => r.in_game === true).length,
    non_pregame: rows.filter(r => r.status !== "pre_game").length
  },
  eventTypeCounts: groupBy(rows, r => norm(r.event_type)).map(x => ({ key: x.key, count: x.count })),
  microRows: microRows.length,
  microByStat: groupBy(microRows, r => `${norm(r.event_type)} | ${norm(r.stat_type)} | ${norm(r.stat_display_name)}`),
  comboByStat: groupBy(rows.filter(r => r.event_type === "combo"), r => `${norm(r.stat_type)} | ${norm(r.stat_display_name)}`),
  teamByStat: groupBy(rows.filter(r => r.event_type === "team"), r => `${norm(r.stat_type)} | ${norm(r.stat_display_name)}`),
  allStatTypes: groupBy(rows, r => `${norm(r.event_type)} | ${norm(r.stat_type)} | ${norm(r.stat_display_name)}`)
    .map(x => ({ key: x.key, count: x.count }))
    .sort((a, b) => b.count - a.count)
};

write(OUT, report);
write(LATEST, report);

console.log("MLB LIVE/MICRO MARKET DISCOVERY");
console.log("--------------------------------");
console.log("date:", date);
console.log("raw rows:", rows.length);
console.log("micro rows:", microRows.length);
console.log("live flags:", report.liveFlags);
console.log("\nCombo markets:");
console.table(report.comboByStat.map(x => ({ market: x.key, count: x.count })).slice(0, 40));
console.log("\nMicro markets:");
console.table(report.microByStat.map(x => ({ market: x.key, count: x.count })).slice(0, 40));
console.log("saved:", OUT);
console.log("saved:", LATEST);
