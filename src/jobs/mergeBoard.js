import { Actor, log } from 'apify';
import { ApifyClient } from 'apify-client';

await Actor.init();

const MERGE_VERSION = 'v11.7-separated-tier-boards';

log.info(`MERGE VERSION: ${MERGE_VERSION}`);

const input = await Actor.getInput() || {};

const {
    prizePicksDatasetId,
    ballparkDatasetId,
    savantDatasetId = null,
    vegasDatasetId = null,
    minEdge = 0,
    topLimit = 150,
    onlyTop = false,
    debugSamples = 50,
} = input;

if (!prizePicksDatasetId) throw new Error('Missing prizePicksDatasetId.');
if (!ballparkDatasetId) throw new Error('Missing ballparkDatasetId.');

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const RANK_ELIGIBLE_MARKETS = new Set([
    'strikeouts',
    'pitching_outs',
    'hits_allowed',
    'earned_runs_allowed',
    'hits',
    'bases',
    'hrr',
    'runs',
    'rbis',
    'hr',
]);

const DISABLED_MARKETS = new Map([
    ['pitcher_fantasy_score', 'fantasy scale not verified'],
    ['hitter_fantasy_score', 'fantasy scale not verified'],
    ['pitches_thrown', 'no Ballpark pitch count projection'],
    ['walks_allowed', 'walks allowed projection not verified'],
    ['triples', 'low-volume volatile market'],
    ['hitter_strikeouts', 'hitter strikeouts not rank enabled yet'],
    ['singles', 'singles not rank enabled yet'],
    ['doubles', 'doubles not rank enabled yet'],
    ['walks', 'walks not rank enabled yet'],
    ['stolen_bases', 'stolen bases not rank enabled yet'],
]);

const MARKET_SCORE_BONUS = {
    strikeouts: 0.00,
    pitching_outs: 0.22,
    hits_allowed: 0.08,
    earned_runs_allowed: 0.05,
    hits: 0.24,
    bases: 0.16,
    hrr: 0.18,
    runs: 0.12,
    rbis: 0.12,
    hr: -0.22,
};

function num(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(n) ? n : null;
}

function hasNum(v) {
    return v !== null && v !== undefined && Number.isFinite(v);
}

