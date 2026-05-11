const fs = require("fs");
const path = require("path");

const INPUT = process.argv[2] || "data/context/imports/umpire-scorecards.csv";
const OUTPUT = "data/context/umpires.json";
const SEASON_START = `${new Date().getFullYear()}-03-01`;

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function parseCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines.shift().split(",");
  return lines.map(line => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
}

function rowsFromInput(text) {
  const t = String(text || "").trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.umpires)) return parsed.umpires;
    if (Array.isArray(parsed.results)) return parsed.results;
    return [];
  }
  return parseCsv(t);
}

if (!fs.existsSync(INPUT)) {
  fs.mkdirSync(path.dirname(INPUT), { recursive: true });
  fs.writeFileSync(INPUT, "umpire,date,home_team,away_team,accuracy_above_x,overall_accuracy,consistency,total_run_impact,favor,called_pitches\n");
  write(OUTPUT, { games: {}, umpires: {}, source: INPUT, updatedAt: new Date().toISOString() });
  console.log(`Missing ${INPUT}; created template and empty ${OUTPUT}`);
  process.exit(0);
}

const rows = rowsFromInput(fs.readFileSync(INPUT, "utf8"))
  .filter(r => !r.date || String(r.date) >= SEASON_START);

function avg(values) {
  const clean = values.map(num).filter(v => v !== null);
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function sum(values) {
  const clean = values.map(num).filter(v => v !== null);
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0);
}

const grouped = new Map();

for (const r of rows) {
  const umpire = r.umpire || r.name || r.Umpire;
  if (!umpire) continue;
  const key = norm(umpire);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(r);
}

const out = {
  games: {},
  umpires: {},
  source: INPUT,
  seasonStart: SEASON_START,
  updatedAt: new Date().toISOString()
};

for (const [key, group] of grouped.entries()) {
  const first = group[0] || {};
  const umpire = first.umpire || first.name || first.Umpire;

  const accuracyAboveX = avg(group.map(r => r.accuracy_above_x_wmean ?? r.accuracy_above_x));
  const weightedScore = avg(group.map(r => r.weighted_score));
  const runImpact = avg(group.map(r => r.total_run_impact_mean ?? r.total_run_impact));
  const overallAccuracy = avg(group.map(r => r.overall_accuracy_wmean ?? r.overall_accuracy));
  const consistency = avg(group.map(r => r.consistency_wmean ?? r.consistency));
  const favorAbs = avg(group.map(r => r.favor_abs_mean ?? (r.favor != null ? Math.abs(Number(r.favor)) : null)));
  const calledPitches = sum(group.map(r => r.called_pitches_sum ?? r.called_pitches));

  let kFactor = 0;
  if (accuracyAboveX !== null) {
    if (accuracyAboveX >= 1.0) kFactor = 0.04;
    else if (accuracyAboveX >= 0.5) kFactor = 0.025;
    else if (accuracyAboveX <= -1.0) kFactor = -0.04;
    else if (accuracyAboveX <= -0.5) kFactor = -0.025;
  }

  out.umpires[key] = {
    umpire,
    kFactor,
    kBoost: kFactor > 0,
    kDowngrade: kFactor < 0,
    accuracyAboveX,
    overallAccuracy,
    consistency,
    runImpact,
    favorAbs,
    weightedScore,
    sampleGames: group.length,
    calledPitches
  };
}

for (const r of rows) {
  const home = r.home_team || r.homeTeam || r.home;
  const away = r.away_team || r.awayTeam || r.away;
  const umpire = r.umpire || r.name || r.Umpire;
  if (!home || !away || !umpire) continue;

  const gameKey = norm(`${away} @ ${home}`);
  const ump = out.umpires[norm(umpire)];
  if (ump) out.games[gameKey] = { ...ump, home, away };
}

write(OUTPUT, out);

console.log("UMPIRE STRIKE-ZONE IMPORT");
console.log("=========================");
console.log(`Input: ${INPUT}`);
console.log(`Season start: ${SEASON_START}`);
console.log(`Rows used: ${rows.length}`);
console.log(`Games mapped: ${Object.keys(out.games).length}`);
console.log(`Umpires mapped: ${Object.keys(out.umpires).length}`);
console.log(`Wrote ${OUTPUT}`);
