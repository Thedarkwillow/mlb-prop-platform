const fs = require("fs");

const OUT = "data/context/team-form-context.json";
const DATE = process.argv[2] || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);

const TEAM_ABBR = {
  "Arizona Diamondbacks": "AZ", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE", "Colorado Rockies": "COL",
  "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM",
  "New York Yankees": "NYY", "Athletics": "ATH", "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD", "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH"
};

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function daysAgo(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function pct(w, g) {
  return g ? Number((w / g).toFixed(4)) : null;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function abbr(teamName) {
  return TEAM_ABBR[teamName] || teamName;
}

function init(team) {
  return {
    team,
    games: 0,
    wins: 0,
    losses: 0,
    runs: 0,
    f5Runs: 0,
    homeGames: 0,
    homeWins: 0,
    homeRuns: 0,
    homeF5Runs: 0,
    awayGames: 0,
    awayWins: 0,
    awayRuns: 0,
    awayF5Runs: 0,
    recent: []
  };
}

function addGame(rec, { isHome, runs, oppRuns, f5Runs }) {
  rec.games++;
  rec.runs += runs;
  rec.f5Runs += f5Runs ?? 0;

  if (runs > oppRuns) rec.wins++;
  else rec.losses++;

  if (isHome) {
    rec.homeGames++;
    rec.homeRuns += runs;
    rec.homeF5Runs += f5Runs ?? 0;
    if (runs > oppRuns) rec.homeWins++;
  } else {
    rec.awayGames++;
    rec.awayRuns += runs;
    rec.awayF5Runs += f5Runs ?? 0;
    if (runs > oppRuns) rec.awayWins++;
  }

  rec.recent.push({ runs, oppRuns, f5Runs, win: runs > oppRuns, isHome });
}

function f5(linescore, side) {
  const innings = linescore?.innings || [];
  return innings.slice(0, 5).reduce((sum, inn) => sum + Number(inn?.[side]?.runs || 0), 0);
}

function finish(rec) {
  const last3 = rec.recent.slice(-3);
  return {
    team: rec.team,
    games: rec.games,
    winRate: pct(rec.wins, rec.games),
    homeWinRate: pct(rec.homeWins, rec.homeGames),
    awayWinRate: pct(rec.awayWins, rec.awayGames),
    last3WinRate: pct(last3.filter(g => g.win).length, last3.length),
    runsPerGame: rec.games ? Number((rec.runs / rec.games).toFixed(3)) : null,
    homeRunsPerGame: rec.homeGames ? Number((rec.homeRuns / rec.homeGames).toFixed(3)) : null,
    awayRunsPerGame: rec.awayGames ? Number((rec.awayRuns / rec.awayGames).toFixed(3)) : null,
    last3RunsPerGame: last3.length ? Number((last3.reduce((a,g)=>a+g.runs,0) / last3.length).toFixed(3)) : null,
    f5RunsPerGame: rec.games ? Number((rec.f5Runs / rec.games).toFixed(3)) : null,
    homeF5RunsPerGame: rec.homeGames ? Number((rec.homeF5Runs / rec.homeGames).toFixed(3)) : null,
    awayF5RunsPerGame: rec.awayGames ? Number((rec.awayF5Runs / rec.awayGames).toFixed(3)) : null,
    last3F5RunsPerGame: last3.length ? Number((last3.reduce((a,g)=>a+(g.f5Runs || 0),0) / last3.length).toFixed(3)) : null
  };
}

async function main() {
  const startDate = daysAgo(DATE, 45);
  const endDate = daysAgo(DATE, 1);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=linescore`;
  const data = await getJson(url);

  const map = {};

  for (const day of data.dates || []) {
    for (const game of day.games || []) {
      if (game.status?.abstractGameState !== "Final") continue;

      const awayTeam = abbr(game.teams.away.team.name);
      const homeTeam = abbr(game.teams.home.team.name);

      map[awayTeam] ||= init(awayTeam);
      map[homeTeam] ||= init(homeTeam);

      const awayRuns = Number(game.teams.away.score ?? 0);
      const homeRuns = Number(game.teams.home.score ?? 0);

      addGame(map[awayTeam], {
        isHome: false,
        runs: awayRuns,
        oppRuns: homeRuns,
        f5Runs: f5(game.linescore, "away")
      });

      addGame(map[homeTeam], {
        isHome: true,
        runs: homeRuns,
        oppRuns: awayRuns,
        f5Runs: f5(game.linescore, "home")
      });
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: "MLB Stats API schedule hydrate=linescore",
    teams: Object.fromEntries(Object.entries(map).map(([k,v]) => [k, finish(v)]))
  };

  write(OUT, out);
  console.log("TEAM FORM CONTEXT");
  console.log("=================");
  console.log("Teams:", Object.keys(out.teams).length);
  console.log("Wrote", OUT);
  console.table(Object.values(out.teams).slice(0, 12));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