function clean(v) {
    return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function normName(s) {
    return clean(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function nameKeys(name) {
    const parts = normName(name).split(' ').filter(Boolean);
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';
    const keys = new Set();

    if (parts.length) keys.add(parts.join(' '));
    if (first && last) keys.add(`${first} ${last}`);
    if (first && last) keys.add(`${first[0]} ${last}`);

    return [...keys];
}

function teamAbbr(v) {
    if (!v) return null;
    const s = clean(v);

    const map = {
        'Arizona Diamondbacks': 'ARI',
        Diamondbacks: 'ARI',
        Arizona: 'ARI',
        ARZ: 'ARI',
        'Atlanta Braves': 'ATL',
        Braves: 'ATL',
        Atlanta: 'ATL',
        'Baltimore Orioles': 'BAL',
        Orioles: 'BAL',
        Baltimore: 'BAL',
        'Boston Red Sox': 'BOS',
        'Red Sox': 'BOS',
        Boston: 'BOS',
        'Chicago Cubs': 'CHC',
        Cubs: 'CHC',
        'Chicago White Sox': 'CHW',
        'White Sox': 'CHW',
        CWS: 'CHW',
        'Cincinnati Reds': 'CIN',
        Reds: 'CIN',
        Cincinnati: 'CIN',
        'Cleveland Guardians': 'CLE',
        Guardians: 'CLE',
        Cleveland: 'CLE',
        'Colorado Rockies': 'COL',
        Rockies: 'COL',
        Colorado: 'COL',
        'Detroit Tigers': 'DET',
        Tigers: 'DET',
        Detroit: 'DET',
        'Houston Astros': 'HOU',
        Astros: 'HOU',
        Houston: 'HOU',
        'Kansas City Royals': 'KC',
        Royals: 'KC',
        'Kansas City': 'KC',
        KCR: 'KC',
        'Los Angeles Angels': 'LAA',
        Angels: 'LAA',
        'Los Angeles Dodgers': 'LAD',
        Dodgers: 'LAD',
        'Miami Marlins': 'MIA',
        Marlins: 'MIA',
        Miami: 'MIA',
        'Milwaukee Brewers': 'MIL',
        Brewers: 'MIL',
        Milwaukee: 'MIL',
        'Minnesota Twins': 'MIN',
        Twins: 'MIN',
        Minnesota: 'MIN',
        'New York Mets': 'NYM',
        Mets: 'NYM',
        'New York Yankees': 'NYY',
        Yankees: 'NYY',
        Athletics: 'ATH',
        'Oakland Athletics': 'ATH',
        'Sacramento Athletics': 'ATH',
        OAK: 'ATH',
        'Philadelphia Phillies': 'PHI',
        Phillies: 'PHI',
        Philadelphia: 'PHI',
        'Pittsburgh Pirates': 'PIT',
        Pirates: 'PIT',
        Pittsburgh: 'PIT',
        'San Diego Padres': 'SD',
        Padres: 'SD',
        'San Diego': 'SD',
        SDP: 'SD',
        'San Francisco Giants': 'SF',
        Giants: 'SF',
        'San Francisco': 'SF',
        SFG: 'SF',
        'Seattle Mariners': 'SEA',
        Mariners: 'SEA',
        Seattle: 'SEA',
        'St. Louis Cardinals': 'STL',
        'St Louis Cardinals': 'STL',
        Cardinals: 'STL',
        'St. Louis': 'STL',
        'St Louis': 'STL',
        'Tampa Bay Rays': 'TB',
        Rays: 'TB',
        'Tampa Bay': 'TB',
        TBR: 'TB',
        'Texas Rangers': 'TEX',
        Rangers: 'TEX',
        Texas: 'TEX',
        'Toronto Blue Jays': 'TOR',
        'Blue Jays': 'TOR',
        Toronto: 'TOR',
        'Washington Nationals': 'WAS',
        Nationals: 'WAS',
        Washington: 'WAS',
        WSH: 'WAS',
    };

    return map[s] || s.toUpperCase();
}

function normalizeMarket(stat) {
    const s = clean(stat).toLowerCase();

    if (s.includes('pitches thrown')) return 'pitches_thrown';
    if (s.includes('pitcher fantasy')) return 'pitcher_fantasy_score';
    if (s.includes('hitter fantasy')) return 'hitter_fantasy_score';
    if (s.includes('pitching outs')) return 'pitching_outs';
    if (s.includes('hits allowed')) return 'hits_allowed';
    if (s.includes('walks allowed')) return 'walks_allowed';
    if (s.includes('earned runs allowed')) return 'earned_runs_allowed';

    if (
        s.includes('hits+runs+rbi') ||
        s.includes('hits+runs+rbis') ||
        s.includes('h+r+r') ||
        s === 'hrr'
    ) return 'hrr';

    if (s.includes('total bases') || s === 'bases') return 'bases';
    if (s.includes('hitter strikeout')) return 'hitter_strikeouts';
    if (s.includes('strikeout') || s === 'ks' || s === 'k') return 'strikeouts';
    if (s.includes('home run') || s === 'hr') return 'hr';
    if (s.includes('stolen base')) return 'stolen_bases';
    if (s.includes('single')) return 'singles';
    if (s.includes('double')) return 'doubles';
    if (s.includes('triple')) return 'triples';
    if (s.includes('rbi')) return 'rbis';
    if (s === 'runs' || s.includes('runs')) return 'runs';
    if (s.includes('walk') && !s.includes('allowed')) return 'walks';
    if (s.includes('hit') && !s.includes('allowed') && !s.includes('pitch')) return 'hits';

    return null;
}

function getOpponent(row, team) {
    const desc = teamAbbr(row.description);
    const home = teamAbbr(row.home_team || row.home_team_name);
    const away = teamAbbr(row.away_team || row.away_team_name);

    if (desc && desc !== team) return desc;

    if (home && away) {
        if (team === home) return away;
        if (team === away) return home;
    }

    return desc || null;
}

function extractPrize(row) {
    const playerName = clean(row.player_name || row.playerName || row.name || row.attributes?.player_name);
    const rawStat = clean(row.stat || row.stat_short || row.market || row.attributes?.stat);
    const team = teamAbbr(row.player_team || row.team || row.attributes?.player_team);
    const market = normalizeMarket(rawStat);

    return {
        projectionId: row.projection_id || row.id || null,
        playerName,
        normName: normName(playerName),
        team,
        opponent: getOpponent(row, team),
        market,
        rawStat,
        line: num(row.line ?? row.line_score ?? row.value),
        tier: clean(row.odds_tier || row.tier || 'standard').toLowerCase() || 'standard',
        position: row.player_position || null,
        startTime: row.start_time || row.game_start || null,
        raw: row,
    };
}

async function getAllDatasetItems(datasetId, label) {
    log.info(`Loading ${label}`, { datasetId });

    const out = [];
    let offset = 0;
    const limit = 1000;

    while (true) {
        const page = await client.dataset(datasetId).listItems({
            offset,
            limit,
            clean: true,
        });

        out.push(...page.items);
        if (page.items.length < limit) break;
        offset += limit;
    }

    log.info(`Loaded ${label}`, { count: out.length });
    return out;
}

function addIndex(index, type, team, name, row) {
    for (const key of nameKeys(name)) {
        index[type] ??= {};
        index[type][team] ??= {};
        index[type][team][key] ??= [];
        index[type][team][key].push(row);
    }
}

function buildBallparkExportIndexes(rows) {
    const index = { batter: {}, pitcher: {}, team: {}, game: {} };
    const counts = { batter: 0, pitcher: 0, team: 0, game: 0 };

    for (const row of rows) {
        if (row.recordType === 'batter') {
            const name = row.fullName || row.playerName;
            const team = teamAbbr(row.team);
            if (!name || !team) continue;
            addIndex(index, 'batter', team, name, row);
            counts.batter++;
        }

        if (row.recordType === 'pitcher') {
            const name = row.fullName || row.playerName || row.pitcherName;
            const team = teamAbbr(row.team);
            if (!name || !team) continue;
            addIndex(index, 'pitcher', team, name, row);
            counts.pitcher++;
        }

        if (row.recordType === 'team') {
            const team = teamAbbr(row.team || row.Team);
            if (!team) continue;
            index.team[team] ??= [];
            index.team[team].push(row);
            counts.team++;
        }

        if (row.recordType === 'game') {
            counts.game++;
            const away = teamAbbr(row.awayTeam || row.away || row.away_team);
            const home = teamAbbr(row.homeTeam || row.home || row.home_team);
            if (away && home) {
                index.game[`${away}@${home}`] = row;
                index.game[`${home}@${away}`] = row;
            }
        }
    }

    return { index, counts };
}

function chooseTeamNameMatch(index, type, pp) {
    if (!pp.team || !pp.playerName) return null;

    const teamPool = index[type]?.[pp.team];
    if (!teamPool) return null;

    for (const key of nameKeys(pp.playerName)) {
        const rows = teamPool[key] || [];

        if (rows.length === 1) return rows[0];

        if (rows.length > 1) {
            const exact = rows.find((r) => normName(r.fullName || r.playerName || r.pitcherName) === pp.normName);
            return exact || rows[0];
        }
    }

    return null;
}

function findBallparkMatch(pp, index) {
    const pitcherMarkets = [
        'strikeouts',
        'pitching_outs',
        'hits_allowed',
        'walks_allowed',
        'earned_runs_allowed',
        'pitcher_fantasy_score',
        'pitches_thrown',
    ];

    const batterMarkets = [
        'hits',
        'bases',
        'hrr',
        'hr',
        'runs',
        'rbis',
        'walks',
        'singles',
        'doubles',
        'triples',
        'stolen_bases',
        'hitter_strikeouts',
        'hitter_fantasy_score',
    ];

    if (pitcherMarkets.includes(pp.market)) {
        const row = chooseTeamNameMatch(index, 'pitcher', pp);
        return {
            match: row,
            matchType: row ? 'team_exact_name_pitcher' : 'unmatched_pitcher',
            sourceType: 'pitcher',
        };
    }

    if (batterMarkets.includes(pp.market)) {
        const row = chooseTeamNameMatch(index, 'batter', pp);
        return {
            match: row,
            matchType: row ? 'team_exact_name_batter' : 'unmatched_batter',
            sourceType: 'batter',
        };
    }

    return { match: null, matchType: 'unsupported_market', sourceType: null };
}

function sumNums(vals) {
    const cleanVals = vals.map(num).filter(hasNum);
    if (!cleanVals.length) return null;
    return cleanVals.reduce((a, b) => a + b, 0);
}

function projectionFromExport(pp, bp) {
    if (!bp) return { projection: null, probability: null, modelType: null, sourceField: null };

    const m = pp.market;

    if (m === 'hrr') {
        return {
            projection: sumNums([bp.hits, bp.runs, bp.rBIs]),
            probability: null,
            modelType: 'ballpark_batter_hrr',
            sourceField: 'hits + runs + rBIs',
        };
    }

    if (m === 'pitching_outs') {
        const innings = num(bp.innings || bp.inningsPitched);
        return {
            projection: hasNum(innings) ? innings * 3 : null,
            probability: null,
            modelType: 'ballpark_pitcher_outs',
            sourceField: 'innings * 3',
        };
    }

    if (m === 'pitches_thrown') {
        return {
            projection: null,
            probability: null,
            modelType: 'unsupported_no_ballpark_pitch_count',
            sourceField: null,
        };
    }

    const map = {
        hits: ['hits', 'hitProbability', 'ballpark_batter_hits'],
        bases: ['bases', null, 'ballpark_batter_bases'],
        hr: ['homeRuns', 'homeRunProbability', 'ballpark_batter_hr'],
        runs: ['runs', null, 'ballpark_batter_runs'],
        rbis: ['rBIs', null, 'ballpark_batter_rbis'],
        walks: ['walks', null, 'ballpark_batter_walks'],
        singles: ['singles', null, 'ballpark_batter_singles'],
        doubles: ['doubles', null, 'ballpark_batter_doubles'],
        triples: ['triples', null, 'ballpark_batter_triples'],
        stolen_bases: ['stolenBaseSuccesses', 'stolenBaseProbability', 'ballpark_batter_sb'],
        hitter_strikeouts: ['strikeouts', null, 'ballpark_batter_strikeouts'],
        hitter_fantasy_score: ['pointsDK', null, 'ballpark_batter_points_dk'],

        strikeouts: ['strikeouts', null, 'ballpark_pitcher_strikeouts'],
        hits_allowed: ['hitsAllowed', null, 'ballpark_pitcher_hits_allowed'],
        walks_allowed: ['walksAllowed', null, 'ballpark_pitcher_walks_allowed'],
        earned_runs_allowed: ['runsAllowed', null, 'ballpark_pitcher_runs_allowed'],
        pitcher_fantasy_score: ['pointsDK', null, 'ballpark_pitcher_points_dk'],
    };

    const spec = map[m];
    if (!spec) return { projection: null, probability: null, modelType: null, sourceField: null };

    const [projectionField, probabilityField, modelType] = spec;

    return {
        projection: projectionField ? num(bp[projectionField]) : null,
        probability: probabilityField ? num(bp[probabilityField]) : null,
        modelType,
        sourceField: projectionField,
    };
}

function side(projection, line) {
    if (!hasNum(projection) || !hasNum(line)) return null;
    if (projection > line) return 'MORE';
    if (projection < line) return 'LESS';
    return 'PUSH';
}

function confidence(edge, market, tier, probability) {
    if (!hasNum(edge)) return null;

    let score = Math.abs(edge);

    if (['hits', 'hr', 'stolen_bases'].includes(market) && hasNum(probability)) {
        score += Math.max(0, probability - 0.5) * 2;
    }

    if (['hr', 'hrr'].includes(market)) score -= 0.25;
    if (market === 'pitching_outs') score += 0.12;
    if (market === 'hits') score += 0.08;
    if (market === 'bases') score += 0.04;

    if (tier === 'standard') score += 0.2;
    if (tier === 'goblin') score -= 0.05;
    if (tier === 'demon') score -= 0.05;

    return Math.round(Math.max(0, score) * 1000) / 1000;
}

function marketGroupScore(row) {
    if (!hasNum(row.confidenceScore)) return 0;

    let score = row.confidenceScore;
    score += MARKET_SCORE_BONUS[row.market] || 0;

    const absEdge = Math.abs(row.edge || 0);

    if (row.market === 'strikeouts' && row.ballparkSourceType !== 'pitcher') score -= 2.0;
    if (row.market === 'strikeouts' && row.prizePicksLine <= 1.5) score -= 1.25;
    if (row.market === 'hr') score -= 0.35;
    if (row.market === 'hrr') score -= 0.05;

    if (absEdge < 0.05) score -= 0.35;
    if (absEdge >= 0.25) score += 0.08;
    if (absEdge >= 0.50) score += 0.12;

    return Number(Math.max(0, score).toFixed(3));
}

function getDisabledReason(row) {
    if (DISABLED_MARKETS.has(row.market)) return DISABLED_MARKETS.get(row.market);
    if (!RANK_ELIGIBLE_MARKETS.has(row.market)) return 'market not rank eligible';
    if (!row.matchType?.startsWith('team_exact_name')) return 'weak fallback row';
    if (!hasNum(row.modelProjection)) return 'missing model projection';
    if (!hasNum(row.edge)) return 'missing edge';
    if (!row.recommendedSide || row.recommendedSide === 'PUSH') return 'push or no side';

    if (row.market === 'strikeouts' && row.ballparkSourceType !== 'pitcher') {
        return 'hitter strikeouts not rank enabled';
    }

    return null;
}

function getRankEligibleReason(row) {
    if (!row.rankEligible) return row.disabledReason;
    return `rank eligible: ${row.market}, exact Ballpark match, projection available`;
}

function getMarketTabs(row) {
    const tabs = ['All'];

    if (row.ballparkSourceType === 'pitcher') tabs.push('Pitchers');
    if (row.ballparkSourceType === 'batter') tabs.push('Hitters');

    if (row.market === 'strikeouts') tabs.push('Ks');
    if (row.market === 'pitching_outs') tabs.push('Outs');
    if (row.market === 'hits') tabs.push('Hits');
    if (row.market === 'bases') tabs.push('Bases');
    if (row.market === 'hrr') tabs.push('HRR');
    if (['runs', 'rbis'].includes(row.market)) tabs.push('Runs/RBIs');

    if (row.prizePicksTier === 'demon') tabs.push('Demons');
    if (row.prizePicksTier === 'goblin') tabs.push('Goblins');

    if (!row.matchType?.startsWith('team_exact_name')) tabs.push('Fallbacks');
    if (!row.rankEligible) tabs.push('Disabled');

    return tabs;
}

function buildMerged(pp, bpResult) {
    const bp = bpResult.match;
    const model = projectionFromExport(pp, bp);
    const edge = hasNum(model.projection) && hasNum(pp.line)
        ? Number((model.projection - pp.line).toFixed(3))
        : null;
    const recommendedSide = side(model.projection, pp.line);

    const row = {
        recordType: 'merged_prop',
        mergeVersion: MERGE_VERSION,

        playerName: pp.playerName,
        team: pp.team,
        opponent: pp.opponent,
        market: pp.market,
        rawStat: pp.rawStat,
        position: pp.position,
        startTime: pp.startTime,

        prizePicksLine: pp.line,
        prizePicksTier: pp.tier,
        projectionId: pp.projectionId,

        modelProjection: model.projection,
        modelProbability: model.probability,
        modelType: model.modelType,
        sourceField: model.sourceField,

        edge,
        recommendedSide,
        confidenceScore: confidence(edge, pp.market, pp.tier, model.probability),

        matchType: bpResult.matchType,
        ballparkSourceType: bpResult.sourceType,
        ballparkName: bp?.fullName || null,
        ballparkTeam: bp?.team || null,
        ballparkOpponent: bp?.opponent || null,
        ballparkGamePk: bp?.gamePk || null,

        ballpark: bp,
        rawPrizePicks: pp.raw,
    };

    const disabledReason = getDisabledReason(row);

    row.rankEligible = !disabledReason;
    row.disabledReason = disabledReason;
    row.rankEligibleReason = getRankEligibleReason(row);
    row.marketGroupScore = marketGroupScore(row);
    row.marketTabs = getMarketTabs(row);

    return row;
}

function familyKey(row) {
    return [
        row.team,
        normName(row.playerName),
        row.market,
        row.startTime || '',
    ].join('|');
}

function tierSortValue(tier) {
    const order = { goblin: 1, standard: 2, demon: 3 };
    return order[tier] || 99;
}

function selectBestVariant(variants, tierFilter = null) {
    const eligible = variants
        .filter((v) => v.rankEligible)
        .filter((v) => !tierFilter || v.prizePicksTier === tierFilter)
        .filter((v) => hasNum(v.confidenceScore))
        .filter((v) => hasNum(v.marketGroupScore))
        .filter((v) => hasNum(v.edge))
        .filter((v) => Math.abs(v.edge) >= minEdge);

    if (!eligible.length) return null;

    return eligible
        .slice()
        .sort((a, b) => {
            if ((b.marketGroupScore || 0) !== (a.marketGroupScore || 0)) {
                return (b.marketGroupScore || 0) - (a.marketGroupScore || 0);
            }

            if ((b.confidenceScore || 0) !== (a.confidenceScore || 0)) {
                return (b.confidenceScore || 0) - (a.confidenceScore || 0);
            }

            return Math.abs(b.edge || 0) - Math.abs(a.edge || 0);
        })[0];
}

function selectSafestVariant(variants) {
    const eligible = variants.filter((v) => v.rankEligible);

    if (!eligible.length) return null;

    const more = eligible
        .filter((v) => v.recommendedSide === 'MORE')
        .sort((a, b) => a.prizePicksLine - b.prizePicksLine);

    const less = eligible
        .filter((v) => v.recommendedSide === 'LESS')
        .sort((a, b) => b.prizePicksLine - a.prizePicksLine);

    return more[0] || less[0] || selectBestVariant(eligible);
}

function sortVariantRows(rows) {
    return rows.slice().sort((a, b) => {
        if ((b.marketGroupScore || 0) !== (a.marketGroupScore || 0)) {
            return (b.marketGroupScore || 0) - (a.marketGroupScore || 0);
        }

        if ((b.confidenceScore || 0) !== (a.confidenceScore || 0)) {
            return (b.confidenceScore || 0) - (a.confidenceScore || 0);
        }

        return Math.abs(b.edge || 0) - Math.abs(a.edge || 0);
    });
}

function buildFamilies(rows) {
    const map = new Map();

    for (const row of rows) {
        const key = familyKey(row);

        if (!map.has(key)) {
            map.set(key, {
                recordType: 'variant_family',
                mergeVersion: MERGE_VERSION,
                familyKey: key,
                playerName: row.playerName,
                team: row.team,
                opponent: row.opponent,
                market: row.market,
                rawStat: row.rawStat,
                startTime: row.startTime,
                modelProjection: row.modelProjection,
                modelProbability: row.modelProbability,
                modelType: row.modelType,
                ballparkSourceType: row.ballparkSourceType,
                marketTabs: row.marketTabs,
                variants: [],
            });
        }

        map.get(key).variants.push({
            tier: row.prizePicksTier,
            line: row.prizePicksLine,
            recommendedSide: row.recommendedSide,
            edge: row.edge,
            confidenceScore: row.confidenceScore,
            marketGroupScore: row.marketGroupScore,
            rankEligible: row.rankEligible,
            rankEligibleReason: row.rankEligibleReason,
            disabledReason: row.disabledReason,
            projectionId: row.projectionId,
            rawStat: row.rawStat,
        });
    }

    const families = [];

    for (const fam of map.values()) {
        fam.variants.sort((a, b) => {
            return tierSortValue(a.tier) - tierSortValue(b.tier) || a.line - b.line;
        });

        const fullRows = rows.filter((r) => familyKey(r) === fam.familyKey);

        fam.standardVariants = sortVariantRows(fullRows.filter((r) => r.prizePicksTier === 'standard' && r.rankEligible));
        fam.goblinVariants = sortVariantRows(fullRows.filter((r) => r.prizePicksTier === 'goblin' && r.rankEligible));
        fam.demonVariants = sortVariantRows(fullRows.filter((r) => r.prizePicksTier === 'demon' && r.rankEligible));

        fam.bestStandardVariant = fam.standardVariants[0] || null;
        fam.bestGoblinVariant = fam.goblinVariants[0] || null;
        fam.bestDemonVariant = fam.demonVariants[0] || null;
        fam.bestAnyVariant = selectBestVariant(fullRows);
        fam.bestVariant = fam.bestStandardVariant;
        fam.safestVariant = selectSafestVariant(fullRows);

        fam.rankEligibleFamily = !!fam.bestStandardVariant;
        fam.rankEligibleGoblinFamily = !!fam.bestGoblinVariant;
        fam.rankEligibleDemonFamily = !!fam.bestDemonVariant;

        fam.familyScore = fam.bestStandardVariant?.marketGroupScore || fam.bestStandardVariant?.confidenceScore || 0;
        fam.goblinFamilyScore = fam.bestGoblinVariant?.marketGroupScore || fam.bestGoblinVariant?.confidenceScore || 0;
        fam.demonFamilyScore = fam.bestDemonVariant?.marketGroupScore || fam.bestDemonVariant?.confidenceScore || 0;

        fam.alternateStandardVariants = fam.standardVariants.slice(1).map(serializeVariant);
        fam.alternateGoblinVariants = fam.goblinVariants.slice(1).map(serializeVariant);
        fam.alternateDemonVariants = fam.demonVariants.slice(1).map(serializeVariant);

        const selectedProjectionIds = new Set([
            fam.bestStandardVariant?.projectionId,
            fam.bestGoblinVariant?.projectionId,
            fam.bestDemonVariant?.projectionId,
        ].filter(Boolean));

        fam.excludedVariants = fullRows
            .filter((r) => !r.rankEligible || !selectedProjectionIds.has(r.projectionId))
            .map((r) => ({
                tier: r.prizePicksTier,
                line: r.prizePicksLine,
                side: r.recommendedSide,
                edge: r.edge,
                confidenceScore: r.confidenceScore,
                marketGroupScore: r.marketGroupScore,
                projectionId: r.projectionId,
                rankEligible: r.rankEligible,
                rankEligibleReason: r.rankEligibleReason,
                disabledReason: r.rankEligible ? `alternate_${r.prizePicksTier}_variant` : r.disabledReason,
            }));

        families.push(fam);
    }

    return families;
}

function marketSummary(parsed, merged, unmatched) {
    const out = {};

    for (const r of parsed) {
        const m = r.market || 'unknown';
        out[m] ??= {
            prizeRows: 0,
            mergedRows: 0,
            rankEligibleRows: 0,
            disabledRows: 0,
            unmatchedRows: 0,
            matchRate: 0,
            rankEligibleRate: 0,
        };
        out[m].prizeRows++;
    }

    for (const r of merged) {
        const m = r.market || 'unknown';
        out[m] ??= {
            prizeRows: 0,
            mergedRows: 0,
            rankEligibleRows: 0,
            disabledRows: 0,
            unmatchedRows: 0,
            matchRate: 0,
            rankEligibleRate: 0,
        };

        out[m].mergedRows++;
        if (r.rankEligible) out[m].rankEligibleRows++;
        else out[m].disabledRows++;
    }

    for (const r of unmatched) {
        const m = r.market || 'unknown';
        out[m] ??= {
            prizeRows: 0,
            mergedRows: 0,
            rankEligibleRows: 0,
            disabledRows: 0,
            unmatchedRows: 0,
            matchRate: 0,
            rankEligibleRate: 0,
        };
        out[m].unmatchedRows++;
    }

    for (const m of Object.keys(out)) {
        out[m].matchRate = out[m].prizeRows
            ? Number((out[m].mergedRows / out[m].prizeRows).toFixed(4))
            : 0;

        out[m].rankEligibleRate = out[m].prizeRows
            ? Number((out[m].rankEligibleRows / out[m].prizeRows).toFixed(4))
            : 0;
    }

    return out;
}

function tabCounts(rows, unmatched) {
    const counts = {
        All: 0,
        Pitchers: 0,
        Hitters: 0,
        Ks: 0,
        Outs: 0,
        Hits: 0,
        Bases: 0,
        HRR: 0,
        'Runs/RBIs': 0,
        Demons: 0,
        Goblins: 0,
        Fallbacks: 0,
        Unmatched: unmatched.length,
        Disabled: 0,
    };

    for (const row of rows) {
        for (const tab of row.marketTabs || []) {
            counts[tab] ??= 0;
            counts[tab]++;
        }
    }

    return counts;
}

function serializeVariant(v) {
    return v ? {
        tier: v.prizePicksTier,
        line: v.prizePicksLine,
        side: v.recommendedSide,
        edge: v.edge,
        confidenceScore: v.confidenceScore,
        marketGroupScore: v.marketGroupScore,
        projectionId: v.projectionId,
    } : null;
}

function serializeStoredVariant(v) {
    return v ? {
        tier: v.tier,
        line: v.line,
        side: v.recommendedSide,
        edge: v.edge,
        confidenceScore: v.confidenceScore,
        marketGroupScore: v.marketGroupScore,
        projectionId: v.projectionId,
        rankEligible: v.rankEligible,
        disabledReason: v.disabledReason,
    } : null;
}

function rowFromFamily(f, variant, rank, recordType, tierBoard) {
    return {
        recordType,
        rank,
        tierBoard,
        familyKey: f.familyKey,
        playerName: f.playerName,
        team: f.team,
        opponent: f.opponent,
        market: f.market,
        tabs: f.marketTabs,
        modelProjection: f.modelProjection,
        modelProbability: f.modelProbability,
        modelType: f.modelType,
        familyScore: variant?.marketGroupScore || variant?.confidenceScore || 0,
        marketGroupScore: variant?.marketGroupScore || 0,
        bestVariant: serializeVariant(variant),
        bestStandardVariant: serializeVariant(f.bestStandardVariant),
        bestGoblinVariant: serializeVariant(f.bestGoblinVariant),
        bestDemonVariant: serializeVariant(f.bestDemonVariant),
        safestVariant: serializeVariant(f.safestVariant),
        alternateStandardVariants: f.alternateStandardVariants || [],
        alternateGoblinVariants: f.alternateGoblinVariants || [],
        alternateDemonVariants: f.alternateDemonVariants || [],
        allVariants: f.variants.map(serializeStoredVariant),
        excludedVariants: f.excludedVariants,
    };
}

function topTierRows(families, tier, limit, recordType) {
    const getter = {
        standard: (f) => f.bestStandardVariant,
        goblin: (f) => f.bestGoblinVariant,
        demon: (f) => f.bestDemonVariant,
        any: (f) => f.bestAnyVariant,
    }[tier];

    return families
        .map((f) => ({ family: f, variant: getter(f) }))
        .filter((x) => !!x.variant)
        .sort((a, b) => {
            const bs = b.variant.marketGroupScore || b.variant.confidenceScore || 0;
            const as = a.variant.marketGroupScore || a.variant.confidenceScore || 0;
            return bs - as;
        })
        .slice(0, limit)
        .map((x, i) => rowFromFamily(x.family, x.variant, i + 1, recordType, tier));
}

function topFilteredRows(families, limit, filterFn, recordType, tier = 'standard') {
    const getter = {
        standard: (f) => f.bestStandardVariant,
        goblin: (f) => f.bestGoblinVariant,
        demon: (f) => f.bestDemonVariant,
        any: (f) => f.bestAnyVariant,
    }[tier];

    return families
        .filter(filterFn)
        .map((f) => ({ family: f, variant: getter(f) }))
        .filter((x) => !!x.variant)
        .sort((a, b) => {
            const bs = b.variant.marketGroupScore || b.variant.confidenceScore || 0;
            const as = a.variant.marketGroupScore || a.variant.confidenceScore || 0;
            return bs - as;
        })
        .slice(0, limit)
        .map((x, i) => rowFromFamily(x.family, x.variant, i + 1, recordType, tier));
}

const prizeRaw = await getAllDatasetItems(prizePicksDatasetId, 'PrizePicks');
const ballparkRaw = await getAllDatasetItems(ballparkDatasetId, 'Ballpark Export');

if (savantDatasetId) await getAllDatasetItems(savantDatasetId, 'Savant');
if (vegasDatasetId) await getAllDatasetItems(vegasDatasetId, 'Vegas');

const parsedPrize = prizeRaw
    .map(extractPrize)
    .filter((r) => r.playerName && r.team && r.market && hasNum(r.line));

const { index, counts } = buildBallparkExportIndexes(ballparkRaw);

const merged = [];
const unmatched = [];

for (const pp of parsedPrize) {
    const bpResult = findBallparkMatch(pp, index);

    if (!bpResult.match) {
        unmatched.push({
            recordType: 'unmatched',
            mergeVersion: MERGE_VERSION,
            playerName: pp.playerName,
            team: pp.team,
            opponent: pp.opponent,
            market: pp.market,
            rawStat: pp.rawStat,
            line: pp.line,
            tier: pp.tier,
            matchType: bpResult.matchType,
            rankEligible: false,
            disabledReason: 'unmatched',
            marketTabs: ['Unmatched'],
            projectionId: pp.projectionId,
        });
        continue;
    }

    const row = buildMerged(pp, bpResult);
    merged.push(row);
}

const families = buildFamilies(merged);

const topStandard = topTierRows(families, 'standard', topLimit, 'top_family_play');
const topGoblin = topTierRows(families, 'goblin', topLimit, 'top_family_goblin');
const topDemon = topTierRows(families, 'demon', topLimit, 'top_family_demon');
const topAllVariants = topTierRows(families, 'any', topLimit, 'top_family_all_variants');

const topPitchers = topFilteredRows(
    families,
    topLimit,
    (f) => f.ballparkSourceType === 'pitcher',
    'top_family_pitchers',
    'standard'
);

const topHitters = topFilteredRows(
    families,
    topLimit,
    (f) => f.ballparkSourceType === 'batter',
    'top_family_hitters',
    'standard'
);

const topKs = topFilteredRows(families, topLimit, (f) => f.market === 'strikeouts', 'top_family_ks', 'standard');
const topOuts = topFilteredRows(families, topLimit, (f) => f.market === 'pitching_outs', 'top_family_outs', 'standard');
const topHits = topFilteredRows(families, topLimit, (f) => f.market === 'hits', 'top_family_hits', 'standard');
const topBases = topFilteredRows(families, topLimit, (f) => f.market === 'bases', 'top_family_bases', 'standard');
const topHrr = topFilteredRows(families, topLimit, (f) => f.market === 'hrr', 'top_family_hrr', 'standard');

const topRunsRbis = topFilteredRows(
    families,
    topLimit,
    (f) => ['runs', 'rbis'].includes(f.market),
    'top_family_runs_rbis',
    'standard'
);

const summary = {
    recordType: 'debug_summary',
    mergeVersion: MERGE_VERSION,

    prizeRows: prizeRaw.length,
    parsedPrizeRows: parsedPrize.length,

    ballparkRows: ballparkRaw.length,
    ballparkCounts: counts,

    mergedRows: merged.length,
    rankEligibleRows: merged.filter((r) => r.rankEligible).length,
    disabledRows: merged.filter((r) => !r.rankEligible).length,

    variantFamilies: families.length,
    rankEligibleFamilies: families.filter((f) => f.rankEligibleFamily).length,
    rankEligibleGoblinFamilies: families.filter((f) => f.rankEligibleGoblinFamily).length,
    rankEligibleDemonFamilies: families.filter((f) => f.rankEligibleDemonFamily).length,

    topFamilyRows: topStandard.length,
    topGoblinRows: topGoblin.length,
    topDemonRows: topDemon.length,
    topAllVariantRows: topAllVariants.length,
    unmatchedRows: unmatched.length,

    separatedTierBoards: {
        standardRecordType: 'top_family_play',
        goblinRecordType: 'top_family_goblin',
        demonRecordType: 'top_family_demon',
        allVariantsRecordType: 'top_family_all_variants',
    },

    topStandardMarketCounts: topStandard.reduce((acc, r) => {
        acc[r.market] = (acc[r.market] || 0) + 1;
        return acc;
    }, {}),

    topGoblinMarketCounts: topGoblin.reduce((acc, r) => {
        acc[r.market] = (acc[r.market] || 0) + 1;
        return acc;
    }, {}),

    topDemonMarketCounts: topDemon.reduce((acc, r) => {
        acc[r.market] = (acc[r.market] || 0) + 1;
        return acc;
    }, {}),

    excludedFromTopPlays: [...DISABLED_MARKETS.entries()].map(([market, reason]) => ({
        market,
        reason,
    })),

    rankEligibleMarkets: [...RANK_ELIGIBLE_MARKETS],

    tabCounts: tabCounts(merged, unmatched),

    matchRatesByMarket: marketSummary(parsedPrize, merged, unmatched),

    sampleTopStandard: topStandard.slice(0, debugSamples),
    sampleTopGoblins: topGoblin.slice(0, debugSamples),
    sampleTopDemons: topDemon.slice(0, debugSamples),

    sampleDisabled: merged
        .filter((r) => !r.rankEligible)
        .slice(0, debugSamples)
        .map((r) => ({
            playerName: r.playerName,
            team: r.team,
            market: r.market,
            tier: r.prizePicksTier,
            line: r.prizePicksLine,
            projection: r.modelProjection,
            edge: r.edge,
            disabledReason: r.disabledReason,
            matchType: r.matchType,
        })),

    sampleUnmatched: unmatched.slice(0, debugSamples),
};

await Actor.pushData(summary);

for (const row of topStandard) await Actor.pushData(row);
for (const row of topGoblin) await Actor.pushData(row);
for (const row of topDemon) await Actor.pushData(row);
for (const row of topAllVariants) await Actor.pushData(row);

for (const row of topPitchers) await Actor.pushData(row);
for (const row of topHitters) await Actor.pushData(row);
for (const row of topKs) await Actor.pushData(row);
for (const row of topOuts) await Actor.pushData(row);
for (const row of topHits) await Actor.pushData(row);
for (const row of topBases) await Actor.pushData(row);
for (const row of topHrr) await Actor.pushData(row);
for (const row of topRunsRbis) await Actor.pushData(row);

if (!onlyTop) {
    for (const row of families) await Actor.pushData(row);
    for (const row of merged) await Actor.pushData(row);
    for (const row of unmatched.slice(0, 1000)) await Actor.pushData(row);
}

log.info('MERGE COMPLETE', {
    version: MERGE_VERSION,
    mergedRows: merged.length,
    rankEligibleRows: merged.filter((r) => r.rankEligible).length,
    families: families.length,
    rankEligibleFamilies: families.filter((f) => f.rankEligibleFamily).length,
    topStandardRows: topStandard.length,
    topGoblinRows: topGoblin.length,
    topDemonRows: topDemon.length,
    unmatched: unmatched.length,
});

await Actor.exit();
