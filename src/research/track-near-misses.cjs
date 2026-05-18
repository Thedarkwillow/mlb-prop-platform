const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function key(r) {
  return [r.date, r.player, r.market, r.side, r.line].join("|");
}

function isTrackable(r) {
  if (!r || !r.player) return false;

  const market = String(r.market || "").toLowerCase();
  const side = String(r.side || "").toUpperCase();
  const prob = Number(r.prob ?? r.calibratedDistributionProb);
  const edge = Number(r.edge ?? r.adjustedEdge ?? r.sportsbookAdjustedEdge ?? r.sportsbookEdge);

  if (!market || !side || !Number.isFinite(Number(r.line))) return false;
  if (!Number.isFinite(prob)) return false;

  // Track all meaningful blocked/shadow candidates, not just one reason.
  if (prob >= 0.49) return true;
  if (Number.isFinite(edge) && edge >= 0.08) return true;

  return false;
}

const sources = [
  "outputs/blocked-final-candidates.json",
  "outputs/slips-distribution-enriched.json"
];

const rows = [];
for (const source of sources) {
  const data = read(source, []);
  for (const r of data) {
    if (!isTrackable(r)) continue;
    rows.push({
      date: DATE,
      sourceFile: source,
      shadow: true,
      player: r.player,
      team: r.team ?? r.resolvedTeam ?? null,
      game: r.game ?? r.resolvedGame ?? r.sportsbookGame ?? null,
      market: r.market,
      side: String(r.side || "").toUpperCase(),
      line: Number(r.line),
      prob: Number(r.prob ?? r.calibratedDistributionProb ?? r.recommendedProb),
      edge: Number.isFinite(Number(r.edge ?? r.adjustedEdge ?? r.sportsbookAdjustedEdge ?? r.sportsbookEdge))
        ? Number(r.edge ?? r.adjustedEdge ?? r.sportsbookAdjustedEdge ?? r.sportsbookEdge)
        : null,
      score: r.score ?? r.finalScore ?? null,
      reasonBlocked: r.reason ?? null,
      reasons: r.reasons ?? [],
      contextMultiplier: r.contextMultiplier ?? null,
      contextProjectionNotes: r.contextProjectionNotes ?? []
    });
  }
}

const outPath = "outputs/near-miss-tracking.json";
const existing = read(outPath, []);
const byKey = new Map();

for (const r of existing) byKey.set(key(r), r);
for (const r of rows) byKey.set(key(r), r);

const updated = [...byKey.values()];
fs.writeFileSync(outPath, JSON.stringify(updated, null, 2));
fs.mkdirSync("outputs/history", { recursive: true });
fs.writeFileSync(`outputs/history/${DATE}-shadow-candidates.json`, JSON.stringify(rows, null, 2));

console.log("Tracked shadow candidates:", rows.length);
console.log("Wrote outputs/near-miss-tracking.json");
console.log(`Wrote outputs/history/${DATE}-shadow-candidates.json`);
