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

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchJson(url) {
  const r = await fetch(url);
  console.log("credits remaining:", r.headers.get("x-requests-remaining"));
  console.log("credits used:", r.headers.get("x-requests-used"));
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  const playable = JSON.parse(fs.readFileSync("outputs/playable-final-slips.json", "utf8"));
  const targetGames = new Set();

  for (const slip of playable) {
    for (const leg of slip.legs || []) {
      targetGames.add(norm(leg.game));
    }
  }

  const eventsUrl =
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events` +
    `?apiKey=${API_KEY}`;

  const events = await fetchJson(eventsUrl);

  const wanted = events.filter(e => {
    const g1 = norm(`${e.away_team} @ ${e.home_team}`);
    const g2 = norm(`${e.home_team} @ ${e.away_team}`);
    return targetGames.has(g1) || targetGames.has(g2);
  });

  console.log("target games:", [...targetGames]);
  console.log("matched events:", wanted.length);

  fs.mkdirSync("data/oddsapi", { recursive: true });
  fs.writeFileSync("data/oddsapi/playable-events.json", JSON.stringify(wanted, null, 2));

  const all = [];
  for (const e of wanted) {
    console.log(`Fetching playable game props: ${e.away_team} @ ${e.home_team}`);
    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${e.id}/odds` +
      `?apiKey=${API_KEY}` +
      `&regions=us` +
      `&bookmakers=${BOOKMAKER}` +
      `&markets=${MARKETS.join(",")}` +
      `&oddsFormat=american`;

    all.push(await fetchJson(oddsUrl));
  }

  fs.writeFileSync("data/oddsapi/playable-dk-player-props.json", JSON.stringify(all, null, 2));
  console.log("Wrote data/oddsapi/playable-dk-player-props.json");
})();
