import fs from 'fs';

const historyPath = 'data/history.json';
const slipsPath = 'outputs/slips.json';
const outputPath = 'outputs/clv-report.txt';

if (!fs.existsSync(historyPath) || !fs.existsSync(slipsPath)) {
  console.log('Missing history or slips file');
  process.exit(1);
}

const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
const slips = JSON.parse(fs.readFileSync(slipsPath, 'utf8'));

// Build lookup: latest line per player+stat
const latestMap = new Map();
for (const row of history) {
  const key = `${row.player}|${row.stat}`;
  latestMap.set(key, row);
}

let output = [];
output.push(`CLV REPORT (SLIPS ONLY)`);
output.push(`Generated: ${new Date().toISOString()}\n`);

for (const slipName of Object.keys(slips)) {
  const slip = slips[slipName];
  if (!slip || !slip.legs) continue;

  let totalMove = 0;
  let count = 0;

  output.push(`${slipName.toUpperCase()}`);
  output.push(`---------------------`);

  for (const leg of slip.legs) {
    const key = `${leg.player}|${leg.stat}`;
    const latest = latestMap.get(key);

    if (!latest) continue;

    const open = leg.line;
    const current = latest.line;
    const move = current - open;

    totalMove += move;
    count++;

    output.push(
      `${leg.player} — ${leg.stat}\n` +
      `Open: ${open} | Current: ${current} | Move: ${move.toFixed(2)}`
    );
  }

  const avg = count ? totalMove / count : 0;

  output.push(`\nAvg CLV: ${avg.toFixed(2)} (${count} legs)\n`);
}

fs.writeFileSync(outputPath, output.join('\n'));
console.log(`Saved ${outputPath}`);
