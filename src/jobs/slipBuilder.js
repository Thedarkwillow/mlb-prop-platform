import fs from 'fs';

const PRICED_FILE = 'outputs/priced-board.json';
const FALLBACK_FILE = 'outputs/merged-board.json';
const OUT_FILE = 'outputs/slips.json';

const MIN_PROB = Number(process.env.MIN_PROB || 0.85);
const MIN_EV = Number(process.env.MIN_EV || 1.2);
const MAX_PER_GAME = Number(process.env.MAX_PER_GAME || 2);
const MAX_PER_TEAM = Number(process.env.MAX_PER_TEAM || 3);

function clean(v) {
  return String(v ?? '').trim();
}

function norm(v) {
  return clean(v).toLowerCase();
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function loadBoard() {
  if (fs.existsSync(PRICED_FILE)) {
    console.log(`Using ${PRICED_FILE}`);
    return JSON.parse(fs.readFileSync(PRICED_FILE, 'utf8'));
  }

  console.log(`Using fallback ${FALLBACK_FILE}`);
  return JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8'));
}

function bucketRank(bucket) {
  if (bucket === 'elite') return 5;
  if (bucket === 'strong') return 4;
  if (bucket === 'playable') return 3;
  if (bucket === 'lean') return 2;
  return 1;
}

function marketRisk(market) {
  if (market === 'hits') return 1;
  if (market === 'strikeouts') return 1.1;
  if (market === 'hrr') return 1.25;
  if (market === 'bases') return 1.35;
  if (market === 'runs') return 1.4;
  if (market === 'rbis') return 1.45;
  if (market === 'hr') return 2;
  return 1.5;
}

function legScore(row) {
  const prob = num(row.recommendedProb, 0.5);
  const ev = num(row.expectedValue, 0);
  const bucket = bucketRank(row.confidenceBucket);

  return (
    ev * 100 +
    prob * 50 +
    bucket * 10 -
    marketRisk(row.market) * 5
  );
}

function isEligible(row) {
  if (row.recordType !== 'merged_prop') return false;

  if (row.pricingStatus && row.pricingStatus !== 'PRICED') return false;

  const prob = num(row.recommendedProb, 0);
  const ev = num(row.expectedValue, -999);

  if (prob < MIN_PROB) return false;
  if (ev < MIN_EV) return false;

  if (!row.player || !row.stat || row.line === undefined || row.line === null) return false;
  if (!row.recommendedSide) return false;

  // Avoid goblins for now unless explicitly enabled
  if (row.oddsTier === 'goblin' && process.env.ALLOW_GOBLINS !== '1') return false;

  return true;
}

function samePlayerKey(row) {
  return norm(row.player);
}

function gameKey(row) {
  return clean(row.game || row.gamePk || `${row.team}-${row.startTime}`);
}

function teamKey(row) {
  return clean(row.team);
}

function conflictsWithSlip(row, slip) {
  const player = samePlayerKey(row);
  const game = gameKey(row);
  const team = teamKey(row);

  const players = new Set(slip.map(samePlayerKey));
  if (players.has(player)) return true;

  const gameCount = slip.filter(x => gameKey(x) === game).length;
  if (gameCount >= MAX_PER_GAME) return true;

  const teamCount = slip.filter(x => teamKey(x) === team).length;
  if (teamCount >= MAX_PER_TEAM) return true;

  // Avoid stacking batter market overlap from same player already covered above,
  // and avoid too many correlated HRR/TB same game combos.
  const hrrTbSameGame = slip.filter(
    x => gameKey(x) === game && ['hrr', 'bases'].includes(x.market)
  ).length;

  if (['hrr', 'bases'].includes(row.market) && hrrTbSameGame >= 2) return true;

  return false;
}

function buildSlip(candidates, size) {
  const slip = [];

  for (const row of candidates) {
    if (slip.length >= size) break;
    if (conflictsWithSlip(row, slip)) continue;

    slip.push(row);
  }

  return slip;
}

function avg(rows, field) {
  if (!rows.length) return 0;
  return rows.reduce((sum, r) => sum + num(r[field], 0), 0) / rows.length;
}

function round(n, d = 3) {
  return Number(Number(n).toFixed(d));
}

function simplifyLeg(row) {
  return {
    recordType: 'slip_leg',
    player: row.player,
    team: row.team,
    market: row.market,
    stat: row.stat,
    line: row.line,
    oddsTier: row.oddsTier,
    side: row.recommendedSide,
    projection: row.projection,
    edge: row.edge,
    probability: row.recommendedProb,
    expectedValue: row.expectedValue,
    confidenceBucket: row.confidenceBucket,
    sourceType: row.sourceType,
    game: row.game,
    gamePk: row.gamePk,
    startTime: row.startTime,
  };
}

function main() {
  const board = loadBoard();

  const candidates = board
    .filter(isEligible)
    .map(row => ({
      ...row,
      _score: legScore(row),
    }))
    .sort((a, b) => b._score - a._score);

  const uniquePlayers = new Set(candidates.map(samePlayerKey)).size;

  const output = [
    {
      recordType: 'slip_summary',
      version: 'ev-v1',
      createdAt: new Date().toISOString(),
      sourceFile: fs.existsSync(PRICED_FILE) ? PRICED_FILE : FALLBACK_FILE,
      totalBoardRows: board.length,
      candidateLegs: candidates.length,
      uniquePlayers,
      filters: {
        minProb: MIN_PROB,
        minEV: MIN_EV,
        maxPerGame: MAX_PER_GAME,
        maxPerTeam: MAX_PER_TEAM,
        allowGoblins: process.env.ALLOW_GOBLINS === '1',
      },
      topMarkets: Object.entries(
        candidates.reduce((acc, r) => {
          acc[r.market] = (acc[r.market] || 0) + 1;
          return acc;
        }, {})
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([market, count]) => ({ market, count })),
    },
  ];

  for (const size of [2, 3, 4, 5, 6]) {
    const legs = buildSlip(candidates, size);

    output.push({
      recordType: `best_${size}_man`,
      size,
      complete: legs.length === size,
      avgProb: round(avg(legs, 'recommendedProb')),
      avgEV: round(avg(legs, 'expectedValue')),
      avgEdge: round(avg(legs, 'edge')),
      slipScore: round(avg(legs, '_score')),
      legs: legs.map(simplifyLeg),
    });
  }

  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log(`Candidates: ${candidates.length}`);
  console.log(`Unique players: ${uniquePlayers}`);
  console.log(`Saved ${OUT_FILE}`);
}

main();
