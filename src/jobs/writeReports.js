import fs from 'fs';

const pricedPath = 'outputs/priced-board.json';
const slipsPath = 'outputs/slips.json';
const topTxt = 'outputs/top-plays.txt';
const slipTxt = 'outputs/slip-summary.txt';

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function pct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NA';
  return `${(n * 100).toFixed(1)}%`;
}

function num(v, digits = 3) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NA';
  return n.toFixed(digits).replace(/\.?0+$/, '');
}

function sideOf(row) {
  return row.recommendedSide || row.side || row.pick || row.direction || 'NA';
}

function playable(row) {
  if (row.recordType !== 'merged_prop') return false;
  if (!row.player || !row.stat) return false;
  if (!sideOf(row)) return false;
  if (!Number.isFinite(Number(row.recommendedProb))) return false;
  if (!Number.isFinite(Number(row.expectedValue))) return false;
  if (Number(row.recommendedProb) < 0.60) return false;
  if (Number(row.expectedValue) < 1.08) return false;
  if (row.vegasSkip === 'unsupported_market') return false;
  return true;
}

function formatPlay(row, i) {
  return [
    `${i + 1}. ${row.player} — ${row.stat} ${sideOf(row)} ${row.line}`,
    `   Team/Game: ${row.team || 'NA'} | ${row.game || 'NA'}`,
    `   Projection: ${num(row.projection)} | Prob: ${pct(row.recommendedProb)} | EV: ${num(row.expectedValue)}`,
    `   Bucket: ${row.confidenceBucket || 'NA'} | Market: ${row.market || 'NA'} | Tier: ${row.oddsTier || 'NA'}`,
    `   Vegas: ${row.vegasDriven ? 'YES' : 'NO'} | Vegas Line: ${row.vegasLine ?? 'NA'} | Vegas Prob: ${row.vegasPickProb ?? 'NA'} | Source: ${row.probabilitySource || 'NA'}`,
  ].join('\n');
}

function formatSlip(slip) {
  const legs = Array.isArray(slip.legs) ? slip.legs : [];

  const lines = [
    String(slip.name || `best_${slip.size}_man`).toUpperCase(),
    `Size: ${slip.size} | Avg Prob: ${pct(slip.avgProb)} | Avg EV: ${num(slip.avgEV)} | Complete: ${!!slip.complete}`,
  ];

  legs.forEach((leg, idx) => {
    lines.push(
      `${idx + 1}. ${leg.player} — ${leg.stat} ${sideOf(leg)} ${leg.line}`,
      `   Team/Game: ${leg.team || 'NA'} | ${leg.game || 'NA'}`,
      `   Projection: ${num(leg.projection)} | Prob: ${pct(leg.recommendedProb)} | EV: ${num(leg.expectedValue)}`,
      `   Bucket: ${leg.confidenceBucket || 'NA'} | Market: ${leg.market || 'NA'} | Tier: ${leg.oddsTier || 'NA'}`,
      `   Vegas: ${leg.vegasDriven ? 'YES' : 'NO'} | Vegas Line: ${leg.vegasLine ?? 'NA'} | Vegas Prob: ${leg.vegasPickProb ?? 'NA'} | Source: ${leg.probabilitySource || 'NA'}`
    );
  });

  lines.push('---');
  return lines.join('\n');
}

const priced = readJson(pricedPath, []);
const slipsRaw = readJson(slipsPath, []);

const top = priced
  .filter(playable)
  .sort((a, b) => Number(b.expectedValue || 0) - Number(a.expectedValue || 0))
  .slice(0, 50);

const slips = Array.isArray(slipsRaw)
  ? slipsRaw
  : Object.values(slipsRaw).filter(Boolean);

const topReport = [
  'MLB TOP EV PLAYS',
  `Generated: ${new Date().toISOString()}`,
  `Playable rows: ${top.length}`,
  '',
  ...top.map(formatPlay),
  '',
].join('\n');

const slipReport = [
  'MLB EV SLIP SUMMARY',
  `Generated: ${new Date().toISOString()}`,
  '',
  ...slips.map(formatSlip),
  '',
].join('\n');

fs.writeFileSync(topTxt, topReport);
fs.writeFileSync(slipTxt, slipReport);

console.log(`Saved ${topTxt}`);
console.log(`Saved ${slipTxt}`);
