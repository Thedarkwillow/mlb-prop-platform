const fs = require("fs");
const path = require("path");

const YEAR = Number(process.env.SEASON || process.argv.find(a => /^--season=/.test(a))?.split("=")[1] || new Date().getFullYear());
const DAYS_BACK = Number(process.env.DAYS_BACK || 10);
const DAYS_FORWARD = Number(process.env.DAYS_FORWARD || 10);

const OUT = "data/context/starter-bulk-pitcher-cache-targets.json";
const REPORT = "outputs/context/starter-bulk-pitcher-cache-targets-latest.json";

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(base, n) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function norm(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
async function getJson(url, fallback = null) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "mlb-prop-platform/1.0"
      }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`WARN fetch failed: ${url} | ${err.message}`);
    return fallback;
  }
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function innings(v) {
  if (v === undefined || v === null) return 0;
  const s = String(v);
  if (!s.includes(".")) return num(s);
  const [whole, frac] = s.split(".");
  return num(whole) + (num(frac) / 3);
}

async function main() {
  const today = new Date();
  const startDate = isoDate(addDays(today, -DAYS_BACK));
  const endDate = isoDate(addDays(today, DAYS_FORWARD));

  const teamsResp = await getJson(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${YEAR}`, { teams: [] });
  const teams = (teamsResp.teams || [])
    .filter(t => t.id && t.abbreviation)
    .map(t => ({
      teamId: t.id,
      team: t.abbreviation,
      name: t.name
    }));

  const targets = new Map();
  const addTarget = (p, extra = {}) => {
    if (!p?.id && !p?.person?.id) return;
    const id = p.id || p.person.id;
    const name = p.fullName || p.person?.fullName || p.name || p.pitcher || "";
    if (!name) return;
    const key = String(id);
    const prior = targets.get(key) || {
      playerId: id,
      pitcherId: id,
      player: name,
      pitcher: name,
      playerKey: norm(name),
      team: extra.team || null,
      teamId: extra.teamId || null,
      hand: null,
      roleHints: [],
      sources: [],
      stats: {}
    };
    prior.team = prior.team || extra.team || null;
    prior.teamId = prior.teamId || extra.teamId || null;
    if (extra.hand) prior.hand = extra.hand;
    if (extra.roleHint && !prior.roleHints.includes(extra.roleHint)) prior.roleHints.push(extra.roleHint);
    if (extra.source && !prior.sources.includes(extra.source)) prior.sources.push(extra.source);
    prior.stats = { ...prior.stats, ...(extra.stats || {}) };
    targets.set(key, prior);
  };

  console.log("Pulling active MLB pitcher rosters...");
  for (const t of teams) {
    const roster = await getJson(`https://statsapi.mlb.com/api/v1/teams/${t.teamId}/roster?rosterType=active`, { roster: [] });
    for (const r of roster.roster || []) {
      const pos = String(r.position?.type || r.position?.abbreviation || "").toLowerCase();
      if (!pos.includes("pitcher") && r.position?.abbreviation !== "P") continue;
      addTarget(r, {
        team: t.team,
        teamId: t.teamId,
        roleHint: "active_pitcher",
        source: "mlb_active_roster"
      });
    }
    await sleep(80);
  }

  console.log("Pulling schedule probable pitchers...");
  const sched = await getJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher&season=${YEAR}`,
    { dates: [] }
  );
  for (const d of sched.dates || []) {
    for (const g of d.games || []) {
      const awayTeam = g.teams?.away?.team?.abbreviation || null;
      const homeTeam = g.teams?.home?.team?.abbreviation || null;
      const away = g.teams?.away?.probablePitcher;
      const home = g.teams?.home?.probablePitcher;
      if (away) addTarget(away, { team: awayTeam, roleHint: "probable_starter", source: "mlb_schedule_probable" });
      if (home) addTarget(home, { team: homeTeam, roleHint: "probable_starter", source: "mlb_schedule_probable" });
    }
  }

  console.log("Pulling season pitching stats for starter/bulk classification...");
  const statsResp = await getJson(
    `https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&playerPool=all&season=${YEAR}&limit=5000`,
    { stats: [] }
  );
  const splits = statsResp.stats?.[0]?.splits || [];
  const byIdStats = new Map();

  for (const s of splits) {
    const id = s.player?.id;
    if (!id) continue;
    const st = s.stat || {};
    const games = num(st.gamesPlayed || st.games);
    const gs = num(st.gamesStarted);
    const ip = innings(st.inningsPitched);
    const relief = Math.max(0, games - gs);
    const avgIpPerGame = games ? ip / games : 0;
    const avgIpPerRelief = relief ? ip / relief : 0;

    byIdStats.set(String(id), {
      games,
      gamesStarted: gs,
      inningsPitched: st.inningsPitched || null,
      ip: Number(ip.toFixed(2)),
      reliefAppearances: relief,
      avgIpPerGame: Number(avgIpPerGame.toFixed(2)),
      avgIpPerRelief: Number(avgIpPerRelief.toFixed(2))
    });

    if (targets.has(String(id))) {
      const t = targets.get(String(id));
      t.stats = byIdStats.get(String(id));
    }
  }

  for (const t of targets.values()) {
    const st = t.stats || {};
    const gs = num(st.gamesStarted);
    const games = num(st.games);
    const ip = num(st.ip);
    const relief = num(st.reliefAppearances);
    const avgIpPerGame = num(st.avgIpPerGame);
    const avgIpPerRelief = num(st.avgIpPerRelief);

    const isProbable = t.roleHints.includes("probable_starter");
    const isStarter =
      isProbable ||
      gs >= 2 ||
      (gs >= 1 && ip >= 8);

    // Strict bulk/long-relief only.
    // Do NOT classify normal one-inning relievers as starter/bulk just because
    // they have accumulated 15+ season innings.
    const isBulk =
      !isStarter &&
      games >= 3 &&
      relief >= 2 &&
      (
        avgIpPerRelief >= 1.75 ||
        avgIpPerGame >= 2.0 ||
        (ip >= 25 && avgIpPerRelief >= 1.35)
      );

    t.role =
      isStarter ? "starter" :
      isBulk ? "bulk" :
      "reliever";

    if (isStarter && !t.roleHints.includes("starter_or_rotation_depth")) t.roleHints.push("starter_or_rotation_depth");
    if (isBulk && !t.roleHints.includes("bulk_relief")) t.roleHints.push("bulk_relief");
  }

  const all = [...targets.values()]
    .sort((a, b) => {
      const roleRank = { starter: 0, bulk: 1, reliever: 2 };
      return (roleRank[a.role] ?? 9) - (roleRank[b.role] ?? 9) ||
        String(a.team || "").localeCompare(String(b.team || "")) ||
        String(a.player || "").localeCompare(String(b.player || ""));
    });

  const starterBulk = all.filter(p => p.role === "starter" || p.role === "bulk");
  const starters = starterBulk.filter(p => p.role === "starter");
  const bulk = starterBulk.filter(p => p.role === "bulk");

  const out = {
    generatedAt: new Date().toISOString(),
    season: YEAR,
    mode: "true_30_team_starter_bulk_pitcher_cache_targets",
    dateWindow: { startDate, endDate, daysBack: DAYS_BACK, daysForward: DAYS_FORWARD },
    source: [
      "MLB Stats API active rosters",
      "MLB Stats API probable pitchers",
      "MLB Stats API season pitching stats"
    ],
    counts: {
      teams: teams.length,
      activePitcherTargets: all.length,
      starterBulkTargets: starterBulk.length,
      starters: starters.length,
      bulk: bulk.length,
      relieversExcluded: all.length - starterBulk.length
    },
    teams,
    pitchers: starterBulk,
    starters,
    bulk,
    excludedRelievers: all.filter(p => p.role === "reliever")
  };

  writeJson(OUT, out);
  writeJson(REPORT, {
    generatedAt: out.generatedAt,
    counts: out.counts,
    topStarters: starters.slice(0, 40).map(p => ({
      pitcher: p.pitcher,
      team: p.team,
      gamesStarted: p.stats?.gamesStarted ?? null,
      ip: p.stats?.ip ?? null,
      roleHints: p.roleHints
    })),
    topBulk: bulk.slice(0, 40).map(p => ({
      pitcher: p.pitcher,
      team: p.team,
      games: p.stats?.games ?? null,
      gamesStarted: p.stats?.gamesStarted ?? null,
      ip: p.stats?.ip ?? null,
      avgIpPerRelief: p.stats?.avgIpPerRelief ?? null,
      roleHints: p.roleHints
    }))
  });

  console.log("30-TEAM STARTER/BULK PITCHER CACHE TARGETS");
  console.log("==========================================");
  console.table([out.counts]);
  console.log(`saved: ${OUT}`);
  console.log(`saved: ${REPORT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
