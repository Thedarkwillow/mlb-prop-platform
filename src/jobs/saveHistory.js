import fs from 'fs';

const pricedPath = 'outputs/priced-board.json';
const historyPath = 'outputs/history.json';

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

const priced = read(pricedPath, []);
const existing = read(historyPath, []);

const newEntries = priced
  .filter(r => r.recordType === 'merged_prop')
  .map(r => ({
    recordType: 'history_entry',
    createdAt: new Date().toISOString(),
    player: r.player,
    stat: r.stat,
    line: r.line,
    side: r.recommendedSide,
    projection: r.projection,
    result: 'PENDING',
    actual: null,
    clv: null,
  }));

const combined = [...existing, ...newEntries];

fs.writeFileSync(historyPath, JSON.stringify(combined, null, 2));

console.log(`Saved ${newEntries.length} history entries`);
