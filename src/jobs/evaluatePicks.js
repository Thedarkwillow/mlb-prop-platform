import fs from 'fs';

const slipsPath = 'outputs/slips.json';
const gradedPath = 'outputs/graded-results.json';
const pricedPath = 'outputs/priced-board.json';

const outJson = 'outputs/evaluated-picks.json';
const outTxt = 'outputs/evaluated-picks.txt';

function readJson(path, fallback = null) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sideOf(row) {
  return row.recommendedSide || row.side || row.pick || row.direction || null;
}

function keyOf(row) {
  return [
    row.player || '',
    row.stat || '',
    row.market || '',
    row.oddsTier || '',
  ].join('|').toLowerCase();
}

const slipsRaw = readJson(slipsPath, []);
const gradedRaw = readJson(gradedPath, []);
const pricedRaw = readJson(pricedPath, []);

const slips = Array.isArray(slipsRaw) ? slipsRaw : Object.values(slipsRaw);

const gradedRows = Array.isArray(gradedRaw)
  ? gradedRaw.filter(r => r && r.recordType !== 'grading_summary')
  : Object.values(gradedRaw).filter(r => r && r.recordType !== 'grading_summary');

const pricedRows = Array.isArray(pricedRaw)
  ? pricedRaw.filter(r => r && r.recordType === 'merged_prop')
  : [];

const gradedMap = new Map();
for (const row of gradedRows) {
  gradedMap.set(keyOf(row), row);
}

const currentMap = new Map();
for (const row of pricedRows) {
  currentMap.set(keyOf(row), row);
}

const evaluated = [];
const lines = [];

lines.push('MLB PICK EVALUATION');
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push('');

for (const slip of slips) {
  if (!slip?.legs?.length) continue;

  const slipName = slip.recordType || slip.name || `slip_${slip.size || slip.legs.length}`;

  let hits = 0;
  let misses = 0;
  let pushes = 0;
  let pending = 0;
  let totalClv = 0;
  let clvCount = 0;

  lines.push(slipName.toUpperCase());
  lines.push(`Size: ${slip.size || slip.legs.length}`);
  lines.push('---------------------');

  const legs = [];

  for (const leg of slip.legs) {
    const k = keyOf(leg);
    const graded = gradedMap.get(k);
    const current = currentMap.get(k);

    const side = sideOf(leg) || sideOf(current) || 'UNKNOWN';
    const openLine = num(leg.line);
    const currentLine = num(current?.line);

    let rawMove = null;
    let sideClv = null;

    if (openLine !== null && currentLine !== null) {
      rawMove = currentLine - openLine;
      sideClv = side === 'LESS' ? openLine - currentLine : currentLine - openLine;
      totalClv += sideClv;
      clvCount++;
    }

    const result =
      graded?.result ||
      graded?.outcome ||
      graded?.grade ||
      graded?.status ||
      'PENDING';

    if (result === 'HIT') hits++;
    else if (result === 'MISS') misses++;
    else if (result === 'PUSH') pushes++;
    else pending++;

    const actual = graded?.actual ?? graded?.actualValue ?? graded?.resultValue ?? null;

    const item = {
      slip: slipName,
      player: leg.player,
      team: leg.team,
      game: leg.game,
      stat: leg.stat,
      market: leg.market,
      oddsTier: leg.oddsTier,
      side,
      line: openLine,
      currentLine,
      projection: leg.projection,
      probability: leg.recommendedProb ?? leg.probability ?? null,
      expectedValue: leg.expectedValue ?? null,
      rawMove,
      sideClv,
      actual,
      result,
    };

    legs.push(item);
    evaluated.push(item);

    lines.push(`${leg.player} — ${leg.stat}`);
    lines.push(`Pick: ${side} ${openLine}`);
    lines.push(
      `Current: ${currentLine ?? 'NA'} | CLV: ${
        sideClv === null ? 'NA' : sideClv.toFixed(2)
      } | Actual: ${actual ?? 'NA'} | Result: ${result}`
    );
    lines.push('');
  }

  const decided = hits + misses + pushes;
  const hitRate = decided ? ((hits / decided) * 100).toFixed(1) : 'NA';
  const avgClv = clvCount ? (totalClv / clvCount).toFixed(2) : 'NA';

  lines.push(`Summary: ${hits}-${misses}-${pushes}, Pending: ${pending}`);
  lines.push(`Hit Rate: ${hitRate}%`);
  lines.push(`Avg Side CLV: ${avgClv}`);
  lines.push('---');
  lines.push('');
}

const summary = {
  recordType: 'pick_evaluation_summary',
  createdAt: new Date().toISOString(),
  totalEvaluated: evaluated.length,
  hits: evaluated.filter(r => r.result === 'HIT').length,
  misses: evaluated.filter(r => r.result === 'MISS').length,
  pushes: evaluated.filter(r => r.result === 'PUSH').length,
  pending: evaluated.filter(r => !['HIT', 'MISS', 'PUSH'].includes(r.result)).length,
};

fs.writeFileSync(outJson, JSON.stringify([summary, ...evaluated], null, 2));
fs.writeFileSync(outTxt, lines.join('\n'));

console.log(summary);
console.log(`Saved ${outJson}`);
console.log(`Saved ${outTxt}`);
