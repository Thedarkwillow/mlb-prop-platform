const fs = require("fs");

const IN = "data/oddsapi/sample-player-props.json";
const OUT = "data/vegas-raw.json";

const MARKET_MAP = {
  batter_hits: "hits",
  batter_total_bases: "bases",
  batter_rbis: "rbis",
  batter_runs_scored: "runs",
  batter_home_runs: "home_runs",
  pitcher_strikeouts: "strikeouts",
  pitcher_outs: "pitching_outs"
};

const data = JSON.parse(fs.readFileSync(IN, "utf8"));
const rows = [];

for (const book of data.bookmakers || []) {
  for (const market of book.markets || []) {
    const mappedMarket = MARKET_MAP[market.key];
    if (!mappedMarket) continue;

    for (const o of market.outcomes || []) {
      rows.push({
        source: "oddsapi",
        sportsbook: book.key,
        sportsbookTitle: book.title,
        game: `${data.away_team} @ ${data.home_team}`,
        eventId: data.id,
        commenceTime: data.commence_time,
        market: mappedMarket,
        rawMarket: market.key,
        player: o.description,
        side: String(o.name || "").toUpperCase() === "OVER" ? "MORE" : "LESS",
        line: o.point,
        odds: o.price,
        lastUpdate: market.last_update
      });
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log(`Wrote ${OUT}`);
console.log(`Rows: ${rows.length}`);
console.table(rows.slice(0, 20));
