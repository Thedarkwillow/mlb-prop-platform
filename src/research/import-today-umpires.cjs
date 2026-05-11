const fs = require("fs");
const path = require("path");

const INPUT = "data/context/imports/today-umpires.csv";
const UMPIRES = "data/context/umpires.json";
const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseCsv(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const header = lines.shift().split(",").map(x => x.trim());
  return lines.map(line => {
    const cells = line.split(",").map(x => x.trim());
    return Object.fromEntries(header.map((h, i) => [h, cells[i] || ""]));
  });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

if (!fs.existsSync(INPUT)) {
  fs.mkdirSync(path.dirname(INPUT), { recursive: true });
  fs.writeFileSync(INPUT, "date,away,home,umpire,status\n");
}

const data = readJson(UMPIRES, { games: {}, umpires: {} });
const rows = parseCsv(fs.readFileSync(INPUT, "utf8"))
  .filter(r => !r.date || r.date === DATE);

let mapped = 0;

for (const r of rows) {
  if (!r.away || !r.home || !r.umpire) continue;

  const gameKey = norm(`${r.away} @ ${r.home}`);
  const profile = data.umpires?.[norm(r.umpire)] || {
    umpire: r.umpire,
    kFactor: 0,
    kBoost: false,
    kDowngrade: false
  };

  data.games[gameKey] = {
    ...profile,
    away: r.away,
    home: r.home,
    assignmentStatus: r.status || "manual",
    assignmentDate: DATE
  };

  mapped++;
}

data.todayAssignments = {
  date: DATE,
  input: INPUT,
  mapped,
  updatedAt: new Date().toISOString()
};

writeJson(UMPIRES, data);

console.log("TODAY UMPIRE ASSIGNMENTS");
console.log("========================");
console.log(`Date: ${DATE}`);
console.log(`Mapped: ${mapped}`);
console.log(`Wrote ${UMPIRES}`);
