const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const OUT = `outputs/live/live-game-state-${date}.json`;
const LATEST = "outputs/live/live-game-state-latest.json";
const HISTORY = "data/live/live-game-state-history.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’`-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function pitcherLineFromBox(box, side) {
  const players = box.teams?.[side]?.players || {};
  const pitchers = box.teams?.[side]?.pitchers || [];

  return pitchers.map(id => {
    const p = players[`ID${id}`];
    const pitching = p?.stats?.pitching || {};
    return {
      pitcherId: id,
      pitcher: p?.person?.fullName || null,
      pitcherKey: normName(p?.person?.fullName),
      inningsPitched: pitching.inningsPitched ?? null,
      outs: num(pitching.outs, 0),
      pitchesThrown: num(pitching.numberOfPitches, 0),
      strikeouts: num(pitching.strikeOuts ?? pitching.strikeouts, 0),
      hitsAllowed: num(pitching.hits, 0),
      walksAllowed: num(pitching.baseOnBalls ?? pitching.walks, 0),
      runsAllowed: num(pitching.runs, 0),
      earnedRunsAllowed: num(pitching.earnedRuns, 0)
    };
  }).filter(x => x.pitcher);
}

function currentPitcher(feed, side) {
  const box = feed.liveData?.boxscore;
  const info = box?.teams?.[side]?.teamStats?.pitching;
  return info || null;
}

function currentBatterAndPitcher(feed) {
  const currentPlay = feed.liveData?.plays?.currentPlay || null;
  return {
    currentPitcher: currentPlay?.matchup?.pitcher?.fullName || null,
    currentPitcherId: currentPlay?.matchup?.pitcher?.id || null,
    currentBatter: currentPlay?.matchup?.batter?.fullName || null,
    currentBatterId: currentPlay?.matchup?.batter?.id || null
  };
}

function gameState(feed) {
  const linescore = feed.liveData?.linescore || {};
  const gameData = feed.gameData || {};
  const box = feed.liveData?.boxscore || {};
  const away = gameData.teams?.away?.abbreviation || gameData.teams?.away?.name || null;
  const home = gameData.teams?.home?.abbreviation || gameData.teams?.home?.name || null;
  const current = currentBatterAndPitcher(feed);

  const awayPitchers = pitcherLineFromBox(box, "away");
  const homePitchers = pitcherLineFromBox(box, "home");

  const allPitchers = [...awayPitchers, ...homePitchers];

  return {
    date,
    snapshotTime: new Date().toISOString(),
    gamePk: gameData.game?.pk || feed.gamePk || null,
    status: gameData.status?.detailedState || gameData.status?.abstractGameState || null,
    away,
    home,
    game: away && home ? `${away} @ ${home}` : null,
    inning: linescore.currentInning ?? null,
    inningHalf: linescore.inningHalf ?? null,
    outs: linescore.outs ?? null,
    balls: linescore.balls ?? null,
    strikes: linescore.strikes ?? null,
    awayRuns: linescore.teams?.away?.runs ?? null,
    homeRuns: linescore.teams?.home?.runs ?? null,
    currentPitcher: current.currentPitcher,
    currentPitcherId: current.currentPitcherId,
    currentBatter: current.currentBatter,
    currentBatterId: current.currentBatterId,
    pitcherLines: allPitchers
  };
}

async function scheduleGames(date) {
  const schedule = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const games = [];
  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      games.push({
        gamePk: g.gamePk,
        status: g.status?.detailedState || null
      });
    }
  }
  return games;
}

async function main() {
  const games = await scheduleGames(date);
  const snapshots = [];

  for (const g of games) {
    try {
      const feed = await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`);
      feed.gamePk = g.gamePk;
      snapshots.push(gameState(feed));
    } catch (err) {
      snapshots.push({
        date,
        snapshotTime: new Date().toISOString(),
        gamePk: g.gamePk,
        status: g.status,
        error: String(err.message || err)
      });
    }
  }

  write(OUT, snapshots);
  write(LATEST, snapshots);

  const hist = read(HISTORY, []);
  write(HISTORY, [...hist, ...snapshots]);

  console.log("MLB LIVE GAME STATE SNAPSHOT");
  console.log("----------------------------");
  console.log("date:", date);
  console.log("games:", games.length);
  console.log("snapshots:", snapshots.length);
  console.table(snapshots.map(g => ({
    gamePk: g.gamePk,
    game: g.game,
    status: g.status,
    inning: g.inning,
    half: g.inningHalf,
    outs: g.outs,
    score: g.awayRuns != null && g.homeRuns != null ? `${g.awayRuns}-${g.homeRuns}` : null,
    currentPitcher: g.currentPitcher
  })));
  console.log("saved:", OUT);
  console.log("saved:", LATEST);
  console.log("saved:", HISTORY);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
