const fs = require("fs");

const DATE =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2] ||
  new Date().toISOString().slice(0, 10);

const OUT = "data/context/game-model-context.json";
const PROBABLES = "data/context/probable-pitcher-hands.json";
const VELO = "data/savant/pitcher-velocity-trends.json";
const LINEUPS = "data/context/lineups.json";
const HAND = "data/savant/handedness-splits.json";
const PITCH_MATCHUPS = "data/savant/pitch-type-matchups.json";

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function teamAbbr(team) {
  return String(team?.abbreviation || team?.teamCode || team?.fileCode || "").toUpperCase();
}

function handOf(player) {
  const raw = String(
    player?.pitchHand?.code ||
    player?.pitchHand?.description ||
    player?.batSide?.code ||
    player?.batSide?.description ||
    ""
  ).toUpperCase();

  if (raw.startsWith("L")) return "L";
  if (raw.startsWith("R")) return "R";
  if (raw.startsWith("S")) return "S";
  return null;
}

function arsenalFor(name, id, velocityCache) {
  const byName = velocityCache.pitchers?.[norm(name)] || null;
  const byId = velocityCache.pitchersById?.[String(id)] || null;
  const rec = byId || byName || null;
  const season = rec?.windows?.season || {};

  return {
    available: Boolean(rec),
    primaryFastball: rec?.primaryFastball || null,
    baselineFastballVelo: rec?.baselineFastballVelo ?? null,
    currentFastballVelo: rec?.currentFastballVelo ?? null,
    velocityDelta: rec?.velocityDelta ?? null,
    velocityTrend: rec?.trend || null,
    pitchTypes: season.pitchTypes || rec?.pitchTypes || {}
  };
}

function splitProfileFor(name, handedness) {
  const key = norm(name);
  const rec = handedness.batters?.[key] || handedness.pitchers?.[key] || null;
  if (!rec) return null;
  return rec;
}

function currentLineupFor(team, lineups) {
  const t = lineups.teams?.[team] || {};
  const players =
    t.lineup ||
    t.projectedLineup ||
    t.confirmedLineup ||
    t.battingOrder ||
    [];

  if (!Array.isArray(players)) return [];

  return players.map((x, idx) => ({
    order: x.order || x.battingOrder || idx + 1,
    name: x.player || x.name || x.playerName || x.fullName || x.person?.fullName || String(x),
    id: x.id || x.playerId || x.person?.id || null,
    bats: handOf(x) || x.bats || x.batSide || null,
    position: x.position || x.pos || x.primaryPosition?.abbreviation || null,
    status: x.status || t.lineupStatus || null
  }));
}

function lineupHandCounts(lineup) {
  const counts = { L: 0, R: 0, S: 0, unknown: 0 };
  for (const p of lineup) {
    const h = String(p.bats || "").toUpperCase();
    if (h === "L") counts.L++;
    else if (h === "R") counts.R++;
    else if (h === "S") counts.S++;
    else counts.unknown++;
  }
  return {
    ...counts,
    total: lineup.length,
    known: counts.L + counts.R + counts.S
  };
}

function pitcherContext(team, p, velocity, handedness) {
  if (!p?.pitcher) return null;
  return {
    name: p.pitcher,
    id: p.id || null,
    hand: p.hand || null,
    role: "probable_starter",
    opponent: p.opponent || null,
    gamePk: p.gamePk || null,
    arsenal: arsenalFor(p.pitcher, p.id, velocity),
    handednessSplits: splitProfileFor(p.pitcher, handedness)
  };
}

function teamContext(team, opponent, gamePk, lineups, handedness) {
  const lineup = currentLineupFor(team, lineups);
  return {
    team,
    opponent,
    gamePk,
    lineupStatus: lineups.teams?.[team]?.lineupStatus || "unknown",
    lineup,
    lineupHandCounts: lineupHandCounts(lineup),
    battingSplitsAvailable: lineup.filter(p => splitProfileFor(p.name, handedness)).length
  };
}

