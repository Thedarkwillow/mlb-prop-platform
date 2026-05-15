const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const DATE = new Date().toISOString().slice(0, 10);
const timestamp = new Date().toISOString();

const sources = [
  "data/vegas-consensus.json",
  "outputs/sportsbook-enriched-board.json",
  "outputs/slips-priced.json",
  "outputs/priced-board.json"
];

let rows = [];

for (const file of sources) {
  const data = readJson(file, null);
  if (!data) continue;

  const arr = Array.isArray(data)
    ? data
    : data.rows || data.props || data.lines || data.markets || [];

  if (!Array.isArray(arr)) continue;

  for (const r of arr) {
    const player = r.player || r.name || r.playerName;
    const market = r.market || r.stat || r.projectionType;
    const line = r.bookLine ?? r.sportsbookLine ?? r.line;
    const odds = r.odds ?? r.price ?? r.bookOdds ?? r.consensusOdds;
    const book = r.book || r.sportsbook || r.source || r.provider || "consensus";

    if (!player || !market) continue;

    rows.push({
      date: DATE,
      timestamp,
      sourceFile: file,
      player,
      team: r.team || r.resolvedTeam || null,
      opponent: r.opponent || null,
      game: r.game || null,
      market,
      side: r.side || r.recommendedSide || null,
      prizepicksLine: r.line ?? r.ppLine ?? null,
      bookLine: line ?? null,
      odds: odds ?? null,
      book,
      books: r.books ?? r.sportsbookBookCount ?? null,
      edge: r.edge ?? r.sportsbookEdge ?? null,
      adjustedEdge: r.adjustedEdge ?? r.sportsbookAdjustedEdge ?? null
    });
  }
}

const outFile = "data/history/vegas-lines.json";
const existing = readJson(outFile, []);

const seen = new Set();
const combined = [...existing, ...rows].filter(r => {
  const key = [
    r.timestamp,
    r.sourceFile,
    r.player,
    r.market,
    r.side,
    r.prizepicksLine,
    r.bookLine,
    r.book
  ].join("|");

  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

writeJson(outFile, combined);

console.log("Vegas history rows added:", rows.length);
console.log("Vegas history total rows:", combined.length);
console.log("Wrote", outFile);
