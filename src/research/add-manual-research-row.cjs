const fs = require("fs");
const path = require("path");

const ledgerFile = "data/manual/manual-research-ledger.json";

function usage() {
  console.error(`
Usage:
  npm run manual:add -- --date=YYYY-MM-DD --player="Player Name" --team=TEAM --market=market --side=MORE --line=0.5 --tier=standard --result=PENDING --actual= --played=true --notes="why you liked it"

Example:
  npm run manual:add -- --date=2026-05-30 --player="Juan Soto" --team=NYM --market=total_bases --side=MORE --line=0.5 --tier=goblin --result=PENDING --played=true --notes="elite bat, low TB goblin"
`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) out[arg.slice(2)] = true;
    else out[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return out;
}

function readJson(file, fallback = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function bool(v) {
  return String(v).toLowerCase() === "true" || v === true || v === "1";
}

function key(row) {
  return [
    row.date,
    String(row.player).toLowerCase(),
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

const a = parseArgs(process.argv.slice(2));
if (!a.date || !a.player || !a.market || !a.side || a.line === undefined) usage();

const row = {
  date: String(a.date).trim(),
  player: String(a.player).trim(),
  team: String(a.team || "").trim(),
  market: String(a.market).trim(),
  side: String(a.side).trim().toUpperCase(),
  line: n(a.line),
  tier: String(a.tier || "standard").trim().toLowerCase(),
  result: String(a.result || "PENDING").trim().toUpperCase(),
  actual: n(a.actual),
  played: bool(a.played ?? true),
  source: String(a.source || "manual_research").trim(),
  notes: String(a.notes || "").trim()
};

const ledger = readJson(ledgerFile, []);
const seen = new Set(ledger.map(key));
if (seen.has(key(row))) {
  console.log("Skipped duplicate manual row:");
  console.log(row);
  process.exit(0);
}

ledger.push(row);
writeJson(ledgerFile, ledger);

console.log("Added manual research row:");
console.log(row);
console.log(`saved: ${ledgerFile}`);
