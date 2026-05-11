const fs = require("fs");

function slipQualityStatus(slip) {
  const green = Number(slip.green || 0);
  const neutral = Number(slip.neutral || 0);
  const size = Number(slip.size || 0);

  if (!slip.complete) return "INCOMPLETE";
  if (size === 2 && green < 2) return "WATCHLIST";
  if (size === 3 && green < 2) return "WATCHLIST";
  if (size === 4 && green < 2) return "WATCHLIST";
  if (size === 5 && green < 3) return "WATCHLIST";
  if (size === 6 && green < 4) return "WATCHLIST";
  if (neutral >= green) return "WATCHLIST";

  return "PLAYABLE";
}

async function getSlate(date) {
  const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team`);
  if (!r.ok) throw new Error(`MLB schedule failed: ${r.status} ${r.statusText}`);
  const j = await r.json();

  const games = new Set();
  const teams = new Set();

  for (const d of j.dates || []) {
    for (const g of d.games || []) {
      const away = g.teams?.away?.team?.abbreviation;
      const home = g.teams?.home?.team?.abbreviation;
      if (!away || !home) continue;
      games.add(`${away} @ ${home}`);
      teams.add(away);
      teams.add(home);
    }
  }

  return { games, teams };
}

function legTeam(leg) {
  return String(leg.team || leg.playerTeam || leg.teamAbbr || "").toUpperCase().trim();
}

function legGame(leg) {
  return String(leg.resolvedGame || leg.game || leg.matchup || "").trim();
}

function isSlateLeg(leg, slate) {
  const team = legTeam(leg);
  const game = legGame(leg);
  if (game && slate.games.has(game)) return true;
  if (team && slate.teams.has(team)) return true;
  return false;
}

(async () => {
  const date = process.env.npm_config_date || process.argv[2] || new Date().toISOString().slice(0, 10);
  const slate = await getSlate(date);

  console.log(`SLATE FILTER ${date}: ${[...slate.games].join(", ")}`);

  const raw = JSON.parse(fs.readFileSync("outputs/final-slips.json", "utf8"));
  const slips = Array.isArray(raw) ? raw : (raw.slips || raw.finalSlips || []);

  const processed = slips.map(slip => ({
    ...slip,
    status: slipQualityStatus(slip)
  }));

  for (const slip of processed) {
    const originalLegs = slip.legs || [];

    slip.removedOffSlateLegs = originalLegs
      .filter(leg => !isSlateLeg(leg, slate))
      .map(leg => ({
        player: leg.player,
        team: leg.team,
        game: leg.game,
        market: leg.market,
        side: leg.side,
        line: leg.line
      }));

    slip.legs = originalLegs.filter(leg => {
      if (!isSlateLeg(leg, slate)) return false;

      const market = String(leg.market || "").toLowerCase();
      const grade = String(leg.grade || "").toUpperCase();
      const savant = String(leg.savant || "").toUpperCase();
      const prob = Number(leg.calibratedDistributionProb || 0);
      const edge = Number(leg.adjustedEdge || 0);

      if (
        market === "hrr" &&
        grade === "NEUTRAL" &&
        (
          savant !== "BOOST" ||
          prob < 0.64 ||
          edge < 0.085
        )
      ) {
        return false;
      }

      return true;
    });

    const targetSize = Number(slip.originalSize || slip.targetSize || slip.name?.match(/\d+/)?.[0] || slip.size || 0);

    slip.originalSize = targetSize;
    slip.targetSize = targetSize;
    slip.size = targetSize;
    slip.complete = (slip.legs || []).length === targetSize;
    slip.green = (slip.legs || []).filter(l => String(l.grade || "").toUpperCase() === "GREEN").length;
    slip.neutral = (slip.legs || []).filter(l => String(l.grade || "").toUpperCase() === "NEUTRAL").length;
    slip.watchlist = (slip.legs || []).filter(l => String(l.grade || "").toUpperCase() === "WATCHLIST").length;
    slip.fade = (slip.legs || []).filter(l => String(l.grade || "").toUpperCase() === "FADE").length;
    slip.status = slipQualityStatus(slip);
  }

  const playable = processed.filter(slip => slip.status === "PLAYABLE");
  const watchlist = processed.filter(slip => slip.status !== "PLAYABLE");

  console.log("PLAYABLE FINAL SLIPS");

  for (const slip of processed) {
    console.log(
      `${slip.name} | status=${slip.status} green=${slip.green} neutral=${slip.neutral} watchlist=${slip.watchlist || 0} fade=${slip.fade || 0} correlation=${slip.correlation} removedOffSlate=${(slip.removedOffSlateLegs || []).length}`
    );

    console.table(
      (slip.legs || []).map((x, i) => ({
        leg: i + 1,
        player: x.player,
        team: x.team,
        game: x.game,
        pick: `${x.market} ${x.side} ${x.line}`,
        edge: x.edge,
        grade: x.grade,
        books: x.books
      }))
    );
  }

  fs.writeFileSync(
    "outputs/playable-final-slips.json",
    JSON.stringify(playable, null, 2) + "\n"
  );

  fs.writeFileSync(
    "outputs/watchlist-final-slips.json",
    JSON.stringify(watchlist, null, 2) + "\n"
  );

  console.log("Wrote outputs/playable-final-slips.json");
  console.log("Wrote outputs/watchlist-final-slips.json");
})().catch(e => {
  console.error(e);
  process.exit(1);
});
