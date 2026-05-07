import fs from 'fs';

const BOARD = 'outputs/priced-board.json';
const VEGAS = 'data/vegas-latest.json';

function read(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function k(v) {
  return String(v || '').toLowerCase().trim();
}

function statKey(v) {
  const s = k(v);
  if (s.includes('strikeout')) return 'strikeouts';
  if (s.includes('total bases') || s === 'bases') return 'bases';
  if (s === 'hits' || s.includes('batter hits')) return 'hits';
  if (s === 'runs') return 'runs';
  if (s === 'rbis' || s === 'rbi') return 'rbis';
  return s;
}

function side(row) {
  const s = k(row.recommendedSide || row.side || row.pick || row.direction);
  if (s === 'less') return 'UNDER';
  if (s === 'more') return 'OVER';
  if (s === 'under') return 'UNDER';
  if (s === 'over') return 'OVER';
  return null;
}

function implied(odds) {
  const o = n(odds);
  if (o === null) return null;
  if (o < 0) return Math.abs(o) / (Math.abs(o) + 100);
  return 100 / (o + 100);
}

function avg(arr) {
  const good = arr.filter(x => Number.isFinite(x));
  if (!good.length) return null;
  return good.reduce((a, b) => a + b, 0) / good.length;
}

const board = read(BOARD);
const vegas = read(VEGAS);

const byKey = new Map();

for (const v of vegas) {
  const player = k(v.player);
  const stat = statKey(v.stat);
  const line = n(v.line);
  const odds = n(v.odds);
  const s = k(v.side).toUpperCase();

  if (!player || !stat || line === null || odds === null) continue;
  if (s !== 'OVER' && s !== 'UNDER') continue;

  const key = `${player}|${stat}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push({ ...v, side: s, line, odds });
}

let matched = 0;

for (const row of board) {
  if (row.recordType !== 'merged_prop') continue;

  const wantSide = side(row);
  if (!wantSide) continue;

  const key = `${k(row.player)}|${statKey(row.stat || row.market)}`;
  const options = byKey.get(key) || [];
  if (!options.length) continue;

  const boardLine = n(row.line);
  const grouped = new Map();

  for (const v of options) {
    const g = String(v.line);
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g).push(v);
  }

  let best = null;

  for (const [lineText, rows] of grouped.entries()) {
    const line = n(lineText);
    const over = rows.filter(r => r.side === 'OVER').map(r => implied(r.odds));
    const under = rows.filter(r => r.side === 'UNDER').map(r => implied(r.odds));

    const overImp = avg(over);
    const underImp = avg(under);

    if (overImp === null || underImp === null) continue;

    const total = overImp + underImp;
    if (!total) continue;

    const overNoVig = overImp / total;
    const underNoVig = underImp / total;

    const pickProb = wantSide === 'UNDER' ? underNoVig : overNoVig;
    const dist = boardLine === null ? 0 : Math.abs(line - boardLine);

    if (!best || dist < best.dist) {
      best = {
        line,
        dist,
        pickProb,
        overNoVig,
        underNoVig,
        books: [...new Set(rows.map(r => r.bookmaker || r.book).filter(Boolean))]
      };
    }
  }

  if (!best) continue;

  const oldProb = n(row.recommendedProb) || 0.60;
  const lineEdge = boardLine === null ? 0 : Math.min(0.08, Math.abs(boardLine - best.line) * 0.015);
  const blendedProb = Math.max(0.55, Math.min(0.75, oldProb * 0.55 + best.pickProb * 0.35 + lineEdge));

  row.vegasDriven = true;
  row.vegasLine = best.line;
  row.vegasPickProb = Number(best.pickProb.toFixed(3));
  row.vegasOverProb = Number(best.overNoVig.toFixed(3));
  row.vegasUnderProb = Number(best.underNoVig.toFixed(3));
  row.vegasBooks = best.books;
  row.probabilitySource = 'vegas_blend';
  row.recommendedProb = Number(blendedProb.toFixed(3));

  if (n(row.expectedValue) !== null) {
    row.expectedValue = Number((row.expectedValue * (blendedProb / Math.max(oldProb, 0.01))).toFixed(3));
  }

  matched++;
}

fs.writeFileSync(BOARD, JSON.stringify(board, null, 2));

console.log({
  recordType: 'apply_vegas_to_priced_summary',
  boardRows: board.length,
  vegasRows: vegas.length,
  matched
});
