import fs from 'fs';

const SLIPS_FILE = 'outputs/slips.json';
const BOARD_FILE = 'outputs/merged-board.json';

function fmt(n, digits = 3) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(digits) : 'NA';
}

function legLine(leg, i) {
  return `${i + 1}. ${leg.player} — ${leg.stat} ${leg.edge >= 0 ? 'MORE' : 'LESS'} ${leg.line}
   Team/Game: ${leg.team} | ${leg.game}
   Projection: ${fmt(leg.projection)} | Edge: ${fmt(leg.edge)} | Confidence: ${fmt(leg.confidence)}
   Market: ${leg.market} | Source: ${leg.sourceType}`;
}

function main() {
  if (!fs.existsSync(SLIPS_FILE)) {
    throw new Error(`Missing ${SLIPS_FILE}`);
  }

  const slips = JSON.parse(fs.readFileSync(SLIPS_FILE, 'utf8'));
  const board = fs.existsSync(BOARD_FILE)
    ? JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'))
    : [];

  const topPlays = board
    .filter(r => r.recordType === 'merged_prop')
    .filter(r => r.oddsTier === 'standard')
    .filter(r => r.edge !== null && r.projection !== null)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 30);

  const topText = [
    `MLB TOP PLAYS`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    ...topPlays.map((leg, i) => legLine(leg, i)),
    ``,
  ].join('\n');

  const slipTextParts = [
    `MLB SLIP SUMMARY`,
    `Generated: ${new Date().toISOString()}`,
    ``,
  ];

  for (const slip of slips) {
    if (!slip.recordType?.startsWith('best_')) continue;

    slipTextParts.push(`${slip.recordType.toUpperCase()}`);
    slipTextParts.push(`Size: ${slip.size} | Avg Edge: ${fmt(slip.avgEdge)}`);
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
