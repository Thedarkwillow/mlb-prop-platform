import fs from 'fs';

const BOARD_IN = 'outputs/priced-board.json';
const SAVANT_IN = 'data/savant-latest.json';
const BOARD_OUT = 'outputs/priced-board.json';
const REPORT_OUT = 'outputs/savant-merge-report.txt';

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function write(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function marketOf(row) {
  return String(row.market || row.stat || '').toLowerCase();
}

function isPitcherMarket(row) {
  const m = marketOf(row);
  return (
    m.includes('strikeout') ||
    m.includes('pitching') ||
    m.includes('outs') ||
    m.includes('earned') ||
    m.includes('walks_allowed') ||
    m.includes('hits_allowed')
  );
}

function buildSavantMaps(rows) {
  const hitters = new Map();
  const pitchers = new Map();

  for (const r of rows) {
    if (r.recordType !== 'savant_player') continue;
    if (!r.player) continue;

    const key = norm(r.player);

    if (r.playerType === 'batter') hitters.set(key, r);
    if (r.playerType === 'pitcher') pitchers.set(key, r);
  }

  return { hitters, pitchers };
}

function attachSavant(row, savant) {
  if (!savant) {
    return {
      ...row,
      savantMatched: false
    };
  }

  return {
    ...row,
    savantMatched: true,
    savantPlayerId: savant.playerId || null,
    savantPlayerType: savant.playerType || null,

    savant: {
      pa: savant.pa ?? null,
      woba: savant.woba ?? null,
      xba: savant.xba ?? null,
      xslg: savant.xslg ?? null,
      xwoba: savant.xwoba ?? null,
      barrelRate: savant.barrelRate ?? null,
      hardHitRate: savant.hardHitRate ?? null,
      avgExitVelocity: savant.avgExitVelocity ?? null,
      avgLaunchAngle: savant.avgLaunchAngle ?? null,
      kRate: savant.kRate ?? null,
      bbRate: savant.bbRate ?? null,
      whiffRate: savant.whiffRate ?? null
    }
  };
}

function savantBoost(row, savant) {
  if (!savant) return 0;

  const m = marketOf(row);
  let boost = 0;

  // Hitter markets
  if (
    m.includes('bases') ||
    m.includes('hrr') ||
    m.includes('hits+runs+rbis') ||
    m.includes('hits') ||
    m.includes('runs') ||
    m.includes('rbis')
  ) {
    if (savant.xwoba != null && savant.xwoba >= 0.370) boost += 0.015;
    if (savant.xwoba != null && savant.xwoba <= 0.285) boost -= 0.015;

    if (savant.xslg != null && savant.xslg >= 0.500) boost += 0.010;
    if (savant.xslg != null && savant.xslg <= 0.330) boost -= 0.010;

    if (savant.barrelRate != null && savant.barrelRate >= 10) boost += 0.010;
    if (savant.hardHitRate != null && savant.hardHitRate >= 45) boost += 0.0075;

    if (savant.kRate != null && savant.kRate >= 28) boost -= 0.0075;
  }

  // Pitcher strikeout support
  if (m.includes('strikeout')) {
    if (savant.kRate != null && savant.kRate >= 28) boost += 0.015;
    if (savant.kRate != null && savant.kRate <= 18) boost -= 0.015;
    if (savant.whiffRate != null && savant.whiffRate >= 30) boost += 0.010;
  }

  // Cap: Savant is a modifier, not the main model
  if (boost > 0.03) boost = 0.03;
  if (boost < -0.03) boost = -0.03;

  return boost;
}

function main() {
  const board = read(BOARD_IN, []);
  const savantRows = read(SAVANT_IN, []);

  const { hitters, pitchers } = buildSavantMaps(savantRows);

  let mergedProps = 0;
  let matched = 0;
  let hitterMatches = 0;
  let pitcherMatches = 0;
  let boosted = 0;

  const out = board.map(row => {
    if (row.recordType !== 'merged_prop') return row;

    mergedProps++;

    const key = norm(row.player);
    const pitcherMarket = isPitcherMarket(row);

    const savant = pitcherMarket
      ? pitchers.get(key)
      : hitters.get(key);

    if (savant) {
      matched++;
      if (pitcherMarket) pitcherMatches++;
      else hitterMatches++;
    }

    let next = attachSavant(row, savant);

    const boost = savantBoost(row, savant);

    if (boost !== 0 && Number.isFinite(Number(row.recommendedProb))) {
      boosted++;

      const oldProb = Number(row.recommendedProb);
      const newProb = Math.max(0.01, Math.min(0.99, oldProb + boost));

      next = {
        ...next,
        savantBoost: Number(boost.toFixed(4)),
        recommendedProbBeforeSavant: oldProb,
        recommendedProb: Number(newProb.toFixed(4)),
        probabilitySource: `${row.probabilitySource || 'unknown'}+savant`
      };

      if (Number.isFinite(Number(row.expectedValue))) {
        const oldEv = Number(row.expectedValue);
        const evBump = boost * 2;
        next.expectedValueBeforeSavant = oldEv;
        next.expectedValue = Number(Math.max(0, oldEv + evBump).toFixed(4));
      }
    } else {
      next = {
        ...next,
        savantBoost: 0
      };
    }

    return next;
  });

  write(BOARD_OUT, out);

  const report = [
    'SAVANT MERGE REPORT',
    `Board rows: ${board.length}`,
    `Merged props: ${mergedProps}`,
    `Savant rows: ${savantRows.length}`,
    `Matched props: ${matched}`,
    `Match rate: ${mergedProps ? ((matched / mergedProps) * 100).toFixed(1) : '0.0'}%`,
    `Hitter matches: ${hitterMatches}`,
    `Pitcher matches: ${pitcherMatches}`,
    `Boosted rows: ${boosted}`
  ].join('\n');

  fs.writeFileSync(REPORT_OUT, report);

  console.log(report);
}

main();
