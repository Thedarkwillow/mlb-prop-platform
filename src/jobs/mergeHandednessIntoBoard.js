import fs from 'fs';

const BOARD_IN = 'outputs/priced-board.json';
const SPLITS_IN = 'data/savant/handedness-splits.json';
const PROBABLES_IN = 'data/context/probable-pitcher-hands.json';
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

function isExplicitPitcherStrikeout(row) {
  const raw = String(
    row.stat ||
    row.market ||
    row.displayStat ||
    row.statType ||
    row.projectionType ||
    row.description ||
    row.name ||
    ''
  ).toLowerCase();

  return (
    raw.includes('pitcher strikeout') ||
    raw.includes('pitching strikeout') ||
    raw.includes('pitcher_k') ||
    raw.includes('pitcher k')
  );
}

function isPitcherMarket(row, splits = { pitchers: {} }) {
  const m = market(row);
  const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || '').toLowerCase();
  const position = String(row.position || row.playerPosition || '').toUpperCase();
  const key = playerKey(row);

  // Plain "strikeouts" can be hitter strikeouts or pitcher strikeouts.
  // Do not trust dirty playerType/sourceType alone for strikeouts.
  if (m === 'strikeouts') {
    return (
      Boolean(splits.pitchers?.[key]) ||
      position === 'P' ||
      isExplicitPitcherStrikeout(row)
    );
  }

  if (sourceType === 'batter' || sourceType === 'hitter') return false;
  if (sourceType === 'pitcher' || position === 'P') return true;

  return (
    m.includes('pitching') ||
    m.includes('outs') ||
    m.includes('earned_runs_allowed') ||
    m.includes('hits_allowed') ||
    m.includes('walks_allowed') ||
    m.includes('pitches_thrown') ||
    m.includes('pitcher_fantasy')
  );
}

function playerKey(row) {
  return norm(row.player);
}

function teamKey(row) {
  return String(row.resolvedTeam || row.team || '').toUpperCase().trim();
}

function inferPitcherHand(row, probables) {
  const raw = String(
    row.pitcherThrows ||
    row.opponentPitcherThrows ||
    row.probablePitcherThrows ||
    row.p_throws ||
    row.pitcherHand ||
    row.opposingPitcherHand ||
    ''
  ).toUpperCase();

  if (raw.startsWith('L')) return { hand: 'L', source: 'row' };
  if (raw.startsWith('R')) return { hand: 'R', source: 'row' };

  const team = teamKey(row);
  const opp = probables.opponentPitcherByTeam?.[team];

  if (opp?.hand) {
    return {
      hand: opp.hand,
      source: 'probable_pitcher_context',
      pitcher: opp.pitcher,
      opponent: opp.opponent,
      gamePk: opp.gamePk
    };
  }

  return { hand: null, source: 'unknown' };
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

function attachHandedness(row, splits, probables) {
  const key = playerKey(row);
  const pitcherMarket = isPitcherMarket(row, splits);

  if (pitcherMarket) {
    const rec = splits.pitchers?.[key];

    if (!rec) {
      return {
        ...row,
        handednessMatched: false,
        handednessReady: false,
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
      handednessReady: Boolean(vsKey),
      handednessMatchType: vsKey ? 'PITCHER_VS_BATTER_HAND' : 'PITCHER_SPLIT_AVAILABLE_BATTER_HAND_UNKNOWN',
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
      handednessReady: false,
      handednessMatchType: 'NO_BATTER_SPLIT'
    };
  }

  const pitcherHandInfo = inferPitcherHand(row, probables);
  const pitcherHand = pitcherHandInfo.hand;

  const vsKey =
    pitcherHand === 'L' ? 'vsLHP' :
    pitcherHand === 'R' ? 'vsRHP' :
    null;

  return {
    ...row,
    handednessMatched: true,
    handednessReady: Boolean(vsKey),
    handednessMatchType: vsKey ? 'BATTER_VS_PITCHER_HAND' : 'BATTER_SPLIT_AVAILABLE_PITCHER_HAND_UNKNOWN',
    handednessContext: {
      playerType: 'batter',
      pitcherHand,
      pitcherHandSource: pitcherHandInfo.source,
      opposingPitcher: pitcherHandInfo.pitcher ?? null,
      opponent: pitcherHandInfo.opponent ?? null,
      selectedSplit: vsKey,
      vsLHP: splitSummary(rec.vsLHP),
      vsRHP: splitSummary(rec.vsRHP),
      active: vsKey ? splitSummary(rec[vsKey]) : null
    }
  };
}

const board = read(BOARD_IN, []);
const splits = read(SPLITS_IN, { batters: {}, pitchers: {} });
const probables = read(PROBABLES_IN, { opponentPitcherByTeam: {} });

let props = 0;
let matched = 0;
let activeKnown = 0;
let batterMatched = 0;
let pitcherMatched = 0;
let probableHandUsed = 0;

const out = board.map(row => {
  if (row.recordType !== 'merged_prop') return row;

  props += 1;

  const next = attachHandedness(row, splits, probables);

  if (next.handednessMatched) {
    matched += 1;
    if (next.handednessContext?.playerType === 'batter') batterMatched += 1;
    if (next.handednessContext?.playerType === 'pitcher') pitcherMatched += 1;
  }

  if (next.handednessContext?.active) activeKnown += 1;
  if (next.handednessContext?.pitcherHandSource === 'probable_pitcher_context') probableHandUsed += 1;

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
  `Probable pitcher hand used: ${probableHandUsed}`,
  `Batter split cache count: ${Object.keys(splits.batters || {}).length}`,
  `Pitcher split cache count: ${Object.keys(splits.pitchers || {}).length}`,
  '',
  'NOTE: metadata only. No probability movement applied.'
].join('\n');

fs.writeFileSync(REPORT_OUT, report + '\n');
console.log(report);
