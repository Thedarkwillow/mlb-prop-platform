const fs = require("fs");

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) throw new Error("Missing ODDS_API_KEY");

const SPORT = "baseball_mlb";
const BOOKMAKER = "draftkings";
const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "batter_rbis",
  "batter_runs_scored",
  "batter_home_runs",
  "pitcher_strikeouts",
  "pitcher_outs"
];

async function fetchJson(url) {
  const r = await fetch(url);
  console.log("credits remaining:", r.headers.get("x-requests-remaining"));
  console.log("credits used:", r.headers.get("x-requests-used"));
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  fs.mkdirSync("data/oddsapi", { recursive: true });

  const eventsUrl =
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events` +
    `?apiKey=${API_KEY}&dateFormat=iso`;

  const events = await fetchJson(eventsUrl);
  fs.writeFileSync("data/oddsapi/events.json", JSON.stringify(events, null, 2));

  console.log("events:", events.length);
  console.table(events.slice(0, 10).map(e => ({
    id: e.id,
    commence: e.commence_time,
    away: e.away_team,
    home: e.home_team
  })));

  const first = events[0];
  if (!first) return;

  const oddsUrl =
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${first.id}/odds` +
    `?apiKey=${API_KEY}` +
    `&bookmakers=${BOOKMAKER}` +
    `&markets=${MARKETS.join(",")}` +
    `&oddsFormat=american` +
    `&dateFormat=iso`;

  const odds = await fetchJson(oddsUrl);
  fs.writeFileSync("data/oddsapi/sample-player-props.json", JSON.stringify(odds, null, 2));

  console.log("saved:");
  console.log("data/oddsapi/events.json");
  console.log("data/oddsapi/sample-player-props.json");
})();
