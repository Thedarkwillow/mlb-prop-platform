import fs from 'fs';

const BOARD_PATH = 'outputs/merged-board.json';
const VEGAS_PATH = 'data/vegas-latest.json';
const OUT_PATH = 'outputs/merged-board.json';

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function clean(v) {
  return String(v ?? '').trim().toLowerCase();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeStat(stat) {
  const s = clean(stat);

  if (s.includes('strikeout')) return 'strikeouts';
  if (s.includes('total bases') || s.includes('bases')) return 'bases';
  if (s === 'hits' || s.includes('batter hits')) return 'hits';

  if (s.includes('hits+runs+rbis') || s.includes('hrr')) return 'unsupported';

  return s;
}

function impliedProbAmerican(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  if (o < 0) return Math.abs(o) / (Math.abs(o) + 100);
  return 100 / (o + 100);
}

function avg(arr) {
  const nums = arr.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const board = readJson(BOARD_PATH, []);
const vegas = readJson(VEGAS_PATH, []);

const vegasMap = new Map();

for (const v of vegas) {
  if (!v.player || !v.stat || v.line == null || !v.side) continue;

  const statKey = normalizeStat(v.stat);
  if (statKey === 'unsupported') continue;

  const key = `${clean(v.player)}|${statKey}`;

  if (!vegasMap.has(key)) vegasMap.set(key, []);

  vegasMap.get(key).push({
    ...v,
    statKey,
    line: num(v.line),
    odds: num(v.odds),
    impliedProb: impliedProbAmerican(v.odds),
    side: String(v.side).toUpperCase(),
  });
}

let matched = 0;
let matchedWithBothSides = 0;
let skippedUnsupported = 0;

const enriched = board.map(row => {
  if (row.recordType !== 'merged_prop') return row;

  const statKey = normalizeStat(row.stat);

  if (statKey === 'unsupported') {
    skippedUnsupported++;
    return {
      ...row,
      statKey,
      vegasMatched: false,
      vegasSkip: 'unsupported_market',
    };
  }

  const rows = vegasMap.get(`${clean(row.player)}|${statKey}`) || [];

  if (!rows.length) {
    return {
      ...row,
      statKey,
      vegasMatched: false,
    };
  }

  const overRows = rows.filter(r => r.side === 'OVER' && r.impliedProb !== null);
  const underRows = rows.filter(r => r.side === 'UNDER' && r.impliedProb !== null);

  const overRaw = avg(overRows.map(r => r.impliedProb));
  const underRaw = avg(underRows.map(r => r.impliedProb));

  let vegasOverProb = null;
  let vegasUnderProb = null;

  if (overRaw !== null && underRaw !== null) {
    const total = overRaw + underRaw;
    if (total > 0) {
      vegasOverProb = overRaw / total;
      vegasUnderProb = underRaw / total;
      matchedWithBothSides++;
    }
  }

  const vegasLine = avg(rows.map(r => r.line));

  matched++;

  return {
    ...row,
    statKey,
    vegasMatched: true,
    vegasLine: vegasLine === null ? null : Number(vegasLine.toFixed(2)),
    vegasOverProb: vegasOverProb === null ? null : Number(vegasOverProb.toFixed(3)),
    vegasUnderProb: vegasUnderProb === null ? null : Number(vegasUnderProb.toFixed(3)),
    vegasCount: rows.length,
    vegasBooks: [...new Set(rows.map(r => r.bookmaker).filter(Boolean))],
    vegasEdge:
      row.line != null && vegasLine !== null
        ? Number((Number(row.line) - vegasLine).toFixed(2))
        : null,
  };
});

fs.writeFileSync(OUT_PATH, JSON.stringify(enriched, null, 2));

console.log({
  recordType: 'vegas_merge_summary',
  boardRows: board.length,
  vegasRows: vegas.length,
  matchedProps: matched,
  matchedWithBothSides,
  skippedUnsupported,
  saved: OUT_PATH,
});
