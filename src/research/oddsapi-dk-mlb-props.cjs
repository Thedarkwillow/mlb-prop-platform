const fs = require("fs");

const API_KEY = process.env.ODDS_API_KEY;
if (!API_KEY) throw new Error("Missing ODDS_API_KEY");

const SPORT = "baseball_mlb";
const BOOKMAKER = "draftkings";
const REGION = "us";
const ODDS_FORMAT = "american";

const MARKETS = [
  "batter_hits",
  "batter_total_bases",
  "batter_rbis",
  "batter_runs_scored",
  "batter_home_runs",
  "batter_hits_runs_rbis",
  "pitcher_strikeouts",
  "pitcher_outs"
];

const MARKET_MAP = {
  batter_hits: "hits",
  batter_total_bases: "bases",
  batter_rbis: "rbis",
  batter_runs_scored: "runs",
  batter_home_runs: "home_runs",
  batter_hits_runs_rbis: "hrr",
  pitcher_strikeouts: "strikeouts",
  pitcher_outs: "pitching_outs"
};

function sideName(name) {
  const n = String(name || "").toLowerCase();
  if (n === "over") return "MORE";
  if (n === "under") return "LESS";
  return String(name || "").toUpperCase();
}

async function fetchJson(url) {
  const r = await fetch(url);
  console.log("credits remaining:", r.headers.get("x-requests-remaining"));
  console.log("credits used:", r.headers.get("x-requests-used"));
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function convertEvent(eventData) {
  const rows = [];
  for (const book of eventData.bookmakers || []) {
    for (const market of book.markets || []) {
      const mappedMarket = MARKET_MAP[market.key];
      if (!mappedMarket) continue;

      for (const o of market.outcomes || []) {
        rows.push({
          source: "oddsapi",
          sportsbook: book.key,
          sportsbookTitle: book.title,
          game: `${eventData.away_team} @ ${eventData.home_team}`,
          eventId: eventData.id,
          commenceTime: eventData.commence_time,
          market: mappedMarket,
          rawMarket: market.key,
          player: o.description || null,
          side: sideName(o.name),
          line: o.point ?? null,
          odds: o.price ?? null,
          lastUpdate: market.last_update
        });
      }
    }
  }
  return rows;
}

(async () => {
  fs.mkdirSync("data/oddsapi", { recursive: true });

  const eventsUrl =
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events?` +
    `apiKey=${API_KEY}`;

  const events = await fetchJson(eventsUrl);
  fs.writeFileSync("data/oddsapi/events.json", JSON.stringify(events, null, 2));

  console.log("events:", events.length);
  console.table(events.map(e => ({
    id: e.id,
    commence: e.commence_time,
    away: e.away_team,
    home: e.home_team
  })));

  const rows = [];
  const rawEvents = [];

  for (const e of events) {
    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${e.id}/odds?` +
      `apiKey=${API_KEY}` +
      `&regions=${REGION}` +
      `&bookmakers=${BOOKMAKER}` +
      `&markets=${MARKETS.join(",")}` +
      `&oddsFormat=${ODDS_FORMAT}`;

    console.log(`\nFetching props: ${e.away_team} @ ${e.home_team}`);
    const eventData = await fetchJson(oddsUrl);
    rawEvents.push(eventData);
    rows.push(...convertEvent(eventData));
  }

  fs.writeFileSync("data/oddsapi/all-dk-player-props.json", JSON.stringify(rawEvents, null, 2));
  fs.writeFileSync("data/vegas-raw.json", JSON.stringify(rows, null, 2));

  console.log("\nWrote data/oddsapi/all-dk-player-props.json");
  console.log("Wrote data/vegas-raw.json");
  console.log("Rows:", rows.length);

  console.table(rows.slice(0, 25));
})();
