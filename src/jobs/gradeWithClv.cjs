const fs = require('fs');

const HISTORY_PATH = 'outputs/pp_history.json';
const SLIPS_PATH = 'outputs/slips.json';

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeStat(stat) {
  const s = String(stat || '').toLowerCase();

  if (s.includes('strike')) return 'strikeouts';
  if (s.includes('outs')) return 'outs';
  if (s.includes('bases')) return 'bases';
  if (s.includes('rbi')) return 'rbis';
  if (s.includes('run')) return 'runs';
  if (s.includes('hit')) return 'hits';

  return normalize(s);
}

function normalizeSide(side) {
  const s = String(side || '').toUpperCase();

  if (s === 'LESS') return 'UNDER';
  if (s === 'MORE') return 'OVER';

  return s;
}

function buildKey(leg) {
  return [
    normalize(leg.player),
    normalizeStat(leg.stat),
    normalizeSide(leg.side)
  ].join('|');
}

function main() {
  const history = read(HISTORY_PATH);
  const slips = read(SLIPS_PATH);

  if (!history.length || !slips.length) {
    console.log('No data');
    return;
  }

  const open = history[0].snapshot;
  const latest = history[history.length - 1].snapshot;

  const openMap = new Map(open.map(p => [p.key, p]));
  const latestMap = new Map(latest.map(p => [p.key, p]));

  let total = 0;
  let clvSum = 0;

  for (const slip of slips) {
    for (const leg of slip.legs) {
      const k = buildKey(leg);

      const o = openMap.get(k);
      const c = latestMap.get(k);

      if (!o || !c) {
        console.log('NO MATCH:', leg.player, leg.stat, leg.side);
        continue;
      }

      const rawMove = c.line - o.line;

      let sideClv = rawMove;

      if (normalizeSide(leg.side) === 'UNDER') {
        sideClv = -rawMove;
      }

      clvSum += sideClv;
      total++;
    }
  }

  console.log('\nCLV REPORT');
  console.log('Legs:', total);
  console.log('Avg CLV:', total ? (clvSum / total).toFixed(3) : 0);
}

main();
