const fs = require("fs");
const path = require("path");

const csvFile = process.argv[2] || "data/manual/manual-entry.csv";
const ledgerFile = "data/manual/manual-research-ledger.json";

const EXTRA_FIELDS = [
  "last5HitRate",
  "last5Avg",
  "last10HitRate",
  "last10Avg",
  "last15HitRate",
  "last15Avg",
  "seasonHitRate",
  "seasonAvg",
  "homeAwaySplit",
  "homeAwayHitRate",
  "homeAwayAvg",
  "pitcherHand",
  "handednessHitRate",
  "handednessAvg",
  "homeAwayHandHitRate",
  "homeAwayHandAvg",
  "vsPitcherHitRate",
  "vsPitcherAvg",
  "vsPitcherSample",
  "vsPitcherNotes"
];

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
  const x = Number(String(v).replace("%", ""));
  if (!Number.isFinite(x)) return null;
  return x;
}

function pct(v) {
  const x = n(v);
  if (x === null) return null;
  return x > 1 ? +(x / 100).toFixed(4) : x;
}

function bool(v) {
  return String(v ?? "true").toLowerCase() !== "false";
}

function clean(row) {
  const out = {
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
    source: String(row.source || "manual_research").trim(),
    notes: String(row.notes || "").trim()
  };

  for (const f of EXTRA_FIELDS) {
    if (!(f in row)) continue;

    if (f.toLowerCase().includes("hitrate")) out[f] = pct(row[f]);
    else if (f.toLowerCase().includes("avg")) out[f] = n(row[f]);
    else if (f.toLowerCase().includes("sample")) out[f] = n(row[f]);
    else out[f] = String(row[f] || "").trim();
  }

  return out;
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

const lines = text
  .split(/\r?\n/)
  .filter(line => line.trim() && !line.trim().startsWith("#"));

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
let updated = 0;
let skipped = 0;

for (const row of incoming) {
  const k = key(row);
  const idx = ledger.findIndex(existing => key(existing) === k);

  if (idx >= 0) {
    const before = JSON.stringify(ledger[idx]);
    ledger[idx] = { ...ledger[idx], ...row };
    const after = JSON.stringify(ledger[idx]);
    if (before !== after) updated++;
    else skipped++;
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
  updated,
  skipped,
  total: ledger.length,
  ledgerFile
});
