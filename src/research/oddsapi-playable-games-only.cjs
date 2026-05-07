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

const TEAM = {
  ARI: "arizona diamondbacks",
  ATH: "athletics",
  ATL: "atlanta braves",
  BAL: "baltimore orioles",
  BOS: "boston red sox",
  CHC: "chicago cubs",
  CIN: "cincinnati reds",
  CLE: "cleveland guardians",
  COL: "colorado rockies",
  CWS: "chicago white sox",
  DET: "detroit tigers",
  HOU: "houston astros",
  KC: "kansas city royals",
  LAA: "los angeles angels",
  LAD: "los angeles dodgers",
  MIA: "miami marlins",
  MIL: "milwaukee brewers",
  MIN: "minnesota twins",
  NYM: "new york mets",
  NYY: "new york yankees",
  PHI: "philadelphia phillies",
  PIT: "pittsburgh pirates",
  SD: "san diego padres",
  SEA: "seattle mariners",
  SF: "san francisco giants",
  STL: "st louis cardinals",
  TB: "tampa bay rays",
  TEX: "texas rangers",
  TOR: "toronto blue jays",
  WSH: "washington nationals",
  WAS: "washington nationals"
};

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]/g, "");
}

function expandGame(game) {
  const parts = String(game || "").split("@").map(x => x.trim().toUpperCase());
  if (parts.length !== 2) return [];
  const [away, home] = parts;
  const awayFull = TEAM[away] || away;
  const homeFull = TEAM[home] || home;
  return [
    norm(`${awayFull} @ ${homeFull}`),
    norm(`${homeFull} @ ${awayFull}`)
  ];
}

async function fetchJson(url) {
  const r = await fetch(url);
  console.log("credits remaining:", r.headers.get("x-requests-remaining"));
  console.log("credits used:", r.headers.get("x-requests-used"));
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  fs.mkdirSync("data/oddsapi", { recursive: true });

  const playable = JSON.parse(fs.readFileSync("outputs/playable-final-slips.json", "utf8"));
  const targetGames = new Set();

  for (const slip of playable) {
    for (const leg of slip.legs || []) {
      for (const key of expandGame(leg.game)) targetGames.add(key);
    }
  }

  const eventsUrl = `https://api.the-odds-api.com/v4/sports/${SPORT}/events?apiKey=${API_KEY}`;
  const events = await fetchJson(eventsUrl);

  const wanted = events.filter(e => {
    const key = norm(`${e.away_team} @ ${e.home_team}`);
    const reverse = norm(`${e.home_team} @ ${e.away_team}`);
    return targetGames.has(key) || targetGames.has(reverse);
  });

  console.log("matched events:", wanted.length);
  console.table(wanted.map(e => ({
    id: e.id,
    away: e.away_team,
    home: e.home_team,
    commence: e.commence_time
  })));

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
