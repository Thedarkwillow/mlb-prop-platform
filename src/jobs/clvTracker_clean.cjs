const fs = require('fs');

const BOARD_PATH = 'outputs/priced-board.json';
const HISTORY_PATH = 'outputs/pp_history.json';

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeStat(stat, market) {
  const s = String(stat || market || '').toLowerCase();

  if (s.includes('strike')) return 'strikeouts';
  if (s.includes('pitchingouts') || s.includes('outs')) return 'outs';
  if (s.includes('total bases') || s.includes('bases')) return 'bases';
  if (s.includes('hits+runs+rbis') || s.includes('hrr')) return 'hrr';
  if (s.includes('rbi')) return 'rbis';
  if (s.includes('run')) return 'runs';
  if (s.includes('hit')) return 'hits';

  return normalize(s);
}

function normalizeSide(row) {
  const raw = row.side || row.recommendedSide;

  if (!raw) return '';

  const s = String(raw).toUpperCase().trim();

  if (s === 'LESS') return 'UNDER';
  if (s === 'MORE') return 'OVER';

  return s;
}

function key(row) {
  return [
    normalize(row.player),
    normalizeStat(row.stat, row.market),
    normalizeSide(row)
  ].join('|');
}

function main() {
  const board = read(BOARD_PATH, []);
  const history = read(HISTORY_PATH, []);

  const timestamp = new Date().toISOString();

  const snapshot = board
    .filter(r => r.recordType === 'merged_prop')
    .map(r => ({
      key: key(r),
      player: r.player,
      stat: normalizeStat(r.stat, r.market),
      side: normalizeSide(r),
      line: Number(r.line),
      timestamp
    }))
    .filter(r => r.player && r.stat && r.side && Number.isFinite(r.line));

  history.push({ timestamp, snapshot });

  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

  console.log(`Saved snapshot: ${snapshot.length} props`);
  console.log(`Total snapshots: ${history.length}`);
  console.log('Sample:', snapshot[0]);
}

main();
