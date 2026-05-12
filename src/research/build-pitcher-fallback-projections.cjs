const fs = require("fs");

const SEASON = process.env.SEASON || new Date().getFullYear();
const OUT = "data/projections/pitcher-fallback-projections.json";

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normName(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normMarket(v) {
  const s = String(v || "").toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (s.includes("pitching outs") || s.includes("outs recorded")) return "pitching_outs";
  if (s.includes("walks allowed") || s.includes("pitcher walks")) return "walks_allowed";
  if (s.includes("hits allowed")) return "hits_allowed";
  if (s.includes("earned runs")) return "earned_runs_allowed";
  if (s.includes("pitcher fantasy")) return "pitcher_fantasy_score";
  if (s.includes("pitcher strikeout") || s === "strikeouts") return "strikeouts";
  return s.replace(/\s+/g, "_");
}

function isPitcherMarket(m) {
  return [
    "pitching_outs",
    "walks_allowed",
    "hits_allowed",
    "earned_runs_allowed",
    "pitcher_fantasy_score",
    "strikeouts"
  ].includes(m);
}

function parseIp(v) {
  const s = String(v ?? "0");
  if (!s.includes(".")) return Number(s) || 0;
  const [whole, frac] = s.split(".");
  const outs = Number(whole || 0) * 3 + Number(frac || 0);
  return outs / 3;
}

function avg(nums) {
  const clean = nums.map(Number).filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function round(n, d = 3) {
  return Number(Number(n).toFixed(d));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

async function loadMlbPlayers() {
  const cachePath = `data/projections/mlb-player-index-${SEASON}.json`;
  const cached = readJson(cachePath, null);
  if (cached?.players?.length) return cached.players;

  const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=${SEASON}`;
  const data = await fetchJson(url);
  const players = Array.isArray(data.people) ? data.people : [];

  fs.mkdirSync("data/projections", { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ season: SEASON, createdAt: new Date().toISOString(), players }, null, 2));
  return players;
}

async function pitcherGameLog(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=pitching&season=${SEASON}`;
  const data = await fetchJson(url);
  return data?.stats?.[0]?.splits || [];
}

function buildProjectionFromSplits(player, splits) {
  const games = splits
    .map(s => ({
      date: s.date || null,
      team: s.team?.abbreviation || s.team?.name || null,
      opponent: s.opponent?.abbreviation || s.opponent?.name || null,
      stat: s.stat || {}
    }))
    .filter(g => parseIp(g.stat.inningsPitched) > 0)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const recent = games.slice(0, 5);
  const larger = games.slice(0, 10);
  const sample = recent.length >= 3 ? recent : larger;

  if (!sample.length) return null;

  const innings = avg(sample.map(g => parseIp(g.stat.inningsPitched)));
  const outs = innings == null ? null : innings * 3;
  const walks = avg(sample.map(g => Number(g.stat.baseOnBalls ?? 0)));
  const hitsAllowed = avg(sample.map(g => Number(g.stat.hits ?? 0)));
  const earnedRunsAllowed = avg(sample.map(g => Number(g.stat.earnedRuns ?? 0)));
  const strikeouts = avg(sample.map(g => Number(g.stat.strikeOuts ?? 0)));

  // Conservative DK-style proxy. Kept as fallback metadata, not a verified PrizePicks fantasy scale.
  const fantasyProxy =
    innings == null || walks == null || hitsAllowed == null || earnedRunsAllowed == null || strikeouts == null
      ? null
      : (innings * 2.25) + (strikeouts * 2) - (earnedRunsAllowed * 2) - (hitsAllowed * 0.6) - (walks * 0.6);

  return {
    source: "mlb_statsapi_game_log_fallback",
    playerId: player.id,
    fullName: player.fullName,
    key: normName(player.fullName),
    season: Number(SEASON),
    sampleGames: sample.length,
    totalGamesFound: games.length,
    lastGameDate: sample[0]?.date || null,
    innings: innings == null ? null : round(innings),
    pitchingOuts: outs == null ? null : round(outs),
    walksAllowed: walks == null ? null : round(walks),
    hitsAllowed: hitsAllowed == null ? null : round(hitsAllowed),
    earnedRunsAllowed: earnedRunsAllowed == null ? null : round(earnedRunsAllowed),
    strikeouts: strikeouts == null ? null : round(strikeouts),
    pitcherFantasyProxy: fantasyProxy == null ? null : round(fantasyProxy),
    trustedFor: {
      pitching_outs: sample.length >= 3,
      walks_allowed: sample.length >= 3,
      hits_allowed: sample.length >= 3,
      earned_runs_allowed: sample.length >= 3,
      strikeouts: sample.length >= 3,
      pitcher_fantasy_score: false,
      pitches_thrown: false
    }
  };
}

async function main() {
  const board = readJson("data/prizepicks-latest.json", []);
  const neededNames = new Set();

  for (const p of board) {
    const market = normMarket(p.stat || p.stat_short);
    if (!isPitcherMarket(market)) continue;
    if (String(p.player_name || "").includes("+")) continue;
    neededNames.add(normName(p.player_name));
  }

  const players = await loadMlbPlayers();
  const byName = new Map();
  for (const p of players) byName.set(normName(p.fullName), p);

  const rows = {};
  const misses = [];

  for (const name of neededNames) {
    const player = byName.get(name);
    if (!player) {
      misses.push(name);
      continue;
    }

    try {
      const splits = await pitcherGameLog(player.id);
      const proj = buildProjectionFromSplits(player, splits);
      if (proj) rows[name] = proj;
      else misses.push(name);
    } catch (e) {
      misses.push(name);
    }
  }

  const output = {
    createdAt: new Date().toISOString(),
    season: Number(SEASON),
    source: "MLB Stats API gameLog pitching",
    rows,
    missedNames: misses
  };

  fs.mkdirSync("data/projections", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(output, null, 2));

  console.log("Wrote", OUT);
  console.log("needed pitcher names:", neededNames.size);
  console.log("fallback projections:", Object.keys(rows).length);
  console.log("misses:", misses.length);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
