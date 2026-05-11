const fs = require("fs");
const path = require("path");

const INPUT = process.argv[2] || "data/context/imports/catcher-framing.csv";
const OUTPUT = "data/context/catcher-framing.json";

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
  fs.writeFileSync(INPUT, "catcher,team,framingRuns,strikeRate\n", "utf8");
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify({ catchers: {}, teams: {}, source: INPUT, note: "empty import template created" }, null, 2) + "\n");
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

const catchers = {};
const teams = {};

for (const row of parsed) {
  const catcher = get(row, ["catcher", "player", "name"]);
  if (!catcher) continue;

  const team = String(get(row, ["team", "squad"]) || "").toUpperCase();
  const framingRuns = num(get(row, ["framingRuns", "framing runs", "catcher framing runs", "runs from extra strikes"]));
  const strikeRate = num(get(row, ["strikeRate", "strike rate", "called strike rate"]));

  let framing = "NEUTRAL";
  if (framingRuns != null && framingRuns > 3) framing = "PLUS";
  if (framingRuns != null && framingRuns < -3) framing = "MINUS";

  const item = {
    catcher,
    team,
    framing,
    framingRuns,
    strikeRate,
    source: INPUT
  };

  catchers[norm(catcher)] = item;
  if (team) teams[team] = item;
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify({ catchers, teams, updatedAt: new Date().toISOString(), source: INPUT }, null, 2) + "\n");

console.log("CATCHER FRAMING IMPORT");
console.log("======================");
console.log(`Input: ${INPUT}`);
console.log(`Catchers: ${Object.keys(catchers).length}`);
console.log(`Teams mapped: ${Object.keys(teams).length}`);
console.log(`Wrote ${OUTPUT}`);
