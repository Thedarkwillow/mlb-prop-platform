const fs = require('fs');

const date = process.argv[2];

if (!date) {
  console.log('Usage: node src/jobs/clvReportEngine.cjs YYYY-MM-DD');
  process.exit(1);
}

const lockedPath = `outputs/history/${date}-locked-slips.json`;
const historyPath = `data/prizepicks-history.json`;

if (!fs.existsSync(lockedPath)) {
  console.log(`Missing locked slips: ${lockedPath}`);
  process.exit(1);
}

if (!fs.existsSync(historyPath)) {
  console.log(`Missing history data: ${historyPath}`);
  console.log('Need PrizePicks line history snapshots before CLV can run.');
  process.exit(1);
}

const slips = JSON.parse(fs.readFileSync(lockedPath, 'utf8'));
const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

const legs = slips.flatMap(s => s.legs || []);

function norm(v) {
  return String(v || '').toLowerCase().trim();
}

function getHistoryForProp(leg) {
  return history.filter(h =>
    norm(h.player) === norm(leg.player) &&
    norm(h.market) === norm(leg.market)
  );
}

function getCLV(leg) {
  const hist = getHistoryForProp(leg);

  if (!hist.length) return null;

  const sorted = hist
    .filter(x => x.line != null && x.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (!sorted.length) return null;

  const open = Number(sorted[0].line);
  const close = Number(sorted[sorted.length - 1].line);
  const locked = Number(leg.line);

  if (!Number.isFinite(open) || !Number.isFinite(close) || !Number.isFinite(locked)) {
    return null;
  }

  let clv = 0;

  if (String(leg.side || '').toUpperCase() === 'LESS') {
    clv = close - locked;
  } else {
    clv = locked - close;
  }

  return {
    open,
    locked,
    close,
    clv
  };
}

let total = 0;
let positive = 0;
let negative = 0;
let zero = 0;
let missing = 0;

const results = [];

for (const leg of legs) {
  const r = getCLV(leg);

  if (!r) {
    missing++;
    continue;
  }

  total++;

  if (r.clv > 0) positive++;
  else if (r.clv < 0) negative++;
  else zero++;

  results.push({
    player: leg.player,
    market: leg.market,
    stat: leg.stat,
    side: leg.side,
    line: leg.line,
    open: r.open,
    locked: r.locked,
    close: r.close,
    clv: Number(r.clv.toFixed(3))
  });
}

results.sort((a, b) => b.clv - a.clv);

const summary = {
  date,
  lockedLegs: legs.length,
  legsAnalyzed: total,
  missingHistory: missing,
  positiveCLV: positive,
  negativeCLV: negative,
  zeroCLV: zero,
  positiveRate: total ? Number(((positive / total) * 100).toFixed(1)) : 0
};

fs.writeFileSync(
  `outputs/history/${date}-clv-report.json`,
  JSON.stringify({ summary, results }, null, 2)
);

let txt = '';
txt += `CLV REPORT\n`;
txt += `Date: ${date}\n\n`;
txt += `Locked Legs: ${summary.lockedLegs}\n`;
txt += `Legs Analyzed: ${summary.legsAnalyzed}\n`;
txt += `Missing History: ${summary.missingHistory}\n`;
txt += `Positive CLV: ${summary.positiveCLV}\n`;
txt += `Negative CLV: ${summary.negativeCLV}\n`;
txt += `Zero CLV: ${summary.zeroCLV}\n`;
txt += `Positive Rate: ${summary.positiveRate}%\n\n`;

txt += `TOP CLV GAINS\n`;
txt += `-------------\n`;
for (const r of results.slice(0, 10)) {
  txt += `${r.player} | ${r.market} | ${r.side} ${r.locked} | Open: ${r.open} | Close: ${r.close} | CLV: ${r.clv}\n`;
}

txt += `\nWORST CLV\n`;
txt += `---------\n`;
for (const r of results.slice(-10)) {
  txt += `${r.player} | ${r.market} | ${r.side} ${r.locked} | Open: ${r.open} | Close: ${r.close} | CLV: ${r.clv}\n`;
}

fs.writeFileSync(
  `outputs/history/${date}-clv-report.txt`,
  txt
);

console.log(txt);
console.log(`Saved outputs/history/${date}-clv-report.json`);
console.log(`Saved outputs/history/${date}-clv-report.txt`);
