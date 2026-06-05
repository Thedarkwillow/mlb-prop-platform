import fs from 'fs';

const API_KEY = process.env.ODDS_API_KEY;
const SPORT = 'baseball_mlb';
const REGIONS = 'us';
const BOOKS = 'draftkings,fanduel,betmgm,caesars,espnbet,fanatics';
const ODDS_FORMAT = 'american';

const MARKETS = [
  'batter_total_bases',
  'batter_hits_runs_rbis',
  'batter_hits',
  'batter_runs_scored',
  'batter_rbis',
  'pitcher_strikeouts',
  'pitcher_walks',
];

const OUT = 'data/vegas-latest.json';

function americanToProb(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.json();
}

function normalizeMarket(marketKey) {
  const map = {
    batter_total_bases: 'Total Bases',
    batter_hits_runs_rbis: 'Hits+Runs+RBIs',
    batter_hits: 'Hits',
    batter_runs_scored: 'Runs',
    batter_rbis: 'RBIs',
    pitcher_strikeouts: 'Pitcher Strikeouts',
  };
  return map[marketKey] || marketKey;
}

async function main() {
  if (!API_KEY) throw new Error('Missing ODDS_API_KEY in .env');

  fs.mkdirSync('data', { recursive: true });

  const eventsUrl =
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events?apiKey=${API_KEY}`;

  console.log('Fetching Vegas events...');
  const events = await getJson(eventsUrl);
  console.log('Events:', events.length);

  const rows = [];

  for (const event of events) {
    const markets = MARKETS.join(',');
    const oddsUrl =
      `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${event.id}/odds` +
      `?apiKey=${API_KEY}` +
      `&regions=${REGIONS}` +
      `&bookmakers=${BOOKS}` +
      `&markets=${markets}` +
      `&oddsFormat=${ODDS_FORMAT}`;

    console.log('Fetching props:', event.away_team, '@', event.home_team);

    let data;
    try {
      data = await getJson(oddsUrl);
    } catch (err) {
      console.log('Skipped event:', err.message);
      await sleep(800);
      continue;
    }

    for (const book of data.bookmakers || []) {
      for (const market of book.markets || []) {
        for (const outcome of market.outcomes || []) {
          rows.push({
            recordType: 'vegas_prop',
            source: 'TheOddsAPI',
            eventId: event.id,
            game: `${event.away_team} @ ${event.home_team}`,
            commenceTime: event.commence_time,
            bookmaker: book.key,
            bookmakerTitle: book.title,
            marketKey: market.key,
            stat: normalizeMarket(market.key),
            player: outcome.description || outcome.name,
            side: outcome.name?.toUpperCase(),
            line: outcome.point ?? null,
            odds: outcome.price ?? null,
            impliedProb: americanToProb(outcome.price),
            fetchedAt: new Date().toISOString(),
            raw: outcome,
          });
        }
      }
    }

    await sleep(800);
  }

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));

  console.log(`Saved ${OUT}`);
  console.log('Rows:', rows.length);
}

main();
