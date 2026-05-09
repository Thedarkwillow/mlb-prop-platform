const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

const FILES = {
  graded: `outputs/playable-final-slips-graded-${DATE}.json`,
  clv: `outputs/clv-report-${DATE}.json`,
  roi: `outputs/roi-summary-${DATE}.json`,
  warehouse: "data/results/prop-warehouse.json"
};

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function key(x) {
  return [
    x.player,
    x.market,
    x.side,
    x.line
  ].map(v => String(v ?? "").toLowerCase().trim()).join("|");
}

fs.mkdirSync("data/results", { recursive: true });

const rawGraded = read(FILES.graded, []);
const slips = Array.isArray(rawGraded) ? rawGraded : (rawGraded.slips || rawGraded.results || []);
const clvRows = read(FILES.clv, []);
const clvMap = new Map(clvRows.map(r => [key(r), r]));

const existing = read(FILES.warehouse, []);
const existingKeys = new Set(existing.map(r => `${r.date}|${r.slip}|${r.player}|${r.market}|${r.side}|${r.line}`.toLowerCase()));

const rows = [];

for (const slip of slips) {
  for (const leg of slip.legs || []) {
    const result = leg.result || "UNKNOWN";
    const c = clvMap.get(key(leg)) || {};

    const row = {
      date: DATE,
      exportedAt: new Date().toISOString(),

      slip: slip.name || slip.slip || null,
      slipSize: slip.size || null,
      slipResult: slip.result || null,

      player: leg.player || null,
      team: leg.team || null,
      game: leg.game || null,
      gamePk: leg.gamePk || null,

      market: leg.market || null,
      side: leg.side || null,
      line: leg.line ?? null,
      actual: leg.actual ?? null,
      result,

      probability: leg.prob ?? leg.calibratedDistributionProb ?? leg.distributionProb ?? null,
      edge: leg.edge ?? leg.sportsbookEdge ?? null,
      adjustedEdge: leg.adjEdge ?? leg.sportsbookAdjustedEdge ?? null,
      books: leg.books ?? leg.sportsbookBookCount ?? null,

      grade: leg.grade || null,
      modelGrade: leg.modelGrade || null,
      validationGrade: leg.validationGrade || null,
      validationScore: leg.validationScore ?? null,
      validationPenalty: leg.validationPenalty ?? null,
      validationBoost: leg.validationBoost ?? null,
      validationNotes: leg.validationNotes || [],

      marketModel: leg.marketModel || null,
      marketModelScore: leg.marketModelScore ?? leg.modelScore ?? null,

      clv: c.clv ?? null,
      beatClose: c.beatClose ?? null,
      openOdds: c.openOdds ?? null,
      betOdds: c.betOdds ?? null,
      closeOdds: c.closeOdds ?? null,

      unitResult: result === "HIT" ? 1 : result === "MISS" ? -1 : result === "PUSH" ? 0 : null
    };

    const k = `${row.date}|${row.slip}|${row.player}|${row.market}|${row.side}|${row.line}`.toLowerCase();
    if (!existingKeys.has(k)) {
      existingKeys.add(k);
      rows.push(row);
    }
  }
}

const merged = existing.concat(rows);
fs.writeFileSync(FILES.warehouse, JSON.stringify(merged, null, 2));

console.log("HISTORICAL WAREHOUSE EXPORT");
console.log(`date: ${DATE}`);
console.log(`new rows: ${rows.length}`);
console.log(`total rows: ${merged.length}`);
console.log(`wrote ${FILES.warehouse}`);
