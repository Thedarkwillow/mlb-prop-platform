require("dotenv").config();
const fs = require("fs");

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) throw new Error("Missing ODDS_API_KEY");

const SPORT = "baseball_mlb";
const REGIONS = "us,eu";
const ODDS_FORMAT = "american";

const BOOKMAKERS = [
  "draftkings",
  "fanduel",
  "caesars",
  "betmgm",
  "espnbet",
  "pinnacle"
];

const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "batter_rbis",
  "batter_runs_scored",
  "pitcher_strikeouts",
  "pitcher_hits_allowed",
  "pitcher_earned_runs",
  "pitcher_outs"
];

async function fetchJson(url) {
  const r = await fetch(url);
  const text = await r.text();

  const remaining = r.headers.get("x-requests-remaining");
  const used = r.headers.get("x-requests-used");
  if (remaining !== null) console.log("credits remaining:", remaining);
  if (used !== null) console.log("credits used:", used);

  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
}

(async () => {
  fs.mkdirSync("data/oddsapi", { recursive: true });

  const eventsUrl =
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events?apiKey=${API_KEY}`;

  const events = await fetchJson(eventsUrl);
  fs.writeFileSync("data/oddsapi/events.json", JSON.stringify(events, null, 2));

  console.log("events:", events.length);
  console.table(events.map(e => ({
    id: e.id,
    commence: e.commence_time,
    away: e.away_team,
    home: e.home_team
  })));

  const all = [];

  for (const event of events) {
    console.log(`Fetching props: ${event.away_team} @ ${event.home_team}`);

    const url =
      `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${event.id}/odds` +
      `?apiKey=${API_KEY}` +
      `&regions=${REGIONS}` +
      `&bookmakers=${BOOKMAKERS.join(",")}` +
      `&markets=${MARKETS.join(",")}` +
      `&oddsFormat=${ODDS_FORMAT}`;

    try {
      const props = await fetchJson(url);
      all.push(props);
    } catch (err) {
      console.error(`Skipped ${event.away_team} @ ${event.home_team}: ${err.message}`);
    }
  }

  if (!all.length) {
    throw new Error("No Odds API prop events fetched. Refusing to write empty odds file.");
  }

  fs.writeFileSync(
    "data/oddsapi/all-dk-player-props.json",
    JSON.stringify(all, null, 2)
  );

  console.log("Wrote data/oddsapi/all-dk-player-props.json");
})();
