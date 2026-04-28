import fs from 'fs';

const board = JSON.parse(fs.readFileSync('outputs/merged-board.json', 'utf8'));

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validMarket(stat) {
  const s = (stat || '').toLowerCase();
  return (
    s.includes('hits') ||
    s.includes('bases') ||
    s.includes('home run') ||
    s.includes('strikeout') ||
    s.includes('rbi')
  );
}

function scoreLeg(row) {
  let score = 0;

  if (row.ballpark) score += 3;
  if (row.oddsTier === 'standard') score += 2;

  if (row.ballpark?.hits) score += 1;
  if (row.ballpark?.bases) score += 1;
  if (row.ballpark?.strikeouts) score += 1;

  return score;
}

// filter hard
const candidates = board
  .filter(r => r.player)
  .filter(r => r.ballpark) // REQUIRE MATCH
  .filter(r => r.oddsTier === 'standard')
  .filter(r => validMarket(r.stat))
  .map(r => ({
    ...r,
    legScore: scoreLeg(r),
  }))
  .sort((a, b) => b.legScore - a.legScore);

// remove duplicate players
const unique = [];
const seen = new Set();

for (const leg of candidates) {
  if (!seen.has(leg.player)) {
    unique.push(leg);
    seen.add(leg.player);
  }
}

const legs = unique.slice(0, 50);

function makeSlip(size) {
  const chosen = legs.slice(0, size);

  return {
    recordType: `best_${size}_man`,
    size,
    slipScore: Number(
      (chosen.reduce((sum, l) => sum + l.legScore, 0) / size).toFixed(3)
    ),
    legs: chosen,
  };
}

const slips = [
  {
    recordType: 'slip_summary',
    version: 'local-v2-quality',
    boardRows: board.length,
    candidates: candidates.length,
    uniquePlayers: unique.length,
    createdAt: new Date().toISOString(),
  },
  makeSlip(2),
  makeSlip(3),
  makeSlip(4),
  makeSlip(5),
  makeSlip(6),
];

fs.writeFileSync('outputs/slips.json', JSON.stringify(slips, null, 2));

console.log(`Candidates: ${candidates.length}`);
console.log(`Unique players: ${unique.length}`);
console.log('Saved outputs/slips.json');
