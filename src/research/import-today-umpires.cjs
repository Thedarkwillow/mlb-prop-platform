const fs = require("fs");
const path = require("path");

const INPUT = "data/context/imports/today-umpires.csv";
const UMPIRES = "data/context/umpires.json";
const DATE = process.argv[2] || process.env.npm_config_date || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamAlias(s) {
  const x = String(s || "").trim().toUpperCase();
  const map = {
    "ARIZONA DIAMONDBACKS": "AZ",
    "DIAMONDBACKS": "AZ",
    "ARI": "AZ",
    "ATLANTA BRAVES": "ATL",
    "BRAVES": "ATL",
    "BALTIMORE ORIOLES": "BAL",
    "ORIOLES": "BAL",
    "BOSTON RED SOX": "BOS",
    "RED SOX": "BOS",
    "CHICAGO CUBS": "CHC",
    "CUBS": "CHC",
    "CHICAGO WHITE SOX": "CWS",
    "WHITE SOX": "CWS",
    "CHW": "CWS",
    "CINCINNATI REDS": "CIN",
    "REDS": "CIN",
    "CLEVELAND GUARDIANS": "CLE",
    "GUARDIANS": "CLE",
    "COLORADO ROCKIES": "COL",
    "ROCKIES": "COL",
    "DETROIT TIGERS": "DET",
    "TIGERS": "DET",
    "HOUSTON ASTROS": "HOU",
    "ASTROS": "HOU",
    "KANSAS CITY ROYALS": "KC",
    "ROYALS": "KC",
    "KCR": "KC",
    "LOS ANGELES ANGELS": "LAA",
    "ANGELS": "LAA",
    "LOS ANGELES DODGERS": "LAD",
    "DODGERS": "LAD",
    "MIAMI MARLINS": "MIA",
    "MARLINS": "MIA",
    "MILWAUKEE BREWERS": "MIL",
    "BREWERS": "MIL",
    "MINNESOTA TWINS": "MIN",
    "TWINS": "MIN",
    "NEW YORK METS": "NYM",
    "METS": "NYM",
    "NEW YORK YANKEES": "NYY",
    "YANKEES": "NYY",
    "ATHLETICS": "ATH",
    "OAKLAND ATHLETICS": "ATH",
    "OAK": "ATH",
    "PHILADELPHIA PHILLIES": "PHI",
    "PHILLIES": "PHI",
    "PITTSBURGH PIRATES": "PIT",
    "PIRATES": "PIT",
    "SAN DIEGO PADRES": "SD",
    "PADRES": "SD",
    "SDP": "SD",
    "SAN FRANCISCO GIANTS": "SF",
    "GIANTS": "SF",
    "SFG": "SF",
    "SEATTLE MARINERS": "SEA",
    "MARINERS": "SEA",
    "ST. LOUIS CARDINALS": "STL",
    "SAINT LOUIS CARDINALS": "STL",
    "CARDINALS": "STL",
    "TAMPA BAY RAYS": "TB",
    "RAYS": "TB",
    "TBR": "TB",
    "TEXAS RANGERS": "TEX",
    "RANGERS": "TEX",
    "TORONTO BLUE JAYS": "TOR",
    "BLUE JAYS": "TOR",
    "WASHINGTON NATIONALS": "WSH",
    "NATIONALS": "WSH",
    "WAS": "WSH",
    "WSN": "WSH"
  };
  return map[x] || x;
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
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function gameKeys(away, home) {
  const out = new Set();
  if (away && home) out.add(norm(`${away} @ ${home}`));
  const a = teamAlias(away);
  const h = teamAlias(home);
  if (a && h) out.add(norm(`${a} @ ${h}`));
  return [...out].filter(Boolean);
}

if (!fs.existsSync(INPUT)) {
  fs.mkdirSync(path.dirname(INPUT), { recursive: true });
  fs.writeFileSync(INPUT, "date,away,home,umpire,status\n");
}

const data = readJson(UMPIRES, { games: {}, umpires: {} });
data.games = data.games || {};
data.umpires = data.umpires || {};

const rows = parseCsv(fs.readFileSync(INPUT, "utf8"))
  .filter(r => !r.date || r.date === DATE);

let mapped = 0;
let keysWritten = 0;

for (const r of rows) {
  if (!r.away || !r.home || !r.umpire) continue;

  const profile = data.umpires[norm(r.umpire)] || {
    umpire: r.umpire,
    kFactor: 0,
    kBoost: false,
    kDowngrade: false
  };

  const assignment = {
    ...profile,
    away: teamAlias(r.away),
    home: teamAlias(r.home),
    rawAway: r.away,
    rawHome: r.home,
    umpire: r.umpire,
    assignmentStatus: r.status || "confirmed",
    assignmentDate: DATE,
    source: "TODAY_UMPIRE_ASSIGNMENT",
    input: INPUT
  };

  for (const key of gameKeys(r.away, r.home)) {
    data.games[key] = assignment;
    keysWritten++;
  }

  mapped++;
}

data.date = DATE;
data.source = "today_umpire_assignments";
data.todayAssignments = {
  date: DATE,
  input: INPUT,
  mapped,
  keysWritten,
  updatedAt: new Date().toISOString()
};

writeJson(UMPIRES, data);

console.log("TODAY UMPIRE ASSIGNMENTS");
console.log("========================");
console.log(`Date: ${DATE}`);
console.log(`Mapped rows: ${mapped}`);
console.log(`Game keys written: ${keysWritten}`);
console.log(`Wrote ${UMPIRES}`);
