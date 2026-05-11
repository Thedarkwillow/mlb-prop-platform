import fs from 'fs';

const BOARD_IN = 'outputs/priced-board.json';
const SPLITS_IN = 'data/savant/handedness-splits.json';
const BOARD_OUT = 'outputs/priced-board.json';
const REPORT_OUT = 'outputs/handedness-merge-report.txt';

function read(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function write(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function displayName(v) {
  const raw = String(v || '').trim();
  if (raw.includes(',')) {
    const [last, first] = raw.split(',').map(x => x.trim());
    if (first && last) return `${first} ${last}`;
  }
  return raw;
}

function norm(v) {
  return displayName(v)
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function market(row) {
  return String(row.market || row.stat || '').toLowerCase().replace(/\s+/g, '_').trim();
}

function isPitcherMarket(row) {
  const m = market(row);
  return (
    m.includes('strikeout') ||
    m.includes('pitching') ||
    m.includes('outs') ||
    m.includes('earned_runs_allowed') ||
    m.includes('hits_allowed')
  );
}

function playerKey(row) {
  return norm(row.player);
}

function inferPitcherHand(row) {
  const raw = String(
    row.pitcherThrows ||
    row.opponentPitcherThrows ||
    row.probablePitcherThrows ||
    row.p_throws ||
    row.pitcherHand ||
    row.opposingPitcherHand ||
    ''
  ).toUpperCase();

  if (raw.startsWith('L')) return 'L';
  if (raw.startsWith('R')) return 'R';
  return null;
}

function inferBatterStand(row) {
  const raw = String(
    row.batterStands ||
    row.bats ||
    row.stand ||
    row.batterHand ||
    row.playerHand ||
    ''
  ).toUpperCase();

  if (raw.startsWith('L')) return 'L';
  if (raw.startsWith('R')) return 'R';
  if (raw.startsWith('S')) return 'S';
  return null;
}

function splitQuality(split) {
  const pa = Number(split?.pa ?? 0);
  if (pa >= 75) return 'strong';
  if (pa >= 40) return 'usable';
  if (pa >= 20) return 'thin';
  if (pa > 0) return 'tiny';
  return 'none';
}

function splitSummary(split) {
  if (!split) return null;
  return {
    pa: split.pa ?? null,
    pitches: split.pitches ?? null,
    xwoba: split.xwoba ?? null,
    xslg: split.xslg ?? null,
    xba: split.xba ?? null,
    kRate: split.kRate ?? null,
    bbRate: split.bbRate ?? null,
    whiffRate: split.whiffRate ?? null,
    hardHitRate: split.hardHitRate ?? null,
    barrelRate: split.barrelRate ?? null,
    quality: splitQuality(split)
  };
}

function attachHandedness(row, splits) {
  const key = playerKey(row);
  const pitcherMarket = isPitcherMarket(row);

  if (pitcherMarket) {
    const rec = splits.pitchers?.[key];
    if (!rec) {
      return {
        ...row,
        handednessMatched: false,
        handednessMatchType: 'NO_PITCHER_SPLIT'
      };
    }

    const batterStand = inferBatterStand(row);
    const vsKey =
      batterStand === 'L' ? 'vsLHB' :
      batterStand === 'R' ? 'vsRHB' :
      null;

    return {
      ...row,
      handednessMatched: true,
      handednessMatchType: vsKey ? 'PITCHER_VS_BATTER_HAND' : 'PITCHER_SPLIT_AVAILABLE_HAND_UNKNOWN',
      handednessContext: {
        playerType: 'pitcher',
        batterStand,
        selectedSplit: vsKey,
        vsLHB: splitSummary(rec.vsLHB),
        vsRHB: splitSummary(rec.vsRHB),
        active: vsKey ? splitSummary(rec[vsKey]) : null
      }
    };
  }

  const rec = splits.batters?.[key];
  if (!rec) {
    return {
      ...row,
      handednessMatched: false,
      handednessMatchType: 'NO_BATTER_SPLIT'
    };
  }

  const pitcherHand = inferPitcherHand(row);
  const vsKey =
    pitcherHand === 'L' ? 'vsLHP' :
    pitcherHand === 'R' ? 'vsRHP' :
    null;

  return {
    ...row,
    handednessMatched: true,
    handednessMatchType: vsKey ? 'BATTER_VS_PITCHER_HAND' : 'BATTER_SPLIT_AVAILABLE_HAND_UNKNOWN',
    handednessContext: {
      playerType: 'batter',
      pitcherHand,
      selectedSplit: vsKey,
      vsLHP: splitSummary(rec.vsLHP),
      vsRHP: splitSummary(rec.vsRHP),
      active: vsKey ? splitSummary(rec[vsKey]) : null
    }
  };
}

const board = read(BOARD_IN, []);
const splits = read(SPLITS_IN, { batters: {}, pitchers: {} });

let props = 0;
let matched = 0;
let activeKnown = 0;
let batterMatched = 0;
let pitcherMatched = 0;

const out = board.map(row => {
  if (row.recordType !== 'merged_prop') return row;

  props += 1;

  const next = attachHandedness(row, splits);

  if (next.handednessMatched) {
    matched += 1;
    if (next.handednessContext?.playerType === 'batter') batterMatched += 1;
    if (next.handednessContext?.playerType === 'pitcher') pitcherMatched += 1;
  }

  if (next.handednessContext?.active) activeKnown += 1;

  return next;
});

write(BOARD_OUT, out);

const report = [
  'HANDEDNESS MERGE REPORT',
  '=======================',
  `Board rows: ${board.length}`,
  `Merged props: ${props}`,
  `Matched splits: ${matched}`,
  `Active matchup split known: ${activeKnown}`,
  `Batter matched: ${batterMatched}`,
  `Pitcher matched: ${pitcherMatched}`,
  `Batter split cache count: ${Object.keys(splits.batters || {}).length}`,
  `Pitcher split cache count: ${Object.keys(splits.pitchers || {}).length}`,
  '',
  'NOTE: metadata only. No probability movement applied.'
].join('\n');

fs.writeFileSync(REPORT_OUT, report + '\n');
console.log(report);
