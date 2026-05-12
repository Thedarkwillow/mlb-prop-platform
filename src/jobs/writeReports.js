import fs from 'fs';

const SLATE_DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

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

function rowDate(row) {
  return String(
    row.slateDate ||
    row.date ||
    row.gameDate ||
    row.gameStart ||
    row.startTime ||
    row.boardDate ||
    ''
  ).slice(0, 10);
}

function gameTeams(game) {
  return String(game || '')
    .replace(/\s+/g, ' ')
    .split('@')
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);
}

function teamLooksValid(row) {
  const team = String(row.team || row.playerTeam || '').trim().toUpperCase();
  if (!team) return false;

  const g = row.resolvedGame || row.game || row.sportsbookGame || '';
  const parts = gameTeams(g);
  if (parts.length !== 2) return true;

  return parts.includes(team);
}

function hasValidGame(row) {
  if (row.gamePk || row.resolvedGamePk) return true;
  const g = row.resolvedGame || row.game || row.sportsbookGame || '';
  return gameTeams(g).length === 2;
}

function isUnsupportedReportMarket(row) {
  const m = String(row.market || row.stat || '').toLowerCase();
  if (m.includes('plate appearances')) return true;
  if (m.includes('pitches thrown')) return true;
  if (m.includes('singles')) return true;
  if (m.includes('walks')) return true;
  return false;
}

function isZeroProjectionArtifact(row) {
  const proj = Number(row.projection);
  const side = String(sideOf(row)).toUpperCase();
  const m = String(row.market || row.stat || '').toLowerCase();
  return (
    Number.isFinite(proj) &&
    proj === 0 &&
    side === 'LESS' &&
    (
      m.includes('plate appearances') ||
      m.includes('pitches thrown') ||
      m.includes('singles') ||
      m.includes('walks')
    )
  );
}

function isSlateRow(row) {
  const d = rowDate(row);
  if (d && d !== SLATE_DATE) return false;
  if (!teamLooksValid(row)) return false;
  if (!hasValidGame(row)) return false;
  if (isUnsupportedReportMarket(row)) return false;
  if (isZeroProjectionArtifact(row)) return false;
  return true;
}

function playable(row) {
  if (row.recordType !== 'merged_prop') return false;
  if (!isSlateRow(row)) return false;
  if (!row.player || !(row.stat || row.market)) return false;
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
    `${i + 1}. ${row.player} — ${row.stat || row.market} ${sideOf(row)} ${row.line}`,
    `   Team/Game: ${row.team || 'NA'} | ${row.resolvedGame || row.game || 'NA'}`,
    `   GamePk: ${row.resolvedGamePk || row.gamePk || 'NA'} | Row Date: ${rowDate(row) || 'NA'}`,
    `   Projection: ${num(row.projection)} | Prob: ${pct(row.recommendedProb)} | EV: ${num(row.expectedValue)}`,
    `   Bucket: ${row.confidenceBucket || 'NA'} | Market: ${row.market || 'NA'} | Tier: ${row.oddsTier || 'NA'}`,
    `   Vegas: ${row.vegasDriven ? 'YES' : 'NO'} | Vegas Line: ${row.vegasLine ?? 'NA'} | Vegas Prob: ${row.vegasPickProb ?? 'NA'} | Source: ${row.probabilitySource || 'NA'}`,
  ].join('\n');
}

function formatSlip(slip) {
  const rawLegs = Array.isArray(slip.legs) ? slip.legs : [];
  const legs = rawLegs.filter(isSlateRow);
  const removed = rawLegs.length - legs.length;

  const lines = [
    String(slip.name || `best_${slip.size}_man`).toUpperCase(),
    `Slate Date: ${SLATE_DATE}`,
    `Size: ${slip.size} | Avg Prob: ${pct(slip.avgProb)} | Avg EV: ${num(slip.avgEV)} | Complete: ${!!slip.complete}`,
    `Valid Legs: ${legs.length}/${rawLegs.length} | Removed stale/invalid legs: ${removed}`,
  ];

  legs.forEach((leg, idx) => {
    lines.push(
      `${idx + 1}. ${leg.player} — ${leg.stat || leg.market} ${sideOf(leg)} ${leg.line}`,
      `   Team/Game: ${leg.team || 'NA'} | ${leg.resolvedGame || leg.game || 'NA'}`,
      `   GamePk: ${leg.resolvedGamePk || leg.gamePk || 'NA'} | Row Date: ${rowDate(leg) || 'NA'}`,
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

const slips = (Array.isArray(slipsRaw)
  ? slipsRaw
  : Object.values(slipsRaw).filter(Boolean)
).map(slip => ({
  ...slip,
  slateDate: SLATE_DATE,
  legs: Array.isArray(slip.legs) ? slip.legs.filter(isSlateRow) : [],
  removedStaleOrInvalidLegs: Array.isArray(slip.legs)
    ? slip.legs.filter(x => !isSlateRow(x)).length
    : 0
})).filter(slip => {
  const target = Number(slip.size || slip.targetSize || slip.originalSize || 0);
  const valid = (slip.legs || []).length;
  return target > 0 ? valid >= target : valid > 0;
});

const topReport = [
  'MLB TOP EV PLAYS',
  `Slate Date: ${SLATE_DATE}`,
  `Generated: ${new Date().toISOString()}`,
  `Playable rows: ${top.length}`,
  '',
  ...top.map(formatPlay),
  '',
].join('\n');

const slipReport = [
  'MLB EV SLIP SUMMARY',
  `Slate Date: ${SLATE_DATE}`,
  `Generated: ${new Date().toISOString()}`,
  `Valid slips shown: ${slips.length}`,
  '',
  ...slips.map(formatSlip),
  '',
].join('\n');

fs.writeFileSync(topTxt, topReport);
fs.writeFileSync(slipTxt, slipReport);

console.log(`Saved ${topTxt}`);
console.log(`Saved ${slipTxt}`);
console.log(`Slate Date: ${SLATE_DATE}`);
