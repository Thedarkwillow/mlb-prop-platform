const fs = require("fs");
const {
  buildComponentIndex,
  applyFantasyProjection
} = require("../lib/fantasyProjection.cjs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const inputPath = process.argv[2] || "outputs/priced-board.json";
const outputPath = process.argv[3] || "outputs/priced-board.fantasy-enriched.json";

const rows = read(inputPath, []);
if (!Array.isArray(rows)) {
  throw new Error(`${inputPath} must be an array`);
}

const componentIndex = buildComponentIndex(rows);
const enriched = rows.map(r => applyFantasyProjection(r, componentIndex));

fs.writeFileSync(outputPath, JSON.stringify(enriched, null, 2) + "\n");

const fantasy = enriched.filter(r =>
  r.market === "hitter_fantasy_score" || r.market === "pitcher_fantasy_score"
);

console.log("Fantasy projection enrichment");
console.table(fantasy.map(r => ({
  player: r.player,
  team: r.team,
  game: r.game,
  market: r.market,
  line: r.line,
  side: r.side || r.recommendedSide,
  boardProjection: r.projection,
  fantasyProjection: r.fantasyProjection,
  coverage: r.fantasyProjectionCoverage?.tier,
  availableComponents: r.fantasyProjectionCoverage?.available,
  oddsTier: r.oddsTier
})).slice(0, 40));

console.log("Fantasy rows:", fantasy.length);
console.log("Wrote", outputPath);
