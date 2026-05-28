const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function avg(xs) {
  const arr = xs.filter(Number.isFinite);
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function sum(xs) {
  return xs.filter(Number.isFinite).reduce((a, b) => a + b, 0);
}

function round(x, d = 4) {
  return Number.isFinite(x) ? Number(x.toFixed(d)) : null;
}

function inningsToOuts(ip) {
  if (ip == null) return null;
  const [whole, frac = "0"] = String(ip).split(".");
  const outs = Number(whole) * 3 + Number(frac);
  return Number.isFinite(outs) ? outs : null;
}

function seasonStart(date) {
  return `${String(date).slice(0, 4)}-03-01`;
}

async function fetchJson(url) {
  const variants = [
    url,
    url.includes("/api/v1/game/") ? url.replace("/api/v1/game/", "/api/v1.1/game/") : null,
    url.includes("/boxscore") && !url.includes("?") ? `${url}?language=en` : null,
    url.includes("/api/v1/game/") && url.includes("/boxscore") && !url.includes("?")
      ? `${url.replace("/api/v1/game/", "/api/v1.1/game/")}?language=en`
      : null
  ].filter(Boolean);

  let lastErr = null;

  for (const candidate of [...new Set(variants)]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(candidate, {
          headers: {
            Accept: "application/json,text/plain,*/*",
            "User-Agent": "Mozilla/5.0 mlb-prop-platform"
          }
        });

        if (res.ok) return res.json();

        const text = await res.text().catch(() => "");
        lastErr = new Error(`Fetch failed ${res.status}: ${candidate}${text ? ` | ${text.slice(0, 120)}` : ""}`);

        if (res.status === 406 || res.status === 404) break;
      } catch (err) {
        lastErr = err;
      }

      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastErr || new Error(`Fetch failed: ${url}`);
}

async function scheduleGamePks(startDate, endDate) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}`;
  const data = await fetchJson(url);
  const games = [];
  for (const d of data.dates || []) {
    for (const g of d.games || []) games.push({ gamePk: g.gamePk, gameDate: d.date });
  }
  return games;
}

function collectPlayersFromBox(box, gameDate, gamePk, out) {
  const all = [
    ...Object.values(box?.teams?.home?.players || {}),
    ...Object.values(box?.teams?.away?.players || {})
  ];

  for (const p of all) {
    const name = p?.person?.fullName;
    if (!name) continue;

    const batting = p.stats?.batting || {};
    const pitching = p.stats?.pitching || {};

    const hasBatting =
      Number(batting.atBats || 0) > 0 ||
      Number(batting.plateAppearances || 0) > 0 ||
      Number(batting.hits || 0) > 0;

    const hasPitching =
      pitching.inningsPitched != null ||
      Number(pitching.battersFaced || 0) > 0;

    const key = norm(name);
    out[key] ||= {
      player: name,
      key,
      games: []
    };

    if (hasBatting) {
      out[key].games.push({
        date: gameDate,
        gamePk,
        role: "hitter",
        hits: Number(batting.hits || 0),
        totalBases: Number(batting.totalBases || 0),
        runs: Number(batting.runs || 0),
        rbis: Number(batting.rbi || 0),
        homeRuns: Number(batting.homeRuns || 0),
        walks: Number(batting.baseOnBalls || 0),
        strikeouts: Number(batting.strikeOuts || 0),
        plateAppearances: Number(batting.plateAppearances || 0),
        atBats: Number(batting.atBats || 0),
        hrr: Number(batting.hits || 0) + Number(batting.runs || 0) + Number(batting.rbi || 0)
      });
    }

    if (hasPitching) {
      out[key].games.push({
        date: gameDate,
        gamePk,
        role: "pitcher",
        outs: inningsToOuts(pitching.inningsPitched),
        inningsPitched: pitching.inningsPitched,
        earnedRuns: Number(pitching.earnedRuns || 0),
        hitsAllowed: Number(pitching.hits || 0),
        strikeouts: Number(pitching.strikeOuts || 0),
        walksAllowed: Number(pitching.baseOnBalls || 0),
        pitches: Number(pitching.pitchesThrown || 0),
        battersFaced: Number(pitching.battersFaced || 0),
        qualityStart: inningsToOuts(pitching.inningsPitched) >= 18 && Number(pitching.earnedRuns || 0) <= 3 ? 1 : 0
      });
    }
  }
}

function lastN(games, role, n) {
  return games
    .filter(g => g.role === role)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, n);
}

function hitterWindow(games) {
  return {
    games: games.length,
    hitsPerGame: round(avg(games.map(g => g.hits))),
    totalBasesPerGame: round(avg(games.map(g => g.totalBases))),
    runsPerGame: round(avg(games.map(g => g.runs))),
    rbisPerGame: round(avg(games.map(g => g.rbis))),
    hrrPerGame: round(avg(games.map(g => g.hrr))),
    hrPerGame: round(avg(games.map(g => g.homeRuns))),
    walkRate: round(sum(games.map(g => g.walks)) / sum(games.map(g => g.plateAppearances))),
    kRate: round(sum(games.map(g => g.strikeouts)) / sum(games.map(g => g.plateAppearances))),
    avg: round(sum(games.map(g => g.hits)) / sum(games.map(g => g.atBats))),
    slug: round(sum(games.map(g => g.totalBases)) / sum(games.map(g => g.atBats)))
  };
}

function pitcherWindow(games) {
  return {
    games: games.length,
    outsPerGame: round(avg(games.map(g => g.outs))),
    inningsPerGame: round(avg(games.map(g => Number(g.outs) / 3))),
    earnedRunsPerGame: round(avg(games.map(g => g.earnedRuns))),
    hitsAllowedPerGame: round(avg(games.map(g => g.hitsAllowed))),
    strikeoutsPerGame: round(avg(games.map(g => g.strikeouts))),
    walksAllowedPerGame: round(avg(games.map(g => g.walksAllowed))),
    pitchesPerGame: round(avg(games.map(g => g.pitches))),
    qualityStartRate: round(avg(games.map(g => g.qualityStart)))
  };
}

async function main() {
  const start = seasonStart(DATE);
  let games = [];
  try {
    games = await scheduleGamePks(start, DATE);
  } catch (err) {
    console.warn(`WARN: schedule fetch failed for player game-log form: ${err && err.message ? err.message : err}`);
    if (fs.existsSync("data/context/player-game-log-form.json")) {
      console.warn("WARN: keeping existing data/context/player-game-log-form.json");
      return;
    }
    throw err;
  }

  const players = {};

  console.log("PLAYER GAME LOG FORM BUILD");
  console.log("==========================");
  console.log({ start, end: DATE, games: games.length });

  for (const g of games) {
    try {
      const box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
      collectPlayersFromBox(box, g.gameDate, g.gamePk, players);
    } catch (err) {
      console.warn(`skip game ${g.gamePk}: ${err.message}`);
    }
  }

  const out = Object.values(players).map(p => {
    const hitterGames = p.games.filter(g => g.role === "hitter");
    const pitcherGames = p.games.filter(g => g.role === "pitcher");

    return {
      player: p.player,
      key: p.key,
      asOfDate: DATE,
      hitter: {
        season: hitterWindow(hitterGames),
        last5: hitterWindow(lastN(p.games, "hitter", 5)),
        last10: hitterWindow(lastN(p.games, "hitter", 10)),
        last15: hitterWindow(lastN(p.games, "hitter", 15))
      },
      pitcher: {
        season: pitcherWindow(pitcherGames),
        last5: pitcherWindow(lastN(p.games, "pitcher", 5)),
        last10: pitcherWindow(lastN(p.games, "pitcher", 10)),
        last15: pitcherWindow(lastN(p.games, "pitcher", 15))
      }
    };
  });

  fs.mkdirSync("data/context", { recursive: true });
  fs.writeFileSync("data/context/player-game-log-form.json", JSON.stringify(out, null, 2));

  console.log({ players: out.length });
  console.table(out
    .filter(x => x.hitter.season.games >= 10 || x.pitcher.season.games >= 3)
    .slice(0, 25)
    .map(x => ({
      player: x.player,
      hitterG: x.hitter.season.games,
      hLast15Hits: x.hitter.last15.hitsPerGame,
      hLast15TB: x.hitter.last15.totalBasesPerGame,
      hSeasonHRR: x.hitter.season.hrrPerGame,
      pitcherG: x.pitcher.season.games,
      pLast5Outs: x.pitcher.last5.outsPerGame,
      pLast5ER: x.pitcher.last5.earnedRunsPerGame,
      pLast5K: x.pitcher.last5.strikeoutsPerGame
    })));

  console.log("Wrote data/context/player-game-log-form.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
