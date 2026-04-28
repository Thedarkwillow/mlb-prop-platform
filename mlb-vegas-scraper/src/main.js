import { Actor } from 'apify';
import axios from 'axios';

await Actor.init();

const input = await Actor.getInput() || {};

const {
    apiKey,
    regions = 'us',
    markets = 'h2h,totals,spreads,batter_hits,pitcher_strikeouts,batter_home_runs',
    oddsFormat = 'american'
} = input;

if (!apiKey) throw new Error('Missing apiKey');

const url =
`https://api.the-odds-api.com/v4/sports/baseball_mlb/odds`;

const res = await axios.get(url, {
    params: {
        apiKey,
        regions,
        markets,
        oddsFormat,
        dateFormat: 'iso'
    }
});

const games = res.data;

const out = [];

for (const game of games) {
    for (const book of game.bookmakers || []) {
        for (const market of book.markets || []) {
            for (const outcome of market.outcomes || []) {

                out.push({
                    recordType: 'vegas_line',
                    commenceTime: game.commence_time,
                    homeTeam: game.home_team,
                    awayTeam: game.away_team,
                    sportsbook: book.title,
                    market: market.key,
                    playerName: outcome.description || null,
                    side: outcome.name,
                    line: outcome.point ?? null,
                    odds: outcome.price ?? null
                });

            }
        }
    }
}

await Actor.pushData(out);

console.log(`Saved ${out.length} rows`);

await Actor.exit();