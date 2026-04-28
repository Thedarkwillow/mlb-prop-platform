// full v12.6-soft-gate src/main.js
// fixes v12.5 overfiltering by using soft probability gates
// keeps v12.4 diversity + v12.5 hitter boost / strikeout overload penalties

import { Actor, log } from 'apify';
import { ApifyClient } from 'apify-client';

await Actor.init();

log.info('SLIP BUILDER VERSION: v12.6-soft-gate');

const input = (await Actor.getInput()) || {};

const {
    boardDatasetId,

    topPerPool = 50,
    outputPerType = 25,

    minLegProbability = 0.505,

    maxSameGame = 2,
    maxSameTeamHitters = 2,

    maxPlayerExposurePerType = 5,
    maxAnchorReusePerType = 4,

    minSlipScore = 0,
} = input;

if (!boardDatasetId) {
    throw new Error('Missing boardDatasetId');
}

const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

async function getAll(datasetId) {
    const rows = [];
    let offset = 0;

    while (true) {
        const res = await client.dataset(datasetId).listItems({
            clean: true,
            limit: 1000,
            offset,
        });

        rows.push(...res.items);

        if (res.items.length < 1000) break;
        offset += 1000;
    }

    return rows;
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function clean(v) {
    return String(v ?? '').trim();
}

function lower(v) {
    return clean(v).toLowerCase();
}

function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function unique(arr) {
    return [...new Set(arr)];
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function countBy(arr, fn) {
    const out = {};
    for (const item of arr) {
        const key = fn(item);
        out[key] = (out[key] || 0) + 1;
    }
    return out;
}

function isPitcherMarket(market) {
    return [
        'strikeouts',
        'pitching_outs',
        'hits_allowed',
        'earned_runs_allowed',
    ].includes(market);
}

function isHitterMarket(market) {
    return !isPitcherMarket(market);
}

function isVolatileMarket(market) {
    return ['hr', 'hrr', 'rbis', 'runs'].includes(market);
}

function isStandardTopPlay(row) {
    return (
        row.recordType === 'top_family_play' &&
        row.bestVariant &&
        row.bestVariant.tier === 'standard' &&
        row.bestVariant.side &&
        row.bestVariant.side !== 'PUSH'
    );
}

function gameKey(leg) {
    const a = clean(leg.team);
    const b = clean(leg.opponent);
    if (!a && !b) return 'unknown';
    return [a, b].sort().join('_vs_');
}

function legKey(leg) {
    return [
        lower(leg.playerName),
        lower(leg.team),
        lower(leg.market),
        clean(leg.bestVariant?.line),
        lower(leg.bestVariant?.side),
    ].join('|');
}

function marketPrior(market) {
    const priors = {
        strikeouts: 0.54,
        pitching_outs: 0.54,
        hits_allowed: 0.53,
        earned_runs_allowed: 0.53,

        hits: 0.52,
        bases: 0.52,
        hrr: 0.50,
        runs: 0.49,
        rbis: 0.49,
        hr: 0.44,
    };

    return priors[market] ?? 0.50;
}

function marketVariancePenalty(market) {
    const penalties = {
        strikeouts: 0.01,
        pitching_outs: 0.015,
        hits_allowed: 0.02,
        earned_runs_allowed: 0.025,

        hits: 0.02,
        bases: 0.03,
        hrr: 0.04,
        runs: 0.05,
        rbis: 0.05,
        hr: 0.09,
    };

    return penalties[market] ?? 0.03;
}

function normalizeLeg(row) {
    const conf = num(row.bestVariant?.confidenceScore);
    const edge = num(row.bestVariant?.edge);
    const prior = marketPrior(row.market);
    const variance = marketVariancePenalty(row.market);

    const confSignal = clamp((conf - 1.0) * 0.12, -0.08, 0.08);
    const edgeSignal = clamp(edge * 0.02, -0.10, 0.10);

    let p = prior + confSignal + edgeSignal - variance;
    p = clamp(p, 0.35, 0.72);

    const ev = (p * 2) - 1;

    return {
        familyKey: row.familyKey,
        playerName: row.playerName,
        team: row.team,
        opponent: row.opponent,
        market: row.market,
        tabs: row.tabs || [],
        bestVariant: row.bestVariant,

        estimatedProbability: Number(p.toFixed(4)),
        estimatedEV: Number(ev.toFixed(4)),
        marketPrior: prior,
        marketVariancePenalty: variance,
    };
}

function dedupePool(rows) {
    const seen = new Set();
    const out = [];

    for (const row of rows) {
        const key = row.familyKey || `${row.playerName}|${row.team}|${row.market}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }

    return out;
}

const MARKET_CAPS = {
    strikeouts: 10,
    pitching_outs: 8,
    hits_allowed: 8,
    earned_runs_allowed: 6,

    bases: 14,
    hits: 10,
    hrr: 7,
    runs: 5,
    rbis: 5,
    hr: 3,
};

function softProbabilityPenalty(leg) {
    const p = leg.estimatedProbability;

    if (p >= 0.515) return 0;
    if (p >= 0.505) return 0.12;
    if (p >= 0.500) return 0.25;
    if (p >= 0.490) return 0.45;

    return 0.75;
}

function poolScore(leg, selectedMarketCounts = {}) {
    let score =
        leg.estimatedProbability * 10 +
        leg.estimatedEV * 6 -
        leg.marketVariancePenalty * 8 -
        softProbabilityPenalty(leg);

    if (isHitterMarket(leg.market)) score += 0.2;

    if (
        ['bases', 'hits', 'hrr'].includes(leg.market) &&
        leg.estimatedEV > 0
    ) {
        score += 0.2;
    }

    if (leg.market === 'strikeouts') {
        score -= 0.18;

        const already = selectedMarketCounts.strikeouts || 0;
        if (already >= 6) score -= (already - 5) * 0.18;
    }

    if (leg.bestVariant?.side === 'LESS' && isPitcherMarket(leg.market)) {
        score -= 0.08;
    }

    if (isVolatileMarket(leg.market)) {
        score -= 0.12;
    }

    return score;
}

function buildDiversifiedPool(allLegs, targetSize) {
    const selected = [];
    const marketCounts = {};
    const playerSeen = new Set();

    const eligible = allLegs
        .filter((x) => x.estimatedProbability >= minLegProbability)
        .sort((a, b) => poolScore(b) - poolScore(a));

    const softBackup = allLegs
        .filter((x) => x.estimatedProbability < minLegProbability)
        .sort((a, b) => poolScore(b) - poolScore(a));

    const minHitters = Math.floor(targetSize * 0.38);
    const minPitchers = Math.floor(targetSize * 0.32);

    function canAdd(leg) {
        const playerKey = lower(leg.playerName);
        if (playerSeen.has(playerKey)) return false;

        const cap = MARKET_CAPS[leg.market] ?? 5;
        if ((marketCounts[leg.market] || 0) >= cap) return false;

        return true;
    }

    function addLeg(leg) {
        selected.push(leg);
        playerSeen.add(lower(leg.playerName));
        marketCounts[leg.market] = (marketCounts[leg.market] || 0) + 1;
    }

    const hitterLegs = eligible
        .filter((x) => isHitterMarket(x.market))
        .sort((a, b) => poolScore(b, marketCounts) - poolScore(a, marketCounts));

    for (const leg of hitterLegs) {
        if (selected.length >= targetSize) break;
        if (selected.filter((x) => isHitterMarket(x.market)).length >= minHitters) break;
        if (canAdd(leg)) addLeg(leg);
    }

    const pitcherLegs = eligible
        .filter((x) => isPitcherMarket(x.market))
        .sort((a, b) => poolScore(b, marketCounts) - poolScore(a, marketCounts));

    for (const leg of pitcherLegs) {
        if (selected.length >= targetSize) break;
        if (selected.filter((x) => isPitcherMarket(x.market)).length >= minPitchers) break;
        if (canAdd(leg)) addLeg(leg);
    }

    const remaining = eligible
        .slice()
        .sort((a, b) => poolScore(b, marketCounts) - poolScore(a, marketCounts));

    for (const leg of remaining) {
        if (selected.length >= targetSize) break;
        if (canAdd(leg)) addLeg(leg);
    }

    // Soft backup fills the board only if the probability gate made the pool too small.
    for (const leg of softBackup) {
        if (selected.length >= targetSize) break;
        if (selected.length >= Math.floor(targetSize * 0.8)) break;
        if (canAdd(leg)) addLeg(leg);
    }

    return selected.sort((a, b) => poolScore(b, marketCounts) - poolScore(a, marketCounts));
}

function hardConflict(a, b) {
    if (a.playerName === b.playerName) return true;
    if (a.familyKey && b.familyKey && a.familyKey === b.familyKey) return true;
    if (legKey(a) === legKey(b)) return true;
    return false;
}

function validCombo(legs) {
    for (let i = 0; i < legs.length; i++) {
        for (let j = i + 1; j < legs.length; j++) {
            if (hardConflict(legs[i], legs[j])) return false;
        }
    }

    const games = countBy(legs, gameKey);
    const hitterTeams = {};

    for (const leg of legs) {
        if (isHitterMarket(leg.market)) {
            hitterTeams[leg.team] = (hitterTeams[leg.team] || 0) + 1;
        }
    }

    for (const count of Object.values(games)) {
        if (count > maxSameGame + 1) return false;
    }

    for (const count of Object.values(hitterTeams)) {
        if (count > maxSameTeamHitters + 1) return false;
    }

    return true;
}

function correlationPenalty(legs) {
    let penalty = 0;

    const games = countBy(legs, gameKey);
    const markets = countBy(legs, (x) => x.market);

    for (const count of Object.values(games)) {
        if (count > maxSameGame) penalty += (count - maxSameGame) * 0.08;
    }

    for (const count of Object.values(markets)) {
        if (count >= 3) penalty += (count - 2) * 0.07;
    }

    const pitcherUnders = legs.filter(
        (x) => isPitcherMarket(x.market) && x.bestVariant?.side === 'LESS'
    ).length;

    if (pitcherUnders >= 3) {
        penalty += (pitcherUnders - 2) * 0.1;
    }

    const strikeouts = legs.filter((x) => x.market === 'strikeouts').length;
    if (strikeouts >= 3) {
        penalty += (strikeouts - 2) * 0.09;
    }

    const lowProbLegs = legs.filter((x) => x.estimatedProbability < minLegProbability).length;
    if (lowProbLegs > 0) {
        penalty += lowProbLegs * 0.08;
    }

    for (let i = 0; i < legs.length; i++) {
        for (let j = i + 1; j < legs.length; j++) {
            if (gameKey(legs[i]) === gameKey(legs[j])) {
                penalty += 0.015;
            }
        }
    }

    return penalty;
}

function marketDiversityScore(legs) {
    return unique(legs.map((x) => x.market)).length / legs.length;
}

function gameDiversityScore(legs) {
    return unique(legs.map(gameKey)).length / legs.length;
}

function riskLevel(legs) {
    const avgP = avg(legs.map((x) => x.estimatedProbability));
    const vol = legs.filter((x) => isVolatileMarket(x.market)).length;
    const lowProbLegs = legs.filter((x) => x.estimatedProbability < minLegProbability).length;

    if (avgP >= 0.565 && vol === 0 && lowProbLegs === 0) return 'low';
    if (avgP >= 0.535 && vol <= 1 && lowProbLegs <= 1) return 'medium';
    return 'high';
}

function scoreSlip(legs, slipType) {
    const avgProb = avg(legs.map((x) => x.estimatedProbability));
    const avgEV = avg(legs.map((x) => x.estimatedEV));
    const avgVar = avg(legs.map((x) => x.marketVariancePenalty));

    const corr = correlationPenalty(legs);
    const marketDiv = marketDiversityScore(legs);
    const gameDiv = gameDiversityScore(legs);

    const volatileLegs = legs.filter((x) => isVolatileMarket(x.market)).length;
    const pitcherLegs = legs.filter((x) => isPitcherMarket(x.market)).length;
    const hitterLegs = legs.filter((x) => isHitterMarket(x.market)).length;
    const strikeoutLegs = legs.filter((x) => x.market === 'strikeouts').length;
    const lowProbLegs = legs.filter((x) => x.estimatedProbability < minLegProbability).length;

    let score =
        avgProb * 6.1 +
        avgEV * 3.6 +
        marketDiv * 1.55 +
        gameDiv * 0.95 -
        avgVar * 6.0 -
        corr * 8.0 -
        volatileLegs * 0.15 -
        lowProbLegs * 0.18;

    if (pitcherLegs > 0 && hitterLegs > 0) score += 0.42;
    if (hitterLegs >= 2) score += 0.12;
    if (strikeoutLegs >= 3) score -= 0.25;

    if (slipType.includes('flex')) score += avgProb * 0.8;
    if (slipType.includes('power')) score += avgEV * 0.7;

    return {
        slipScore: Number(score.toFixed(3)),
        avgProbability: Number(avgProb.toFixed(4)),
        avgEV: Number(avgEV.toFixed(4)),
        avgVariancePenalty: Number(avgVar.toFixed(4)),
        riskLevel: riskLevel(legs),
        correlationPenalty: Number(corr.toFixed(4)),
        marketDiversityScore: Number(marketDiv.toFixed(4)),
        gameDiversityScore: Number(gameDiv.toFixed(4)),
        pitcherLegs,
        hitterLegs,
        volatileLegs,
        strikeoutLegs,
        lowProbabilityLegs: lowProbLegs,
    };
}

function combinationsLimited(arr, k, maxRaw = 150000) {
    const out = [];
    const path = [];

    function walk(start) {
        if (out.length >= maxRaw) return;

        if (path.length === k) {
            out.push([...path]);
            return;
        }

        for (let i = start; i < arr.length; i++) {
            path.push(arr[i]);
            walk(i + 1);
            path.pop();

            if (out.length >= maxRaw) return;
        }
    }

    walk(0);
    return out;
}

function buildSlipRecord(type, legs, rank) {
    const scored = scoreSlip(legs, type);

    return {
        recordType: type,
        rank,
        size: legs.length,
        ...scored,
        anchorPlayer: legs[0]?.playerName || null,
        legs: legs.map((x) => ({
            playerName: x.playerName,
            team: x.team,
            opponent: x.opponent,
            market: x.market,
            line: x.bestVariant?.line,
            side: x.bestVariant?.side,
            estimatedProbability: x.estimatedProbability,
            estimatedEV: x.estimatedEV,
            marketPrior: x.marketPrior,
            marketVariancePenalty: x.marketVariancePenalty,
        })),
    };
}

function selectWithExposure(scored, limit) {
    const selected = [];
    const playerExposure = {};
    const anchorExposure = {};

    for (const slip of scored) {
        if (selected.length >= limit) break;
        if (slip.slipScore < minSlipScore) continue;

        const players = unique(slip.legs.map((x) => lower(x.playerName)));
        const anchor = lower(slip.anchorPlayer);

        let blocked = false;

        for (const p of players) {
            if ((playerExposure[p] || 0) >= maxPlayerExposurePerType) {
                blocked = true;
                break;
            }
        }

        if ((anchorExposure[anchor] || 0) >= maxAnchorReusePerType) {
            blocked = true;
        }

        if (blocked) continue;

        selected.push({
            ...slip,
            rank: selected.length + 1,
        });

        for (const p of players) {
            playerExposure[p] = (playerExposure[p] || 0) + 1;
        }

        anchorExposure[anchor] = (anchorExposure[anchor] || 0) + 1;
    }

    return selected;
}

function buildBest(pool, size, typeName, limit = outputPerType) {
    const maxRaw =
        size <= 3 ? 150000 :
        size === 4 ? 200000 :
        250000;

    const scored = combinationsLimited(pool, size, maxRaw)
        .filter(validCombo)
        .map((legs) => buildSlipRecord(typeName, legs, 0))
        .sort((a, b) => {
            if (b.slipScore !== a.slipScore) return b.slipScore - a.slipScore;
            if (b.avgProbability !== a.avgProbability) return b.avgProbability - a.avgProbability;
            return b.avgEV - a.avgEV;
        });

    return selectWithExposure(scored, limit);
}

const dataset = await getAll(boardDatasetId);

const allLegsRaw = dedupePool(
    dataset
        .filter(isStandardTopPlay)
        .map(normalizeLeg)
        .sort((a, b) => poolScore(b) - poolScore(a))
);

const allLegsAfterSoftFloor = allLegsRaw.filter((x) => x.estimatedProbability >= 0.49);

const pool = buildDiversifiedPool(allLegsAfterSoftFloor, topPerPool);

log.info('Loaded soft-gate probability pool', {
    totalRows: dataset.length,
    availableLegsRaw: allLegsRaw.length,
    availableLegsAfterSoftFloor: allLegsAfterSoftFloor.length,
    candidatePool: pool.length,
    hitters: pool.filter((x) => isHitterMarket(x.market)).length,
    pitchers: pool.filter((x) => isPitcherMarket(x.market)).length,
});

const best2 = buildBest(pool, 2, 'best_2_man');
const best3Power = buildBest(pool, 3, 'best_3_man_power');
const best3Flex = buildBest(pool, 3, 'best_3_man_flex');
const best4Power = buildBest(pool, 4, 'best_4_man_power');
const best4Flex = buildBest(pool, 4, 'best_4_man_flex');
const best5Power = buildBest(pool, 5, 'best_5_man_power');
const best5Flex = buildBest(pool, 5, 'best_5_man_flex');
const best6Power = buildBest(pool, 6, 'best_6_man_power');
const best6Flex = buildBest(pool, 6, 'best_6_man_flex');

const all = [
    ...best2,
    ...best3Power,
    ...best3Flex,
    ...best4Power,
    ...best4Flex,
    ...best5Power,
    ...best5Flex,
    ...best6Power,
    ...best6Flex,
];

const safe = all
    .filter((x) => x.riskLevel === 'low')
    .sort((a, b) => b.slipScore - a.slipScore)
    .slice(0, outputPerType)
    .map((x, i) => ({
        ...x,
        recordType: 'best_safe_slip',
        rank: i + 1,
    }));

const aggressive = all
    .filter((x) => x.riskLevel !== 'low')
    .sort((a, b) => b.slipScore - a.slipScore)
    .slice(0, outputPerType)
    .map((x, i) => ({
        ...x,
        recordType: 'best_aggressive_slip',
        rank: i + 1,
    }));

const summary = {
    recordType: 'slip_debug_summary',
    version: 'v12.6-soft-gate',
    boardDatasetId,
    totalBoardRows: dataset.length,
    availableLegsRaw: allLegsRaw.length,
    availableLegsAfterSoftFloor: allLegsAfterSoftFloor.length,
    candidatePool: pool.length,
    poolBreakdown: {
        hitters: pool.filter((x) => isHitterMarket(x.market)).length,
        pitchers: pool.filter((x) => isPitcherMarket(x.market)).length,
        markets: countBy(pool, (x) => x.market),
        sides: countBy(pool, (x) => x.bestVariant?.side),
        lowProbabilityLegs: pool.filter((x) => x.estimatedProbability < minLegProbability).length,
    },
    settings: {
        topPerPool,
        outputPerType,
        minLegProbability,
        maxSameGame,
        maxSameTeamHitters,
        maxPlayerExposurePerType,
        maxAnchorReusePerType,
        minSlipScore,
    },
    poolPreview: pool.slice(0, 30).map((x) => ({
        playerName: x.playerName,
        team: x.team,
        opponent: x.opponent,
        market: x.market,
        side: x.bestVariant?.side,
        line: x.bestVariant?.line,
        estimatedProbability: x.estimatedProbability,
        estimatedEV: x.estimatedEV,
        poolScore: Number(poolScore(x).toFixed(4)),
        lowProbabilityFlag: x.estimatedProbability < minLegProbability,
    })),
    outputs: {
        best_2_man: best2.length,
        best_3_man_power: best3Power.length,
        best_3_man_flex: best3Flex.length,
        best_4_man_power: best4Power.length,
        best_4_man_flex: best4Flex.length,
        best_5_man_power: best5Power.length,
        best_5_man_flex: best5Flex.length,
        best_6_man_power: best6Power.length,
        best_6_man_flex: best6Flex.length,
        best_safe_slip: safe.length,
        best_aggressive_slip: aggressive.length,
    },
};

await Actor.pushData([
    summary,
    ...best2,
    ...best3Power,
    ...best3Flex,
    ...best4Power,
    ...best4Flex,
    ...best5Power,
    ...best5Flex,
    ...best6Power,
    ...best6Flex,
    ...safe,
    ...aggressive,
]);

log.info('SLIP BUILDER COMPLETE', {
    version: 'v12.6-soft-gate',
    candidatePool: pool.length,
});

await Actor.exit();