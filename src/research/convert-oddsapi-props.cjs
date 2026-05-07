const fs = require("fs");

const IN = "data/oddsapi/playable-dk-player-props.json";
const OUT = "data/vegas-raw.json";

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

function toSide(name) {
  const n = String(name || "").toLowerCase();
  if (n === "over") return "MORE";
  if (n === "under") return "LESS";
  return String(name || "").toUpperCase();
}

const raw = JSON.parse(fs.readFileSync(IN, "utf8"));
const events = Array.isArray(raw) ? raw : [raw];

const rows = [];

for (const event of events) {
  for (const book of event.bookmakers || []) {
    for (const market of book.markets || []) {
      const mappedMarket = MARKET_MAP[market.key];
      if (!mappedMarket) continue;

      for (const o of market.outcomes || []) {
        rows.push({
          source: "oddsapi",
          sportsbook: book.key,
          sportsbookTitle: book.title,
          game: `${event.away_team} @ ${event.home_team}`,
          eventId: event.id,
          commenceTime: event.commence_time,
          market: mappedMarket,
          rawMarket: market.key,
          player: o.description,
          side: toSide(o.name),
          line: o.point,
          odds: o.price,
          lastUpdate: market.last_update
        });
      }
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log("Wrote", OUT);
console.log("Rows:", rows.length);
console.table(rows.slice(0, 25));
