const fs = require("fs");

const input = process.argv[2];
const output = process.argv[3] || "data/prizepicks-latest.json";

if (!input) {
  console.error("Usage: node src/jobs/importApifyPrizePicksBoard.cjs <input.json> [output.json]");
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(input, "utf8"));

function market(stat) {
  const s = String(stat || "").toLowerCase();

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
  if (r.player_team === r.home_team) return r.away_team;
  if (r.player_team === r.away_team) return r.home_team;
  return null;
}

const out = rows
  .filter(r => r.league === "MLB" && !r.player_combo && r.event_type !== "combo")
  .map(r => {
    const m = market(r.stat);
    const opp = opponent(r);
    if (!m || !opp) return null;

    const isFantasy =
      m === "pitcher_fantasy_score" ||
      m === "hitter_fantasy_score";

    return {
      recordType: "merged_prop",
      projection_id: r.projection_id,
      player: r.player_name,
      team: r.player_team,
      opponent: opp,
      game: `${r.away_team} @ ${r.home_team}`,
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
      rankEligible: !isFantasy,
      disabledReason: isFantasy ? "fantasy scale not verified" : null
    };
  })
  .filter(Boolean);

fs.writeFileSync(output, JSON.stringify(out, null, 2));
console.log(`Imported ${out.length} rows -> ${output}`);
console.log("Fantasy rows:", out.filter(r => r.isFantasy).length);
