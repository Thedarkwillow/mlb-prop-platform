import fs from 'fs';

const PRICED_FILE = 'outputs/priced-board.json';
const SLIPS_FILE = 'outputs/slips.json';

function fmt(n, d = 3) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(d) : 'NA';
}

function pct(n) {
  const x = Number(n);
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'NA';
}

function legLine(leg, i) {
  const side = leg.recommendedSide || leg.side || 'NA';
  const prob = leg.recommendedProb ?? leg.probability;
  const ev = leg.expectedValue;
  const bucket = leg.confidenceBucket || 'NA';

  return `${i + 1}. ${leg.player} — ${leg.stat} ${side} ${leg.line}
   Team/Game: ${leg.team} | ${leg.game}
   Projection: ${fmt(leg.projection)} | Prob: ${pct(prob)} | EV: ${fmt(ev)} | Bucket: ${bucket}
   Market: ${leg.market} | Source: ${leg.sourceType}`;
}

function main() {
  if (!fs.existsSync(PRICED_FILE)) {
    throw new Error(`Missing ${PRICED_FILE}`);
  }

  if (!fs.existsSync(SLIPS_FILE)) {
    throw new Error(`Missing ${SLIPS_FILE}`);
  }

  const priced = JSON.parse(fs.readFileSync(PRICED_FILE, 'utf8'));
  const slips = JSON.parse(fs.readFileSync(SLIPS_FILE, 'utf8'));

  const topPlays = priced
    .filter(r => r.recordType === 'merged_prop')
    .filter(r => r.pricingStatus === 'PRICED')
    .filter(r => r.expectedValue >= 1.2)
    .filter(r => r.recommendedProb >= 0.85)
    .sort((a, b) => {
      if ((b.expectedValue ?? 0) !== (a.expectedValue ?? 0)) {
        return (b.expectedValue ?? 0) - (a.expectedValue ?? 0);
      }
      return (b.recommendedProb ?? 0) - (a.recommendedProb ?? 0);
    })
    .slice(0, 30);

  const topText = [
    `MLB TOP EV PLAYS`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    ...topPlays.map((leg, i) => legLine(leg, i)),
    ``,
  ].join('\n');

  const slipTextParts = [
    `MLB EV SLIP SUMMARY`,
    `Generated: ${new Date().toISOString()}`,
    ``,
  ];

  for (const slip of slips) {
    if (!slip.recordType?.startsWith('best_')) continue;

    slipTextParts.push(`${slip.recordType.toUpperCase()}`);
    slipTextParts.push(
      `Size: ${slip.size} | Avg Prob: ${pct(slip.avgProb)} | Avg EV: ${fmt(slip.avgEV)} | Complete: ${slip.complete}`
    );
    slipTextParts.push('');

    for (const [i, leg] of (slip.legs || []).entries()) {
      slipTextParts.push(legLine(leg, i));
      slipTextParts.push('');
    }

    slipTextParts.push('---');
    slipTextParts.push('');
  }

  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync('outputs/top-plays.txt', topText);
  fs.writeFileSync('outputs/slip-summary.txt', slipTextParts.join('\n'));

  console.log('Saved outputs/top-plays.txt');
  console.log('Saved outputs/slip-summary.txt');
}

main();
