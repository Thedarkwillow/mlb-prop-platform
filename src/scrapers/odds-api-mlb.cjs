const fs = require("fs");

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) {
  console.error("Missing ODDS_API_KEY env var");
  process.exit(1);
}

const SPORT = "baseball_mlb";
const REGIONS = "us";
const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "pitcher_strikeouts",
  "pitcher_walks"
].join(",");

const URL =
  `https://api.the-odds-api.com/v4/sports/${SPORT}/events?apiKey=${API_KEY}`;

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

async function main() {
  const events = await getJson(URL);
  console.log("events:", events.length);

  const out = [];

  for (const ev of events) {
    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${ev.id}/odds` +
      `?apiKey=${API_KEY}&regions=${REGIONS}&markets=${MARKETS}&oddsFormat=american`;

    const data = await getJson(oddsUrl);

    for (const book of data.bookmakers || []) {
      for (const market of book.markets || []) {
        for (const outcome of market.outcomes || []) {
          out.push({
            source: "odds_api",
            sportsbook: book.key,
            eventId: ev.id,
            commenceTime: ev.commence_time,
            homeTeam: ev.home_team,
            awayTeam: ev.away_team,
            market: market.key,
            player: outcome.description || outcome.name,
            side: String(outcome.name || "").toUpperCase(),
            line: outcome.point ?? null,
            oddsAmerican: outcome.price,
            scrapedAt: new Date().toISOString()
          });
        }
      }
    }
  }

  fs.writeFileSync("outputs/odds-api-mlb-props.json", JSON.stringify(out, null, 2));
  console.log("props:", out.length);
  console.log("wrote outputs/odds-api-mlb-props.json");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
