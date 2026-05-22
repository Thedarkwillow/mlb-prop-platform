const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);
const DIR = `data/odds-history/${DATE}`;
const PICK_FILES = [
  `outputs/final-slips-${DATE}.json`,
  "outputs/final-slips.json",
  "outputs/playable-final-slips.json",
  "outputs/official-slip.json"
];

function read(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); } catch { return fallback; }
}
function norm(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function marketKey(x) {
  const m = norm(x.market).replace(/\s+/g, "_");
  const raw = norm(x.rawMarket).replace(/\s+/g, "_");
  if (m === "hits" && raw.includes("pitcher")) return "hits_allowed";
  if (m === "hits" && String(x.player || "").match(/Rodon|Rodón|Strider|Soriano|Mize|Severino|Ashcraft|Cantillo|Peterson/i)) return "hits_allowed";
  return m;
}

function key(x) {
  return [norm(x.player), marketKey(x), norm(x.side), String(Number(x.line))].join("|");
}
function americanToCents(o) {
  o = Number(o);
  if (!Number.isFinite(o)) return null;
  return o;
}

if (!fs.existsSync(DIR)) {
  console.log(`No odds history found for ${DATE}. Run: npm run snap --date=${DATE}`);
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
    byKey.get(k).push(r);
  }
}

let slips = [];
let pickSource = null;

for (const f of PICK_FILES) {
  const data = read(f, null);
  if (!data) continue;

  if (Array.isArray(data)) {
    slips = data;
  } else if (Array.isArray(data.slips)) {
    slips = data.slips;
  } else if (Array.isArray(data.playableSlips)) {
    slips = data.playableSlips;
  }

  if (slips.length) {
    pickSource = f;
    break;
  }
}

const allLegs = slips.flatMap(s => s.legs || []);
const seenLegs = new Set();
const legs = [];
for (const l of allLegs) {
  const k = [l.player, l.market, l.side, l.line].join("|").toLowerCase();
  if (seenLegs.has(k)) continue;
  seenLegs.add(k);
  legs.push(l);
}

const report = [];
for (const l of legs) {
  const rows = byKey.get(key(l)) || [];
  if (!rows.length) continue;

  rows.sort((a,b) => String(a.snapshotTime).localeCompare(String(b.snapshotTime)));
  const open = rows[0];
  const close = rows[rows.length - 1];

  const openOdds = americanToCents(open.odds);
  const closeOdds = americanToCents(close.odds);
  const betOdds = closeOdds;

  const clv = openOdds != null && closeOdds != null ? closeOdds - openOdds : null;

  report.push({
    player: l.player,
    market: l.market,
    side: l.side,
    line: l.line,
    books: l.books,
    openOdds,
    betOdds,
    closeOdds,
    clv,
    beatClose: clv != null ? clv > 0 : null
  });
}

const valid = report.filter(x => x.clv != null);
console.log(`CLV REPORT ${DATE}`);
console.log(`pick source: ${pickSource || "NONE"}`);
console.log(`tracked legs: ${valid.length}`);
if (!valid.length) process.exit(0);

const avg = valid.reduce((a,x) => a + x.clv, 0) / valid.length;
const beat = valid.filter(x => x.beatClose).length / valid.length;

console.log(`Average CLV: ${avg.toFixed(2)} cents`);
console.log(`Beat close: ${(beat * 100).toFixed(1)}%`);

console.table(valid.map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  books: x.books,
  open: x.openOdds,
  close: x.closeOdds,
  clv: x.clv,
  beatClose: x.beatClose
})));

fs.writeFileSync(`outputs/clv-report-${DATE}.json`, JSON.stringify(valid, null, 2));
