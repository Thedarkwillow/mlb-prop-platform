import fs from 'fs';

const board = JSON.parse(fs.readFileSync('outputs/merged-board.json', 'utf8'));

function validMarket(m) {
  return ['hits','bases','hrr','hr','rbis','runs','strikeouts'].includes(m);
}

// filter
const pool = board
  .filter(r => r.ballpark)
  .filter(r => r.market && validMarket(r.market))
  .filter(r => r.oddsTier === 'standard')
  .filter(r => r.edge !== null);

// rank by edge
const ranked = pool.sort((a,b) => b.edge - a.edge);

// build slips with constraints
function buildSlip(size) {
  const slip = [];
  const players = new Set();
  const teams = {};
  const games = {};

  for (const leg of ranked) {
    if (slip.length >= size) break;

    const player = leg.player;
    const team = leg.team;
    const game = leg.ballpark?.gamePk;

    if (players.has(player)) continue;

    teams[team] = (teams[team] || 0);
    if (teams[team] >= 2) continue;

    games[game] = (games[game] || 0);
    if (games[game] >= 2) continue;

    slip.push(leg);
    players.add(player);
    teams[team]++;
    games[game]++;
  }

  return {
    recordType: `best_${size}_man`,
    size,
    avgEdge: Number((slip.reduce((s,l)=>s+l.edge,0)/slip.length).toFixed(3)),
    legs: slip
  };
}

const slips = [
  {
    recordType: 'slip_summary',
    version: 'local-v3-constraints',
    candidates: pool.length,
    createdAt: new Date().toISOString()
  },
  buildSlip(2),
  buildSlip(3),
  buildSlip(4),
  buildSlip(5),
  buildSlip(6)
];

fs.writeFileSync('outputs/slips.json', JSON.stringify(slips,null,2));

console.log(`Candidates: ${pool.length}`);
console.log('Saved outputs/slips.json');
