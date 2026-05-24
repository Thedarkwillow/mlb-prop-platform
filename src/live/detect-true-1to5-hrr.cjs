const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const RAW = "data/prizepicks-raw-latest.json";
const OUT = `outputs/live/true-1to5-hrr-detector-${date}.json`;
const LATEST = "outputs/live/true-1to5-hrr-detector-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function text(x) {
  return String(x || "").toLowerCase();
}

function isHrr(a) {
  const t = `${a.stat_type || ""} ${a.stat_display_name || ""}`.toLowerCase();
  return (
    t.includes("hits+runs+rbis") ||
    t.includes("hits + runs + rbis") ||
    t.includes("hrr")
  );
}

function isTrue1to5(item, duration) {
  const a = item.attributes || {};
  const allText = JSON.stringify({
    stat_type: a.stat_type,
    stat_display_name: a.stat_display_name,
    description: a.description,
    group_key: a.group_key,
    projection_type: a.projection_type,
    duration,
    metadata: a.metadata
  }).toLowerCase();

  return (
    allText.includes("1+2+3+4+5") ||
    allText.includes("1-5") ||
    allText.includes("1 to 5") ||
    allText.includes("first 5") ||
    allText.includes("first five") ||
    allText.includes("innings 1") && allText.includes("5")
  );
}

const raw = read(RAW, null);
if (!raw || !Array.isArray(raw.data)) {
  console.error(`Missing or invalid ${RAW}`);
  process.exit(1);
}

const durations = new Map();
for (const inc of raw.included || []) {
  if (inc.type === "duration") durations.set(String(inc.id), inc.attributes || {});
}

const players = new Map();
for (const inc of raw.included || []) {
  if (inc.type === "new_player") players.set(String(inc.id), inc.attributes || {});
}

const hrrRows = [];
const true1to5 = [];
const fullOnly = [];

for (const item of raw.data) {
  const a = item.attributes || {};
  if (!isHrr(a)) continue;

  const durationId = String(item.relationships?.duration?.data?.id || "");
  const duration = durations.get(durationId) || {};
  const playerId = String(item.relationships?.new_player?.data?.id || "");
  const player = players.get(playerId) || {};

  const row = {
    id: item.id,
    player: player.display_name || player.name || null,
    team: player.team || a.description || null,
    stat_type: a.stat_type,
    stat_display_name: a.stat_display_name,
    line_score: a.line_score,
    odds_type: a.odds_type,
    event_type: a.event_type,
    status: a.status,
    game_id: a.game_id,
    group_key: a.group_key,
    durationId,
    durationName: duration.name || null,
    apiConfirms1to5: isTrue1to5(item, duration)
  };

  hrrRows.push(row);
  if (row.apiConfirms1to5) true1to5.push(row);
  else if (String(row.durationName || "").toLowerCase() === "full") fullOnly.push(row);
}

const byDuration = Object.entries(
  hrrRows.reduce((acc, r) => {
    const key = `${r.durationId || "none"} | ${r.durationName || "none"}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})
).map(([duration, count]) => ({ duration, count }))
 .sort((a, b) => b.count - a.count);

const byTier = Object.entries(
  hrrRows.reduce((acc, r) => {
    const key = r.odds_type || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})
).map(([tier, count]) => ({ tier, count }))
 .sort((a, b) => b.count - a.count);

const report = {
  date,
  generatedAt: new Date().toISOString(),
  rawRows: raw.data.length,
  hrrRows: hrrRows.length,
  true1to5Rows: true1to5.length,
  fullOnlyRows: fullOnly.length,
  apiConfirmsTrue1to5: true1to5.length > 0,
  conclusion: true1to5.length > 0
    ? "API contains confirmed true 1-5 HRR rows."
    : "API currently exposes HRR as Full duration only. Do not label as true 1-5.",
  byDuration,
  byTier,
  true1to5,
  fullOnlySample: fullOnly.slice(0, 50),
  allHrrSample: hrrRows.slice(0, 50)
};

write(OUT, report);
write(LATEST, report);

console.log("TRUE 1-5 HRR DETECTOR");
console.log("---------------------");
console.log("date:", date);
console.log("raw rows:", raw.data.length);
console.log("HRR rows:", hrrRows.length);
console.log("true 1-5 HRR rows:", true1to5.length);
console.log("full-only HRR rows:", fullOnly.length);
console.table(byDuration);
console.table(byTier);
console.log("conclusion:", report.conclusion);
console.log("saved:", OUT);
console.log("saved:", LATEST);
