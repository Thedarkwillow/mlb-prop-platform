import fs from 'fs';

const historyPath = 'outputs/history.json';
const clvPath = 'outputs/clv-report.json';
const outTxt = 'outputs/performance-report.txt';

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const history = read(historyPath, []);
const clv = read(clvPath, []);

const rows = history.filter(r => r.recordType === 'history_entry');

let total = 0;
let wins = 0;
let losses = 0;
let pushes = 0;
let pending = 0;

let clvSum = 0;
let clvCount = 0;

const clvBuckets = {
  high: { min: 2, total: 0, wins: 0 },
  mid: { min: 1, total: 0, wins: 0 },
  low: { min: 0, total: 0, wins: 0 },
};

for (const r of rows) {
  total++;

  if (r.result === 'HIT') wins++;
  else if (r.result === 'MISS') losses++;
  else if (r.result === 'PUSH') pushes++;
  else pending++;

  if (typeof r.clv === 'number') {
    clvSum += r.clv;
    clvCount++;

    if (r.clv >= 2) {
      clvBuckets.high.total++;
      if (r.result === 'HIT') clvBuckets.high.wins++;
    } else if (r.clv >= 1) {
      clvBuckets.mid.total++;
      if (r.result === 'HIT') clvBuckets.mid.wins++;
    } else {
      clvBuckets.low.total++;
      if (r.result === 'HIT') clvBuckets.low.wins++;
    }
  }
}

const hitRate = total ? (wins / (wins + losses)) : 0;
const avgCLV = clvCount ? (clvSum / clvCount) : 0;

function bucketLine(name, b) {
  if (!b.total) return `${name}: NA`;
  return `${name}: ${(b.wins / b.total * 100).toFixed(1)}% (${b.wins}/${b.total})`;
}

const lines = [];
lines.push('MLB PERFORMANCE REPORT');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');
lines.push(`Total Bets: ${total}`);
lines.push(`Record: ${wins}-${losses}-${pushes}`);
lines.push(`Pending: ${pending}`);
lines.push(`Hit Rate: ${(hitRate * 100).toFixed(1)}%`);
lines.push('');
lines.push(`Avg CLV: ${avgCLV.toFixed(2)}`);
lines.push('');
lines.push('CLV BUCKET PERFORMANCE');
lines.push(bucketLine('CLV ≥ 2.0', clvBuckets.high));
lines.push(bucketLine('CLV 1.0–2.0', clvBuckets.mid));
lines.push(bucketLine('CLV < 1.0', clvBuckets.low));

fs.writeFileSync(outTxt, lines.join('\n'));

console.log({
  total,
  wins,
  losses,
  pushes,
  pending,
  avgCLV,
});

console.log(`Saved ${outTxt}`);
