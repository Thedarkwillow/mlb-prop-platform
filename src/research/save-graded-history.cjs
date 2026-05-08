const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);
const IN = `outputs/playable-final-slips-graded-${DATE}.json`;
const OUT = "data/results/graded-leg-history.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

fs.mkdirSync("data/results", { recursive: true });

const raw = read(IN, []);
const slips = Array.isArray(raw) ? raw : (raw.slips || raw.results || []);
const existing = read(OUT, []);

const rows = [];

for (const slip of slips) {
  for (const leg of slip.legs || []) {
    if (!["HIT", "MISS", "PUSH"].includes(leg.result)) continue;

    rows.push({
      date: DATE,
      slip: slip.name || slip.slip || null,
      slipSize: slip.size || (slip.legs || []).length,
      player: leg.player,
      team: leg.team || null,
      game: leg.game || null,
      market: leg.market,
      side: leg.side,
      line: leg.line,
      probability: leg.prob ?? leg.calibratedDistributionProb ?? null,
      edge: leg.edge ?? leg.sportsbookEdge ?? null,
      books: leg.books ?? leg.sportsbookBookCount ?? null,
      actual: leg.actual ?? null,
      result: leg.result,
      unitResult: leg.result === "HIT" ? 1 : leg.result === "MISS" ? -1 : 0,
      savedAt: new Date().toISOString()
    });
  }
}

const seen = new Set();
const merged = [...existing, ...rows].filter(r => {
  const k = [r.date, r.slip, r.player, r.market, r.side, r.line].join("|");
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

fs.writeFileSync(OUT, JSON.stringify(merged, null, 2));

console.log("saved graded history:", OUT);
console.log("new rows:", rows.length);
console.log("total rows:", merged.length);
