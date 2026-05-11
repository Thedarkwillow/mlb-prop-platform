const fs = require("fs");

const DATE =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2] ||
  new Date().toISOString().slice(0, 10);

const OUT = "data/context/pitching-staffs.json";
const PROBABLES = "data/context/probable-pitcher-hands.json";
const VELO = "data/savant/pitcher-velocity-trends.json";
const HAND = "data/savant/handedness-splits.json";

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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function teamAbbr(team) {
  return String(team?.abbreviation || team?.teamCode || team?.fileCode || "").toUpperCase();
}

async function buildTeamIdMap() {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}&hydrate=team`;
  const data = await fetchJson(url);
  const ids = {};

  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      const away = g.teams?.away?.team || {};
      const home = g.teams?.home?.team || {};
      const awayAbbr = teamAbbr(away);
      const homeAbbr = teamAbbr(home);

      if (awayAbbr && away.id) ids[awayAbbr] = away.id;
      if (homeAbbr && home.id) ids[homeAbbr] = home.id;
    }
  }

  return ids;
}

function savantArsenal(name, id, velocity) {
  const rec =
    velocity.pitchersById?.[String(id)] ||
    velocity.pitchers?.[norm(name)] ||
    null;

  const season = rec?.windows?.season || {};

  return {
    available: Boolean(rec),
    primaryFastball: rec?.primaryFastball || null,
    baselineFastballVelo: rec?.baselineFastballVelo ?? null,
    currentFastballVelo: rec?.currentFastballVelo ?? null,
    velocityDelta: rec?.velocityDelta ?? null,
    velocityTrend: rec?.trend || null,
    pitchMix: season.pitchTypes || rec?.pitchTypes || {}
  };
}

function handednessSplits(name, handedness) {
  return handedness.pitchers?.[norm(name)] || null;
}

function emptyAdvancedStats() {
  return {
    era: null,
    whip: null,
    fip: null,
    xfip: null,
    homeAwaySplits: {
      home: null,
      away: null
    },
    vsLHH: null,
    vsRHH: null,
    kRate: null,
    bbRate: null,
    avgAgainst: null,
    chaseRate: null,
    swingMissRate: null,
    gbFb: null,
    pmr: null
  };
}

function pitcherRecord({ name, id, hand, team, opponent, role, gamePk, velocity, handedness }) {
  const split = handednessSplits(name, handedness);
  const stats = emptyAdvancedStats();

  if (split) {
    stats.vsLHH = split.vsLHB || null;
    stats.vsRHH = split.vsRHB || null;
  }

  return {
    name,
    id: id || null,
    hand: hand || null,
    team,
    opponent,
    role,
    gamePk: gamePk || null,
    stats,
    arsenal: savantArsenal(name, id, velocity)
  };
}

async function getTeamPitchers(teamId) {
  if (!teamId) return [];
  const url = `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&hydrate=person`;
  const data = await fetchJson(url);

  return (data.roster || [])
    .filter(r => {
      const pos = String(
        r.position?.abbreviation ||
        r.position?.code ||
        r.position?.name ||
        ""
      ).toUpperCase();

      return pos === "P" || pos === "1" || pos.includes("PITCHER");
    })
    .map(r => ({
      id: r.person?.id || null,
      name: r.person?.fullName || null,
      hand: handOf(r.person),
      rosterStatus: r.status?.description || null
    }))
    .filter(p => p.name);
}

async function main() {
  const probables = read(PROBABLES, {});
  const velocity = read(VELO, {});
  const handedness = read(HAND, {});

  const teams = {};
  const games = {};

  const teamIds = await buildTeamIdMap();

  for (const [team, p] of Object.entries(probables.pitcherByTeam || {})) {
    const activePitchers = await getTeamPitchers(p.teamId || teamIds[team]);

    const probableStarter = p.pitcher
      ? pitcherRecord({
          name: p.pitcher,
          id: p.id,
          hand: p.hand,
          team,
          opponent: p.opponent,
          role: "probable_starter",
          gamePk: p.gamePk,
          velocity,
          handedness
        })
      : null;

    const bullpen = activePitchers
      .filter(x => !probableStarter || String(x.id) !== String(probableStarter.id))
      .map(x =>
        pitcherRecord({
          name: x.name,
          id: x.id,
          hand: x.hand,
          team,
          opponent: p.opponent,
          role: "bullpen",
          gamePk: p.gamePk,
          velocity,
          handedness
        })
      );

    teams[team] = {
      team,
      opponent: p.opponent || null,
      gamePk: p.gamePk || null,
      probableStarter,
      bullpen,
      bullpenStatus: bullpen.length ? "loaded_active_roster_pitchers" : "not_loaded"
    };
  }

  for (const [key, g] of Object.entries(probables.games || {})) {
    games[key] = {
      gamePk: g.gamePk || null,
      game: g.game || key,
      awayTeam: g.awayTeam || null,
      homeTeam: g.homeTeam || null,
      away: teams[g.awayTeam] || null,
      home: teams[g.homeTeam] || null
    };
  }

  const out = {
    recordType: "pitching_staffs",
    date: DATE,
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      probables: PROBABLES,
      velocity: VELO,
      handedness: HAND
    },
    status: {
      teams: Object.keys(teams).length,
      games: Object.keys(games).length,
      starters: Object.values(teams).filter(t => t.probableStarter).length,
      bullpenPitchers: Object.values(teams).reduce((a, t) => a + t.bullpen.length, 0),
      bullpenWithArsenal: Object.values(teams).reduce(
        (a, t) => a + t.bullpen.filter(p => p.arsenal?.available).length,
        0
      ),
      note: "ERA/WHIP/FIP/xFIP/home-away/PMR remain nullable until FanGraphs or full pitching stat table is imported."
    },
    games,
    teams
  };

  fs.mkdirSync("data/context", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("PITCHING STAFFS");
  console.log("===============");
  console.log(`Date: ${DATE}`);
  console.log(`Teams: ${out.status.teams}`);
  console.log(`Games: ${out.status.games}`);
  console.log(`Starters: ${out.status.starters}`);
  console.log(`Bullpen pitchers: ${out.status.bullpenPitchers}`);
  console.log(`Bullpen with arsenal: ${out.status.bullpenWithArsenal}`);
  console.log(`Wrote ${OUT}`);

  console.table(
    Object.values(teams).slice(0, 20).map(t => ({
      team: t.team,
      starter: t.probableStarter?.name || null,
      pen: t.bullpen.length,
      penArsenal: t.bullpen.filter(p => p.arsenal?.available).length
    }))
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
