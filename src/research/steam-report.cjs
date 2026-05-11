const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const DIR = `data/odds-history/${DATE}`;
const PICKS = "outputs/playable-final-slips.json";

function read(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function key(x) {
  return [norm(x.player), norm(x.market), norm(x.side), String(Number(x.line))].join("|");
}

function movementLabel(openOdds, closeOdds, side) {
  if (!Number.isFinite(openOdds) || !Number.isFinite(closeOdds)) return "UNKNOWN";
  const move = closeOdds - openOdds;
  if (Math.abs(move) < 5) return "STABLE";
  if (move > 0) return "STEAM_WITH_US";
  if (move < 0) return "STEAM_AGAINST_US";
  return "STABLE";
}

if (!fs.existsSync(DIR)) {
  console.log(`No odds history found for ${DATE}.`);
  process.exit(0);
}

const files = fs.readdirSync(DIR)
  .filter(f => f.startsWith("odds-snapshot-") && f.endsWith(".json"))
  .sort();

const byKey = new Map();

for (const f of files) {
  const rows = read(`${DIR}/${f}`, []);
  for (const r of rows) {
    const k = key(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ ...r, snapshotFile: f });
  }
}

const slips = read(PICKS, []);
const unique = new Map();

for (const l of slips.flatMap(s => s.legs || [])) {
  unique.set(key(l), l);
}

const report = [];

for (const [k, leg] of unique.entries()) {
  const rows = byKey.get(k) || [];
  if (!rows.length) continue;

  rows.sort((a, b) => String(a.snapshotTime || a.lastUpdate || a.snapshotFile).localeCompare(String(b.snapshotTime || b.lastUpdate || b.snapshotFile)));

  const open = rows[0];
  const close = rows[rows.length - 1];
  const openOdds = Number(open.odds);
  const closeOdds = Number(close.odds);
  const move = Number.isFinite(openOdds) && Number.isFinite(closeOdds) ? closeOdds - openOdds : null;

  report.push({
    player: leg.player,
    team: leg.team,
    game: leg.game,
    market: leg.market,
    side: leg.side,
    line: leg.line,
    openOdds,
    closeOdds,
    move,
    snapshots: rows.length,
    label: movementLabel(openOdds, closeOdds, leg.side)
  });
}

const counts = {};
for (const r of report) counts[r.label] = (counts[r.label] || 0) + 1;

fs.writeFileSync(`outputs/steam-report-${DATE}.json`, JSON.stringify(report, null, 2) + "\n");

console.log(`STEAM / LINE MOVEMENT REPORT ${DATE}`);
console.log("====================================");
console.log(`Tracked legs: ${report.length}`);
console.table(counts);
console.table(report.map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  open: x.openOdds,
  close: x.closeOdds,
  move: x.move,
  snapshots: x.snapshots,
  label: x.label
})));
console.log(`Wrote outputs/steam-report-${DATE}.json`);
