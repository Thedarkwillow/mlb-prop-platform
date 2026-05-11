require("dotenv").config({ override: true });

const fs = require("fs");

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) throw new Error("Missing ODDS_API_KEY");

const SPORT = "baseball_mlb";
const REGIONS = "us";
const ODDS_FORMAT = "american";
const DATE_FORMAT = "iso";

const BOOKMAKERS = [
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "espnbet",
  "fanatics",
  "ballybet",
  "betrivers",
  "betparx",
  "hardrockbet",
  "pinnacle"
];

const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "batter_hits_runs_rbis",
  "batter_strikeouts",
  "batter_walks",

  "pitcher_strikeouts",
  "pitcher_outs",
  "pitcher_hits_allowed",
  "pitcher_earned_runs",
  "pitcher_walks"
];

async function fetchJson(url) {
  const r = await fetch(url);
  const text = await r.text();

  const remaining = r.headers.get("x-requests-remaining");
  const used = r.headers.get("x-requests-used");

  if (remaining !== null) console.log("credits remaining:", remaining);
  if (used !== null) console.log("credits used:", used);

  if (!r.ok) {
    throw new Error(`${r.status} ${text}`);
  }

  return JSON.parse(text);
}

function countOutcomes(event) {
  let bookmakers = 0;
  let markets = 0;
  let outcomes = 0;

  for (const b of event.bookmakers || []) {
    bookmakers++;
    for (const m of b.markets || []) {
      markets++;
      outcomes += (m.outcomes || []).length;
    }
  }

  return { bookmakers, markets, outcomes };
}

(async () => {
  fs.mkdirSync("data/oddsapi", { recursive: true });

  const eventsUrl =
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events` +
    `?apiKey=${API_KEY}` +
    `&dateFormat=${DATE_FORMAT}`;

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
      `&oddsFormat=${ODDS_FORMAT}` +
      `&dateFormat=${DATE_FORMAT}`;

    try {
      const props = await fetchJson(url);
      const counts = countOutcomes(props);

      console.log(
        `Fetched ${event.away_team} @ ${event.home_team}: ` +
        `books=${counts.bookmakers} markets=${counts.markets} outcomes=${counts.outcomes}`
      );

      all.push(props);
    } catch (err) {
      console.error(`Skipped ${event.away_team} @ ${event.home_team}: ${err.message}`);
    }
  }

  if (!all.length) {
    throw new Error("No Odds API prop events fetched. Refusing to write empty odds file.");
  }

  const totals = all.reduce(
    (acc, event) => {
      const c = countOutcomes(event);
      acc.bookmakers += c.bookmakers;
      acc.markets += c.markets;
      acc.outcomes += c.outcomes;
      return acc;
    },
    { bookmakers: 0, markets: 0, outcomes: 0 }
  );

  fs.writeFileSync(
    "data/oddsapi/all-dk-player-props.json",
    JSON.stringify(all, null, 2)
  );

  console.log("RAW ODDSAPI TOTALS");
  console.table([totals]);

  console.log("Wrote data/oddsapi/all-dk-player-props.json");
})();
