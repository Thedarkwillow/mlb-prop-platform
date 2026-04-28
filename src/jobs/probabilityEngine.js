import fs from 'fs';

const IN_FILE = 'outputs/merged-board.json';
const OUT_FILE = 'outputs/priced-board.json';

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round(n, d = 3) {
  return Number(Number(n).toFixed(d));
}

function marketSigma(market, line) {
  if (market === 'strikeouts') return 1.65;
  if (market === 'bases') return 1.35;
  if (market === 'hrr') return 1.25;
  if (market === 'hits') return 0.75;
  if (market === 'hr') return 0.35;
  if (market === 'rbis') return 0.9;
  if (market === 'runs') return 0.85;
  return Math.max(1, Math.sqrt(Math.max(Number(line) || 1, 1)));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function probabilityOver(projection, line, market) {
  const sigma = marketSigma(market, line);
  return clamp(sigmoid((projection - line) / sigma), 0.01, 0.99);
}

function confidenceBucket(prob) {
  const edgeProb = Math.abs(prob - 0.5);

  if (edgeProb >= 0.16) return 'elite';
  if (edgeProb >= 0.11) return 'strong';
  if (edgeProb >= 0.07) return 'playable';
  if (edgeProb >= 0.04) return 'lean';
  return 'pass';
}

function impliedMultiplierEV(prob, oddsTier) {
  // starter EV proxy, not final PrizePicks payout math yet
  const payout =
    oddsTier === 'demon' ? 2.0 :
    oddsTier === 'goblin' ? 1.15 :
    1.0;

  return prob * payout - (1 - prob);
}

const board = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));

const priced = board.map(row => {
  if (
    row.recordType !== 'merged_prop' ||
    row.projection === null ||
    row.line === null ||
    !row.market
  ) {
    return {
      ...row,
      pricingStatus: 'UNPRICED',
    };
  }

  const overProb = probabilityOver(row.projection, row.line, row.market);
  const underProb = 1 - overProb;

  const recommendedSide = overProb >= 0.5 ? 'MORE' : 'LESS';
  const recommendedProb = Math.max(overProb, underProb);
  const expectedValue = impliedMultiplierEV(recommendedProb, row.oddsTier);

  return {
    ...row,
    pricingStatus: 'PRICED',
    overProb: round(overProb),
    underProb: round(underProb),
    recommendedSide,
    recommendedProb: round(recommendedProb),
    fairLine: round(row.projection),
    expectedValue: round(expectedValue),
    confidenceBucket: confidenceBucket(recommendedProb),
  };
});

const summary = {
  recordType: 'pricing_summary',
  createdAt: new Date().toISOString(),
  totalRows: priced.length,
  pricedRows: priced.filter(r => r.pricingStatus === 'PRICED').length,
  elite: priced.filter(r => r.confidenceBucket === 'elite').length,
  strong: priced.filter(r => r.confidenceBucket === 'strong').length,
  playable: priced.filter(r => r.confidenceBucket === 'playable').length,
  lean: priced.filter(r => r.confidenceBucket === 'lean').length,
  pass: priced.filter(r => r.confidenceBucket === 'pass').length,
};

fs.writeFileSync(OUT_FILE, JSON.stringify([summary, ...priced], null, 2));

console.log(summary);
console.log(`Saved ${OUT_FILE}`);
