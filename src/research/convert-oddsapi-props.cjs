const fs = require("fs");

const inFile = "data/oddsapi/all-dk-player-props.json";
const outFile = "data/vegas-raw.json";

const marketMap = {
  batter_hits: "hits",
  batter_total_bases: "bases",
  batter_rbis: "rbis",
  batter_runs_scored: "runs",
  pitcher_strikeouts: "strikeouts",
  pitcher_record_a_win: "pitcher_win",
  pitcher_hits_allowed: "hits_allowed",
  pitcher_earned_runs: "earned_runs_allowed",
  pitcher_outs: "pitching_outs"
};

function sideName(name) {
  const n = String(name || "").toLowerCase();
  if (n === "over") return "MORE";
  if (n === "under") return "LESS";
  return String(name || "").toUpperCase();
}

const events = JSON.parse(fs.readFileSync(inFile, "utf8"));
const rows = [];

for (const event of events) {
  const game = `${event.away_team} @ ${event.home_team}`;

  for (const book of event.bookmakers || []) {
    for (const market of book.markets || []) {
      const mappedMarket = marketMap[market.key];
      if (!mappedMarket) continue;

      for (const outcome of market.outcomes || []) {
        rows.push({
          source: "oddsapi",
          sportsbook: book.key,
          sportsbookTitle: book.title,
          game,
          eventId: event.id,
          commenceTime: event.commence_time,
          market: mappedMarket,
          rawMarket: market.key,
          player: outcome.description || outcome.name,
          side: sideName(outcome.name),
          line: outcome.point ?? null,
          odds: outcome.price ?? null,
          lastUpdate: market.last_update || null
        });
      }
    }
  }
}

fs.writeFileSync(outFile, JSON.stringify(rows, null, 2) + "\n");

console.log(`Wrote ${outFile}`);
console.log("Rows:", rows.length);
console.table(rows.slice(0, 25));
