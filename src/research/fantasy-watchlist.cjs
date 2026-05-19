const fs = require("fs");

const inputPath = process.argv[2] || "outputs/priced-board.fantasy-enriched.json";
const outputPath = process.argv[3] || "outputs/fantasy-watchlist.json";

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function side(row) {
  return String(row.side || row.recommendedSide || "").toUpperCase();
}

function fantasyEdgeForSide(row) {
  const proj = Number(row.fantasyProjection);
  const line = Number(row.line);
  if (!Number.isFinite(proj) || !Number.isFinite(line)) return null;

  const s = side(row);
  if (s === "MORE") return Number((proj - line).toFixed(3));
  if (s === "LESS") return Number((line - proj).toFixed(3));
  return null;
}

const rows = read(inputPath, []);
const watchlist = rows
  .filter(r => r.market === "hitter_fantasy_score" || r.market === "pitcher_fantasy_score")
  .map(r => {
    const edgeForSide = fantasyEdgeForSide(r);
    return {
      player: r.player,
      team: r.team,
      game: r.game,
      market: r.market,
      side: side(r),
      line: r.line,
      oddsTier: r.oddsTier || null,
      boardProjection: r.projection ?? null,
      fantasyProjection: r.fantasyProjection ?? null,
      fantasyBaseProjection: r.fantasyBaseProjection ?? null,
      fantasyCorrelationBoost: r.fantasyCorrelationBoost ?? null,
      fantasyCoverageMultiplier: r.fantasyCoverageMultiplier ?? null,
      fantasyEdge: r.fantasyEdge ?? null,
      fantasyEdgeForSide: edgeForSide,
      coverage: r.fantasyProjectionCoverage?.tier || null,
      availableComponents: r.fantasyProjectionCoverage?.available || 0,
      possibleComponents: r.fantasyProjectionCoverage?.possible || null,
      trackOnly: true,
      rankEligible: false,
      promotionEligible: false,
      playableEligible: false,
      disabledReason: r.disabledReason || "fantasy_track_only_until_calibrated"
    };
  })
  .filter(r =>
    r.coverage === "HIGH" &&
    Number.isFinite(Number(r.fantasyEdgeForSide)) &&
    Number(r.fantasyEdgeForSide) >= 1.0
  )
  .sort((a, b) => {
    const tierOrder = { standard: 0, goblin: 1, demon: 2 };
    return (
      Number(b.fantasyEdgeForSide) - Number(a.fantasyEdgeForSide) ||
      (tierOrder[a.oddsTier] ?? 9) - (tierOrder[b.oddsTier] ?? 9)
    );
  });

fs.writeFileSync(outputPath, JSON.stringify(watchlist, null, 2) + "\n");

console.log("FANTASY WATCHLIST");
console.table(watchlist.map((r, i) => ({
  rank: i + 1,
  player: r.player,
  game: r.game,
  pick: `${r.market} ${r.side} ${r.line}`,
  tier: r.oddsTier,
  projection: r.fantasyProjection,
  edge: r.fantasyEdgeForSide,
  coverage: r.coverage,
  status: "TRACK_ONLY"
})).slice(0, 30));

console.log("Fantasy watchlist rows:", watchlist.length);
console.log("Wrote", outputPath);
