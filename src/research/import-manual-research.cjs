const fs = require("fs");
const path = require("path");

const ledgerFile = "data/manual/manual-research-ledger.json";
const importFile = process.argv[2];

if (!importFile) {
  console.error("Usage: node src/research/import-manual-research.cjs <import-json>");
  process.exit(1);
}

function readJson(file, fallback = []) {
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

function clean(row) {
  return {
    date: String(row.date || "").trim(),
    player: String(row.player || "").trim(),
    team: String(row.team || "").trim(),
    market: String(row.market || "").trim(),
    side: String(row.side || "").trim().toUpperCase(),
    line: Number(row.line),
    tier: String(row.tier || "standard").trim().toLowerCase(),
    result: String(row.result || "PENDING").trim().toUpperCase(),
    actual: row.actual === null || row.actual === undefined || row.actual === "" ? null : Number(row.actual),
    played: Boolean(row.played),
    source: String(row.source || "manual_research").trim(),
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

const ledger = readJson(ledgerFile, []).map(clean);
const incoming = readJson(importFile, []).map(clean);

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
  importFile,
  existing: ledger.length - added,
  incoming: incoming.length,
  added,
  skipped,
  total: ledger.length,
  ledgerFile
});
