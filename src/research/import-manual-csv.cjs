const fs = require("fs");
const path = require("path");

const csvFile = process.argv[2] || "data/manual/manual-entry.csv";
const ledgerFile = "data/manual/manual-research-ledger.json";

function readJson(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && quoted && next === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out.map(v => v.trim());
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function bool(v) {
  return String(v ?? "true").toLowerCase() !== "false";
}

function clean(row) {
  return {
    date: String(row.date || "").trim(),
    player: String(row.player || "").trim(),
    team: String(row.team || "").trim(),
    market: String(row.market || "").trim(),
    side: String(row.side || "").trim().toUpperCase(),
    line: n(row.line),
    tier: String(row.tier || "standard").trim().toLowerCase(),
    result: String(row.result || "PENDING").trim().toUpperCase(),
    actual: n(row.actual),
    played: bool(row.played),
    source: "manual_research",
    notes: String(row.notes || "").trim()
  };
}

function key(row) {
  return [
    row.date,
    row.player.toLowerCase(),
    row.team,
    row.market,
    row.side,
    row.line,
    row.tier,
    row.result,
    row.actual,
    row.notes
  ].join("|");
}

if (!fs.existsSync(csvFile)) {
  console.error(`Missing CSV file: ${csvFile}`);
  process.exit(1);
}

const text = fs.readFileSync(csvFile, "utf8").trim();
if (!text) {
  console.error(`CSV file is empty: ${csvFile}`);
  process.exit(1);
}

const lines = text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#"));
const headers = parseCsvLine(lines[0]).map(h => h.trim());

const incoming = lines.slice(1).map(line => {
  const values = parseCsvLine(line);
  const raw = {};
  headers.forEach((h, i) => raw[h] = values[i] ?? "");
  return clean(raw);
}).filter(r => r.date && r.player && r.market && r.side && r.line !== null);

const ledger = readJson(ledgerFile, []).map(clean);
const seen = new Set(ledger.map(key));

let added = 0;
let skipped = 0;

for (const row of incoming) {
  const k = key(row);
  if (seen.has(k)) {
    skipped++;
    continue;
  }
  ledger.push(row);
  seen.add(k);
  added++;
}

ledger.sort((a, b) =>
  String(a.date).localeCompare(String(b.date)) ||
  String(a.market).localeCompare(String(b.market)) ||
  String(a.player).localeCompare(String(b.player))
);

writeJson(ledgerFile, ledger);

console.log({
  csvFile,
  incoming: incoming.length,
  added,
  skipped,
  total: ledger.length,
  ledgerFile
});
