const fs = require("fs");
const path = require("path");

const INPUT = process.argv[2] || "data/context/imports/umpires.csv";
const OUTPUT = "data/context/umpires.json";

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && q && n === '"') { cur += '"'; i++; continue; }
    if (c === '"') { q = !q; continue; }
    if (c === "," && !q) { row.push(cur); cur = ""; continue; }
    if ((c === "\n" || c === "\r") && !q) {
      if (cur || row.length) { row.push(cur); rows.push(row); }
      cur = ""; row = [];
      if (c === "\r" && n === "\n") i++;
      continue;
    }
    cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function num(v) {
  const n = Number(String(v ?? "").replace(/[%+,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

if (!fs.existsSync(INPUT)) {
  fs.mkdirSync(path.dirname(INPUT), { recursive: true });
  fs.writeFileSync(INPUT, "game,home,away,umpire,kFactor,zoneType\n", "utf8");
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify({ games: {}, source: INPUT, note: "empty import template created" }, null, 2) + "\n");
  console.log(`Missing ${INPUT}; created template and empty ${OUTPUT}`);
  process.exit(0);
}

const parsed = parseCsv(fs.readFileSync(INPUT, "utf8")).filter(r => r.some(x => String(x).trim()));
const headers = parsed.shift().map(h => norm(h));
const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

function get(row, names) {
  for (const name of names) {
    const k = norm(name);
    if (idx[k] != null) return row[idx[k]];
  }
  return "";
}

const games = {};

for (const row of parsed) {
  const game = get(row, ["game", "matchup"]);
  const home = get(row, ["home", "homeTeam"]);
  const away = get(row, ["away", "awayTeam"]);
  const key = norm(game || `${away} @ ${home}`);
  if (!key) continue;

  const kFactor = num(get(row, ["kFactor", "k factor", "strikeZoneFactor", "kBoost"]));
  const zoneType = String(get(row, ["zoneType", "zone", "profile"]) || "").toUpperCase();

  games[key] = {
    game: game || `${away} @ ${home}`,
    home,
    away,
    umpire: get(row, ["umpire", "plateUmpire", "name"]),
    kFactor,
    kBoost: zoneType === "K_BOOST" || zoneType === "PITCHER" || (kFactor != null && kFactor > 0.03),
    kDowngrade: zoneType === "K_DOWNGRADE" || zoneType === "HITTER" || (kFactor != null && kFactor < -0.03),
    zoneType,
    source: INPUT
  };
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify({ games, updatedAt: new Date().toISOString(), source: INPUT }, null, 2) + "\n");

console.log("UMPIRE IMPORT");
console.log("=============");
console.log(`Input: ${INPUT}`);
console.log(`Games mapped: ${Object.keys(games).length}`);
console.log(`Wrote ${OUTPUT}`);
