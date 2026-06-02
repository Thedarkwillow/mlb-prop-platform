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

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function handOf(player) {
  const raw = String(
    player?.pitchHand?.code ||
    player?.pitchHand?.description ||
    player?.batSide?.code ||
    player?.batSide?.description ||
    player?.bats ||
    player?.battingHand ||
    player?.hand ||
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
  return handedness.batters?.[key] || handedness.pitchers?.[key] || null;
}

function currentLineupFor(team, lineups) {
  const teamKey = String(team || "").toUpperCase();
  const t = lineups.teams?.[teamKey] || {};

  const fromPlayers = Object.values(lineups.players || {})
    .filter(x => String(x.team || "").toUpperCase() === teamKey)
    .sort((a, b) => {
      const ao = Number(a.battingOrder || a.order || a.lineupSpot || 999);
      const bo = Number(b.battingOrder || b.order || b.lineupSpot || 999);
      if (ao !== bo) return ao - bo;
      return String(a.player || a.name || "").localeCompare(String(b.player || b.name || ""));
    });

  const fallback =
    t.lineup ||
    t.projectedLineup ||
    t.confirmedLineup ||
    t.battingOrder ||
    [];

  const players = fromPlayers.length ? fromPlayers : fallback;
  if (!Array.isArray(players)) return [];

  return players.map((x, idx) => ({
    order: x.order || x.battingOrder || x.lineupSpot || idx + 1,
    name: x.player || x.name || x.playerName || x.fullName || x.person?.fullName || String(x),
    id: x.id || x.playerId || x.person?.id || null,
    bats: handOf(x) || x.bats || x.batSide || x.battingHand || null,
    position: x.position || x.pos || x.primaryPosition?.abbreviation || null,
    status: x.status || t.status || t.lineupStatus || null,
    game: x.game || t.game || null,
    gamePk: x.gamePk || t.gamePk || null,
    source: x.source || null
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

function pitcherContext(p, velocity, handedness) {
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
  const teamMeta = lineups.teams?.[team] || {};

  return {
    team,
    opponent,
    gamePk,
    lineupStatus: teamMeta.lineupStatus || teamMeta.status || (lineup.length >= 8 ? "confirmed" : "unknown"),
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
    fatigue: null,
    seasonRanks: {},
    notes: ["context shell only; enriched later by context-depth-pack"]
  };
}

function main() {
  const probables = read(PROBABLES, {});
  const velocity = read(VELO, {});
  const lineups = read(LINEUPS, {});
  const handedness = read(HAND, {});
  const pitchMatchups = read(PITCH_MATCHUPS, {});

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: {
      probables: PROBABLES,
      velocity: VELO,
      lineups: LINEUPS,
      handedness: HAND,
      pitchMatchups: PITCH_MATCHUPS
    },
    sourceDates: {
      probablesDate: probables.date || null,
      lineupsDate: lineups.date || null,
      lineupsRefreshedAt: lineups.refreshedAt || null
    },
    games: {},
    teams: {}
  };

  const games = probables.games || {};

  for (const [gameKey, g] of Object.entries(games)) {
    const awayTeam = g.awayTeam;
    const homeTeam = g.homeTeam;
    if (!awayTeam || !homeTeam) continue;

    const awayPitcher = {
      pitcher: g.awayProbablePitcher,
      id: g.awayPitcherId,
      hand: g.awayPitcherHand,
      opponent: homeTeam,
      gamePk: g.gamePk
    };

    const homePitcher = {
      pitcher: g.homeProbablePitcher,
      id: g.homePitcherId,
      hand: g.homePitcherHand,
      opponent: awayTeam,
      gamePk: g.gamePk
    };

    out.teams[awayTeam] = {
      team: awayTeam,
      opponent: homeTeam,
      gamePk: g.gamePk,
      teamContext: teamContext(awayTeam, homeTeam, g.gamePk, lineups, handedness),
      startingPitcher: pitcherContext(awayPitcher, velocity, handedness),
      bullpen: bullpenShell(awayTeam, homeTeam, g.gamePk)
    };

    out.teams[homeTeam] = {
      team: homeTeam,
      opponent: awayTeam,
      gamePk: g.gamePk,
      teamContext: teamContext(homeTeam, awayTeam, g.gamePk, lineups, handedness),
      startingPitcher: pitcherContext(homePitcher, velocity, handedness),
      bullpen: bullpenShell(homeTeam, awayTeam, g.gamePk)
    };

    out.games[gameKey] = {
      gamePk: g.gamePk,
      game: g.game || gameKey,
      status: g.status || null,
      awayTeam,
      homeTeam,
      away: out.teams[awayTeam],
      home: out.teams[homeTeam],
      pitchTypeMatchups: Object.values(pitchMatchups.matchups || {}).filter(r => {
        return String(r.team || "").toUpperCase() === awayTeam ||
          String(r.team || "").toUpperCase() === homeTeam ||
          String(r.opponent || "").toUpperCase() === awayTeam ||
          String(r.opponent || "").toUpperCase() === homeTeam;
      })
    };
  }

  write(OUT, out);

  const teams = Object.values(out.teams || {});
  console.log("GAME MODEL CONTEXT");
  console.log("==================");
  console.log("Date:", DATE);
  console.log("Games:", Object.keys(out.games).length);
  console.log("Teams:", teams.length);
  console.log("Starters:", teams.filter(t => t.startingPitcher?.name).length);
  console.log("Starters with arsenal:", teams.filter(t => t.startingPitcher?.arsenal?.available).length);
  console.log("Teams with lineups:", teams.filter(t => (t.teamContext?.lineup || []).length >= 8).length);
  console.log("Wrote", OUT);

  console.table(teams.map(t => ({
    team: t.team,
    opp: t.opponent,
    starter: t.startingPitcher?.name || null,
    hand: t.startingPitcher?.hand || null,
    arsenal: Boolean(t.startingPitcher?.arsenal?.available),
    primaryFB: t.startingPitcher?.arsenal?.primaryFastball || null,
    veloDelta: t.startingPitcher?.arsenal?.velocityDelta ?? null,
    lineup: t.teamContext?.lineup?.length || 0,
    bats: `L${t.teamContext?.lineupHandCounts?.L || 0}/R${t.teamContext?.lineupHandCounts?.R || 0}/S${t.teamContext?.lineupHandCounts?.S || 0}`
  })));
}

main();