function bullpenShell(team, opponent, gamePk) {
  return {
    team,
    opponent,
    gamePk,
    status: "not_loaded_yet",
    seasonRanks: {
      eraRank: null,
      whipRank: null
    },
    relievers: []
  };
}

async function main() {
  const probables = read(PROBABLES, {});
  const velocity = read(VELO, {});
  const lineups = read(LINEUPS, {});
  const handedness = read(HAND, {});
  const pitchMatchups = read(PITCH_MATCHUPS, {});

  const games = {};
  const teams = {};

  for (const [team, p] of Object.entries(probables.pitcherByTeam || {})) {
    teams[team] = {
      teamContext: teamContext(team, p.opponent || null, p.gamePk || null, lineups, handedness),
      startingPitcher: pitcherContext(team, p, velocity, handedness),
      bullpen: bullpenShell(team, p.opponent || null, p.gamePk || null)
    };
  }

  for (const [gameKey, g] of Object.entries(probables.games || {})) {
    const awayTeam = g.awayTeam || null;
    const homeTeam = g.homeTeam || null;

    games[gameKey] = {
      gamePk: g.gamePk || null,
      game: g.game || gameKey,
      status: g.status || null,
      awayTeam,
      homeTeam,
      away: awayTeam ? teams[awayTeam] || null : null,
      home: homeTeam ? teams[homeTeam] || null : null,
      marketContext: {
        moneyline: null,
        total: null,
        weather: {
          tempF: null,
          precipitationChance: null,
          dome: null
        }
      },
      pitchTypeMatchups: {
        available: Boolean(pitchMatchups?.matchups),
        note: "Detailed hitter-vs-pitcher pitch-type matchup cache lives in data/savant/pitch-type-matchups.json"
      }
    };
  }

  const out = {
    recordType: "game_model_context",
    date: DATE,
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      probables: PROBABLES,
      velocity: VELO,
      lineups: LINEUPS,
      handedness: HAND,
      pitchMatchups: PITCH_MATCHUPS
    },
    status: {
      games: Object.keys(games).length,
      teams: Object.keys(teams).length,
      starters: Object.values(teams).filter(t => t.startingPitcher).length,
      startersWithArsenal: Object.values(teams).filter(t => t.startingPitcher?.arsenal?.available).length,
      teamsWithLineups: Object.values(teams).filter(t => t.teamContext?.lineup?.length).length,
      bullpensLoaded: 0,
      note: "Full structure is ready. Bullpen arms/workload and team market/weather fields can be populated by later source pulls."
    },
    games,
    teams
  };

  fs.mkdirSync("data/context", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("GAME MODEL CONTEXT");
  console.log("==================");
  console.log(`Date: ${DATE}`);
  console.log(`Games: ${out.status.games}`);
  console.log(`Teams: ${out.status.teams}`);
  console.log(`Starters: ${out.status.starters}`);
  console.log(`Starters with arsenal: ${out.status.startersWithArsenal}`);
  console.log(`Teams with lineups: ${out.status.teamsWithLineups}`);
  console.log(`Wrote ${OUT}`);

  console.table(
    Object.values(teams).slice(0, 20).map(t => ({
      team: t.teamContext.team,
      opp: t.teamContext.opponent,
      starter: t.startingPitcher?.name || null,
      hand: t.startingPitcher?.hand || null,
      arsenal: t.startingPitcher?.arsenal?.available || false,
      primaryFB: t.startingPitcher?.arsenal?.primaryFastball || null,
      veloDelta: t.startingPitcher?.arsenal?.velocityDelta ?? null,
      lineup: t.teamContext.lineup.length,
      bats: `L${t.teamContext.lineupHandCounts.L}/R${t.teamContext.lineupHandCounts.R}/S${t.teamContext.lineupHandCounts.S}`
    }))
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
