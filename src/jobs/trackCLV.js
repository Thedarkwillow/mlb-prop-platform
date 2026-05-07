import fs from 'fs';

const slipsPath = 'outputs/slips.json';
const currentPath = 'outputs/priced-board.json';
const outputPath = 'outputs/clv-report.txt';

if (!fs.existsSync(slipsPath) || !fs.existsSync(currentPath)) {
  console.log('Missing outputs/slips.json or outputs/priced-board.json');
  process.exit(1);
}

const slipsRaw = JSON.parse(fs.readFileSync(slipsPath, 'utf8'));
const currentRows = JSON.parse(fs.readFileSync(currentPath, 'utf8'))
  .filter(r => r.recordType === 'merged_prop');

const currentMap = new Map();
for (const row of currentRows) {
  const key = `${row.player}|${row.stat}|${row.oddsTier}`;
  currentMap.set(key, row);
}

const slips = Array.isArray(slipsRaw)
  ? slipsRaw
  : Object.values(slipsRaw);

const out = [];
out.push('CLV REPORT (SLIPS ONLY)');
out.push(`Generated: ${new Date().toISOString()}\n`);

for (const slip of slips) {
  if (!slip?.legs?.length) continue;

  out.push(`${slip.recordType || 'slip'}`);
  out.push(`Size: ${slip.size || slip.legs.length}`);

  let total = 0;
  let count = 0;

  for (const leg of slip.legs) {
    const key = `${leg.player}|${leg.stat}|${leg.oddsTier}`;
    const current = currentMap.get(key);
    if (!current) continue;

    const open = Number(leg.line);
    const now = Number(current.line);
    const rawMove = now - open;

    const side = leg.recommendedSide || leg.side || leg.pick || leg.direction || (rawMove < 0 ? 'LESS' : 'MORE');
    const clv = side === 'LESS' ? open - now : now - open;

    total += clv;
    count++;

    out.push(`${leg.player} — ${leg.stat} ${side} ${open}`);
    out.push(`Open: ${open} | Current: ${now} | Raw Move: ${rawMove.toFixed(2)} | Side CLV: ${clv.toFixed(2)}`);
  }

  out.push(`Avg Side CLV: ${count ? (total / count).toFixed(2) : '0.00'} (${count} legs)\n---`);
}

fs.writeFileSync(outputPath, out.join('\n'));
console.log(`Saved ${outputPath}`);
