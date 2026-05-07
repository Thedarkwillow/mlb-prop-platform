import fs from 'fs';

const pricedPath = 'outputs/priced-board.json';
const slipsPath = 'outputs/slips.json';
const outJson = 'outputs/actionable-picks.json';
const outTxt = 'outputs/actionable-picks.txt';

const ALLOWED_MARKETS = new Set([
  'Total Bases',
  'Hits+Runs+RBIs',
  'Pitcher Strikeouts',
]);

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function sideOf(row) {
  return row.recommendedSide || row.side || row.pick || row.direction || null;
}

function cleanName(v) {
  return typeof v === 'string' && v.trim().length > 1;
}

function isAllowed(row) {
  const side = sideOf(row);

  if (!cleanName(row.player)) return false;
  if (!ALLOWED_MARKETS.has(row.stat)) return false;
  if (!['MORE', 'LESS'].includes(side)) return false;
  if (row.pricingStatus !== 'PRICED') return false;
  if (!['elite', 'strong'].includes(row.confidenceBucket)) return false;
  if (Number(row.recommendedProb || 0) < 0.58) return false;
  if (Number(row.expectedValue || 0) < 1.05) return false;

  return true;
}

const priced = readJson(pricedPath, []);
const rows = priced
  .filter(r => r.recordType === 'merged_prop')
  .filter(isAllowed)
  .sort((a, b) => {
    const evDiff = Number(b.expectedValue || 0) - Number(a.expectedValue || 0);
    if (evDiff !== 0) return evDiff;
    return Number(b.recommendedProb || 0) - Number(a.recommendedProb || 0);
  });

const top = rows.slice(0, 50);

const summary = {
  recordType: 'actionable_summary',
  createdAt: new Date().toISOString(),
  totalPricedRows: priced.filter(r => r.recordType === 'merged_prop').length,
  actionableRows: rows.length,
  shownRows: top.length,
  allowedMarkets: [...ALLOWED_MARKETS],
};

const lines = [];
lines.push('MLB ACTIONABLE PICKS');
lines.push(`Generated: ${summary.createdAt}`);
lines.push(`Actionable rows: ${rows.length}`);
lines.push('');

top.forEach((p, i) => {
  const side = sideOf(p);
  lines.push(`${i + 1}. ${p.player} — ${p.stat} ${side} ${p.line}`);
  lines.push(`   Team/Game: ${p.team || 'NA'} | ${p.game || 'NA'}`);
  lines.push(`   Projection: ${p.projection ?? 'NA'} | Prob: ${((p.recommendedProb || 0) * 100).toFixed(1)}% | EV: ${p.expectedValue ?? 'NA'}`);
  lines.push(`   Bucket: ${p.confidenceBucket} | Market: ${p.market} | Tier: ${p.oddsTier}`);
});

fs.writeFileSync(outJson, JSON.stringify([summary, ...top], null, 2));
fs.writeFileSync(outTxt, lines.join('\n'));

console.log(summary);
console.log(`Saved ${outJson}`);
console.log(`Saved ${outTxt}`);
