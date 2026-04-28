import fs from 'fs';

const board = JSON.parse(fs.readFileSync('outputs/merged-board.json', 'utf8'));

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function scoreLeg(row) {
  const line = num(row.line);
  let score = 0;

  if (row.ballpark) score += 2;
  if (line !== null) score += 1;
  if (row.oddsTier === 'standard') score += 1;
  if (row.ballpark?.hits || row.ballpark?.bases || row.ballpark?.strikeouts) score += 1;

  return score;
}

const legs = board
  .filter(r => r.player && r.stat && r.line !== null)
  .map(r => ({
    ...r,
    legScore: scoreLeg(r),
  }))
  .sort((a, b) => b.legScore - a.legScore)
  .slice(0, 50);

function makeSlip(size) {
  return {
    recordType: `best_${size}_man`,
    size,
    slipScore: Number(
      (legs.slice(0, size).reduce((sum, l) => sum + l.legScore, 0) / size).toFixed(3)
    ),
    legs: legs.slice(0, size),
  };
}

const slips = [
  {
    recordType: 'slip_debug_summary',
    version: 'local-v1',
    boardRows: board.length,
    candidateLegs: legs.length,
    createdAt: new Date().toISOString(),
  },
  makeSlip(2),
  makeSlip(3),
  makeSlip(4),
  makeSlip(5),
  makeSlip(6),
];

fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/slips.json', JSON.stringify(slips, null, 2));

console.log(`Candidate legs: ${legs.length}`);
console.log('Saved outputs/slips.json');
