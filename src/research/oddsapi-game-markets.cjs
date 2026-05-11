const fs = require("fs");

const OUT = "data/context/game-odds-context.json";
const API_KEY = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY;

if (!API_KEY) {
  console.error("Missing ODDS_API_KEY or THE_ODDS_API_KEY");
  process.exit(1);
}

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function avg(xs) {
  const ys = xs.map(Number).filter(Number.isFinite);
  return ys.length ? Number((ys.reduce((a,b)=>a+b,0) / ys.length).toFixed(3)) : null;
}

function americanToNum(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function teamAbbr(name) {
  const map = {
    "Arizona Diamondbacks": "AZ",
    "Atlanta Braves": "ATL",
    "Baltimore Orioles": "BAL",
    "Boston Red Sox": "BOS",
    "Chicago Cubs": "CHC",
    "Chicago White Sox": "CWS",
    "Cincinnati Reds": "CIN",
    "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL",
    "Detroit Tigers": "DET",
    "Houston Astros": "HOU",
    "Kansas City Royals": "KC",
    "Los Angeles Angels": "LAA",
    "Los Angeles Dodgers": "LAD",
    "Miami Marlins": "MIA",
    "Milwaukee Brewers": "MIL",
    "Minnesota Twins": "MIN",
    "New York Mets": "NYM",
    "New York Yankees": "NYY",
    "Oakland Athletics": "ATH",
    "Athletics": "ATH",
    "Philadelphia Phillies": "PHI",
    "Pittsburgh Pirates": "PIT",
    "San Diego Padres": "SD",
    "San Francisco Giants": "SF",
    "Seattle Mariners": "SEA",
    "St. Louis Cardinals": "STL",
    "Tampa Bay Rays": "TB",
    "Texas Rangers": "TEX",
    "Toronto Blue Jays": "TOR",
    "Washington Nationals": "WSH"
  };
  return map[name] || name;
}

async function main() {
  const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${API_KEY}&regions=us&markets=h2h,totals&oddsFormat=american`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  const events = await res.json();

  const games = {};
  const teams = {};

  for (const ev of events) {
    const away = teamAbbr(ev.away_team);
    const home = teamAbbr(ev.home_team);
    const game = `${away}@${home}`;

    const homeML = [];
    const awayML = [];
    const totals = [];

    for (const book of ev.bookmakers || []) {
      for (const market of book.markets || []) {
        if (market.key === "h2h") {
          for (const o of market.outcomes || []) {
            const t = teamAbbr(o.name);
            if (t === home) homeML.push(americanToNum(o.price));
            if (t === away) awayML.push(americanToNum(o.price));
          }
        }

        if (market.key === "totals") {
          for (const o of market.outcomes || []) {
            if (o.point != null) totals.push(Number(o.point));
          }
        }
      }
    }

    const gameTotal = avg(totals);

    games[game] = {
      game,
      eventId: ev.id,
      commenceTime: ev.commence_time,
      awayTeam: away,
      homeTeam: home,
      awayMoneyline: avg(awayML),
      homeMoneyline: avg(homeML),
      total: gameTotal,
      books: ev.bookmakers?.length || 0
    };

    teams[away] = {
      team: away,
      game,
      opponent: home,
      moneyline: games[game].awayMoneyline,
      total: gameTotal
    };

    teams[home] = {
      team: home,
      game,
      opponent: away,
      moneyline: games[game].homeMoneyline,
      total: gameTotal
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: "The Odds API baseball_mlb h2h,totals",
    games,
    teams
  };

  write(OUT, out);

  console.log("GAME ODDS CONTEXT");
  console.log("=================");
  console.log("Games:", Object.keys(games).length);
  console.log("Teams:", Object.keys(teams).length);
  console.log("Wrote", OUT);
  console.table(Object.values(games).slice(0, 15));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
