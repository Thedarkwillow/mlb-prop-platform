const fs = require("fs");

const input = process.argv[2];
const output = process.argv[3] || "data/prizepicks-latest.json";

if (!input) {
  console.error("Usage: node src/jobs/importApifyPrizePicksBoard.cjs <input.json> [output.json]");
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(input, "utf8"));

function market(stat) {
  const s = String(stat || "").toLowerCase().trim();

  if (s === "pitcher fantasy score") return "pitcher_fantasy_score";
  if (s === "hitter fantasy score") return "hitter_fantasy_score";
  if (s === "pitcher strikeouts") return "strikeouts";
  if (s === "pitching outs") return "pitching_outs";
  if (s === "hits allowed") return "hits_allowed";
  if (s === "earned runs allowed") return "earned_runs_allowed";
  if (s === "walks allowed") return "walks_allowed";
  if (s === "hits+runs+rbis") return "hrr";
  if (s === "total bases") return "bases";
  if (s === "hits") return "hits";
  if (s === "rbis") return "rbis";
  if (s === "runs") return "runs";
  if (s === "home runs") return "hr";

  return null;
}

function opponent(r) {
  if (r.home_team && r.away_team) {
    if (r.player_team === r.home_team) return r.away_team;
    if (r.player_team === r.away_team) return r.home_team;
  }

  return r.opponent || r.description || null;
}

function gameString(r, opp) {
  if (r.away_team && r.home_team) return `${r.away_team} @ ${r.home_team}`;
  return `${r.player_team || "UNK"} @ ${opp || "UNK"}`;
}

const out = rows
  .filter(r => String(r.league || "").toUpperCase() === "MLB")
  .filter(r => !r.player_combo)
  .filter(r => String(r.event_type || "").toLowerCase() !== "combo")
  .map(r => {
    const m = market(r.stat);
    if (!m) return null;

    const isFantasy =
      m === "pitcher_fantasy_score" ||
      m === "hitter_fantasy_score";

    const opp = opponent(r);

    if (!opp && !isFantasy) return null;

    return {
      recordType: "merged_prop",
      projection_id: r.projection_id,
      player: r.player_name,
      team: r.player_team,
      opponent: opp,
      game: gameString(r, opp),
      stat: r.stat,
      market: m,
      line: Number(r.line),
      oddsTier: r.odds_tier || "standard",
      startTime: r.start_time,
      gameStart: r.game_start,
      boardTime: r.board_time,
      updatedAt: r.updated_at,
      source: "apify_prizepicks",
      isFantasy,
      fantasyType: isFantasy ? m : null,
      trackingOnly: isFantasy,
      rankEligible: !isFantasy,
      disabledReason: isFantasy ? "fantasy tracking only until validated" : null
    };
  })
  .filter(Boolean);

fs.writeFileSync(output, JSON.stringify(out, null, 2));

console.log(`Imported ${out.length} rows -> ${output}`);
console.log("Fantasy rows:", out.filter(r => r.isFantasy).length);
