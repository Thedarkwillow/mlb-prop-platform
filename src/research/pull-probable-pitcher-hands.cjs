const fs = require("fs");

const DATE =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2] ||
  new Date().toISOString().slice(0, 10);

const OUT = "data/context/probable-pitcher-hands.json";

function teamAbbr(team) {
  return String(team?.abbreviation || team?.teamCode || team?.fileCode || "").toUpperCase();
}

function handOf(player) {
  const raw = String(
    player?.pitchHand?.code ||
    player?.pitchHand?.description ||
    player?.handedness ||
    ""
  ).toUpperCase();

  if (raw.startsWith("L")) return "L";
  if (raw.startsWith("R")) return "R";
  return null;
}

async function fetchPitcherHands(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};

  const url = `https://statsapi.mlb.com/api/v1/people?personIds=${unique.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) return {};

  const json = await res.json();
  const out = {};

  for (const p of json.people || []) {
    out[p.id] = handOf(p);
  }

  return out;
}

async function main() {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}&hydrate=probablePitcher,team`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`MLB schedule failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  const pitcherIds = [];

  for (const d of json.dates || []) {
    for (const g of d.games || []) {
      const awayPitcher = g.teams?.away?.probablePitcher || null;
      const homePitcher = g.teams?.home?.probablePitcher || null;
      if (awayPitcher?.id) pitcherIds.push(awayPitcher.id);
      if (homePitcher?.id) pitcherIds.push(homePitcher.id);
    }
  }

  const pitcherHandsById = await fetchPitcherHands(pitcherIds);

  const games = {};
  const opponentPitcherByTeam = {};
  const pitcherByTeam = {};

  for (const d of json.dates || []) {
    for (const g of d.games || []) {
      const away = g.teams?.away;
      const home = g.teams?.home;

      const awayTeam = teamAbbr(away?.team);
      const homeTeam = teamAbbr(home?.team);

      const awayPitcher = away?.probablePitcher || null;
      const homePitcher = home?.probablePitcher || null;

      const awayHand = handOf(awayPitcher) || pitcherHandsById[awayPitcher?.id] || null;
      const homeHand = handOf(homePitcher) || pitcherHandsById[homePitcher?.id] || null;

      const key = [awayTeam, homeTeam].filter(Boolean).join("@");

      games[key] = {
        gamePk: g.gamePk,
        game: `${awayTeam} @ ${homeTeam}`,
        awayTeam,
        homeTeam,
        awayProbablePitcher: awayPitcher?.fullName || null,
        awayPitcherId: awayPitcher?.id || null,
        awayPitcherHand: awayHand,
        homeProbablePitcher: homePitcher?.fullName || null,
        homePitcherId: homePitcher?.id || null,
        homePitcherHand: homeHand,
        status: g.status?.detailedState || null
      };

      if (awayTeam) {
        pitcherByTeam[awayTeam] = {
          pitcher: awayPitcher?.fullName || null,
          id: awayPitcher?.id || null,
          hand: awayHand,
          opponent: homeTeam,
          gamePk: g.gamePk
        };

        opponentPitcherByTeam[awayTeam] = {
          pitcher: homePitcher?.fullName || null,
          hand: homeHand,
          opponent: homeTeam,
          gamePk: g.gamePk
        };
      }

      if (homeTeam) {
        pitcherByTeam[homeTeam] = {
          pitcher: homePitcher?.fullName || null,
          id: homePitcher?.id || null,
          hand: homeHand,
          opponent: awayTeam,
          gamePk: g.gamePk
        };

        opponentPitcherByTeam[homeTeam] = {
          pitcher: awayPitcher?.fullName || null,
          hand: awayHand,
          opponent: awayTeam,
          gamePk: g.gamePk
        };
      }
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: "MLB Stats API schedule hydrate=probablePitcher",
    games,
    pitcherByTeam,
    opponentPitcherByTeam
  };

  fs.mkdirSync("data/context", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("PROBABLE PITCHER HANDS");
  console.log("======================");
  console.log(`Date: ${DATE}`);
  console.log(`Games: ${Object.keys(games).length}`);
  console.log(`Wrote ${OUT}`);
  console.table(Object.values(games).map(g => ({
    game: g.game,
    awayPitcher: g.awayProbablePitcher,
    awayHand: g.awayPitcherHand,
    homePitcher: g.homeProbablePitcher,
    homeHand: g.homePitcherHand,
    status: g.status
  })));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
