
import fs from 'fs';

const board = JSON.parse(fs.readFileSync('outputs/merged-board.json', 'utf-8'));

// --- CONFIG ---
const MIN_EDGE = 0.15;
const MAX_SAME_GAME = 2;
const MAX_SAME_MARKET = 2;
const MAX_SAME_PLAYER = 1;

// --- FILTER VALID ---
const candidates = board.filter(p =>
    p.recordType === 'merged_prop' &&
    p.edge !== undefined &&
    p.edge >= MIN_EDGE
);

// --- SCORE ---
candidates.forEach(p => {
    const projection = p.projection || 0;
    const edge = p.edge || 0;

    // weighted score (you can tune this later)
    p.score = edge * 2 + projection * 0.5;
});

// --- SORT BEST FIRST ---
candidates.sort((a, b) => b.score - a.score);

// --- BUILD SLIP FUNCTION ---
function buildSlip(size) {
    const slip = [];

    const gameCount = {};
    const marketCount = {};
    const playerCount = {};

    for (const p of candidates) {
        if (slip.length >= size) break;

        const game = p.game || 'unknown';
        const market = p.market || 'unknown';
        const player = p.player;

        if ((gameCount[game] || 0) >= MAX_SAME_GAME) continue;
        if ((marketCount[market] || 0) >= MAX_SAME_MARKET) continue;
        if ((playerCount[player] || 0) >= MAX_SAME_PLAYER) continue;

        slip.push(p);

        gameCount[game] = (gameCount[game] || 0) + 1;
        marketCount[market] = (marketCount[market] || 0) + 1;
        playerCount[player] = (playerCount[player] || 0) + 1;
    }

    const avgEdge =
        slip.length > 0
            ? slip.reduce((sum, p) => sum + p.edge, 0) / slip.length
            : 0;

    return {
        recordType: `best_${size}_man`,
        size,
        avgEdge: Number(avgEdge.toFixed(3)),
        legs: slip
    };
}

// --- BUILD ALL SLIPS ---
const output = [
    {
        recordType: 'slip_summary',
        candidates: candidates.length,
        createdAt: new Date().toISOString()
    },
    buildSlip(2),
    buildSlip(3),
    buildSlip(4),
    buildSlip(5),
    buildSlip(6)
];

// --- SAVE ---
fs.writeFileSync('outputs/slips.json', JSON.stringify(output, null, 2));

console.log(`Candidates: ${candidates.length}`);
console.log('Saved outputs/slips.json');
