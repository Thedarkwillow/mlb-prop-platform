const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const RAW = "data/prizepicks-raw-latest.json";
const OUT = `outputs/team-picks/game-lines-detector-${date}.json`;
const LATEST = "outputs/team-picks/game-lines-detector-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function textOf(item) {
  const a = item.attributes || {};
  return [
    item.type,
    item.id,
    a.stat_type,
    a.stat_display_name,
    a.description,
    a.projection_type,
    a.event_type,
    a.odds_type,
    a.status,
    a.game_id,
    a.group_key
  ].map(x => String(x || "")).join(" ").toLowerCase();
}

function isGameLine(item) {
  const a = item.attributes || {};
  const stat = String(a.stat_type || a.stat_display_name || "").toLowerCase();
  const group = String(a.group_key || "").toLowerCase();
  const odds = String(a.odds_type || "").toLowerCase();
  const event = String(a.event_type || "").toLowerCase();
  const proj = String(a.projection_type || "").toLowerCase();

  // Exclude team/player stat props that are not game lines.
  const statPropTerms = [
    "total bases",
    "tb",
    "doubles",
    "hits",
    "runs",
    "rbis",
    "strikeouts",
    "fantasy",
    "walks",
    "stolen bases",
    "home runs"
  ];

  if (statPropTerms.includes(stat)) return false;

  const text = [stat, group, odds, event, proj].join(" ");

  return (
    /\bmoneyline\b/.test(text) ||
    /\bmoney line\b/.test(text) ||
    /\bspread\b/.test(text) ||
    /\brun line\b/.test(text) ||
    /\bgame total\b/.test(text) ||
    /\bgame lines\b/.test(text) ||
    /\bwinner\b/.test(text)
  );
}

function normalize(item) {
  const a = item.attributes || {};
  return {
    date,
    prizepicksId: item.id,
    type: item.type || null,
    statType: a.stat_type || null,
    statDisplayName: a.stat_display_name || null,
    description: a.description || null,
    line: a.line_score ?? null,
    projectionType: a.projection_type || null,
    eventType: a.event_type || null,
    oddsType: a.odds_type || null,
    adjustedOdds: a.adjusted_odds ?? null,
    startTime: a.start_time || null,
    gameId: a.game_id || null,
    status: a.status || null,
    groupKey: a.group_key || null,
    raw: item
  };
}

const raw = read(RAW, null);

if (!raw || !Array.isArray(raw.data)) {
  console.error(`Missing or invalid ${RAW}`);
  process.exit(1);
}

const rows = raw.data.filter(isGameLine).map(normalize);

const topTypes = {};
const topStats = {};
const topProjectionTypes = {};

for (const item of raw.data) {
  const a = item.attributes || {};
  topTypes[item.type || "unknown"] = (topTypes[item.type || "unknown"] || 0) + 1;
  topStats[a.stat_type || "unknown"] = (topStats[a.stat_type || "unknown"] || 0) + 1;
  topProjectionTypes[a.projection_type || "unknown"] = (topProjectionTypes[a.projection_type || "unknown"] || 0) + 1;
}

const report = {
  date,
  generatedAt: new Date().toISOString(),
  rawRows: raw.data.length,
  gameLineRows: rows.length,
  foundInCurrentPrizePicksRaw: rows.length > 0,
  topTypes: Object.entries(topTypes).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
  topStats: Object.entries(topStats).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 80),
  topProjectionTypes: Object.entries(topProjectionTypes).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
  examples: rows.slice(0, 100)
};

write(OUT, report);
write(LATEST, report);

console.log("PRIZEPICKS GAME LINES DETECTOR");
console.log("-------------------------------");
console.log("date:", date);
console.log("raw rows:", raw.data.length);
console.log("game line rows:", rows.length);
console.log("found in current raw:", rows.length > 0);
console.table(rows.slice(0, 30).map(r => ({
  id: r.prizepicksId,
  stat: r.statDisplayName || r.statType,
  desc: r.description,
  line: r.line,
  projectionType: r.projectionType,
  eventType: r.eventType,
  status: r.status
})));
console.log("saved:", OUT);
console.log("saved:", LATEST);
