import fs from 'fs';

const IN_FILE = 'outputs/merged-board.json';
const OUT_FILE = 'outputs/priced-board.json';

const CONTEXT_FILES = {
  lineups: 'data/context/lineups.json',
  bullpen: 'data/context/bullpen-fatigue.json',
  travel: 'data/context/travel-rest.json',
  umpires: 'data/context/umpires.json',
  catchers: 'data/context/catcher-framing.json',
  calibration: 'data/learning/confidence-calibration.json',
  volatility: 'data/learning/market-volatility.json',
  autoMarkets: 'data/learning/auto-market-adjustments.json'
};

function readJson(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const CTX = Object.fromEntries(
  Object.entries(CONTEXT_FILES).map(([k, p]) => [k, readJson(p, {})])
);

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function round(n, d = 3) {
  return Number(Number(n).toFixed(d));
}

function norm(v) {
  return String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function marketKey(row) {
  return norm(row.market || row.stat).replace(/\s+/g, '_');
}

function sideKey(row) {
  return String(row.recommendedSide || row.side || '').toUpperCase().includes('LESS') ? 'LESS' : 'MORE';
}

function teamKey(row) {
  return String(row.resolvedTeam || row.team || '').toUpperCase().trim();
}

function opponentKey(row) {
  return String(row.opponent || row.resolvedOpponent || '').toUpperCase().trim();
}

function gameKey(row) {
  return norm(row.resolvedGame || row.game || '');
}

function probBucket(prob) {
  const p = clamp(Number(prob), 0.01, 0.99);
  const low = Math.floor(p * 20) / 20;
  const high = low + 0.05;
  return `${low.toFixed(2)}-${high.toFixed(2)}`;
}

function marketSigma(market, line) {
  if (market === 'strikeouts') return 1.65;
  if (market === 'bases') return 1.35;
  if (market === 'hrr') return 1.25;
  if (market === 'hits') return 0.75;
  if (market === 'hr') return 0.35;
  if (market === 'rbis') return 0.9;
  if (market === 'runs') return 0.85;
  return Math.max(1, Math.sqrt(Math.max(Number(line) || 1, 1)));
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function probabilityOver(projection, line, market) {
  const sigma = marketSigma(market, line);
  return clamp(sigmoid((projection - line) / sigma), 0.01, 0.99);
}

function confidenceBucket(prob) {
  const edgeProb = Math.abs(prob - 0.5);
  if (edgeProb >= 0.16) return 'elite';
  if (edgeProb >= 0.11) return 'strong';
  if (edgeProb >= 0.07) return 'playable';
  if (edgeProb >= 0.04) return 'lean';
  return 'pass';
}

function impliedMultiplierEV(prob, oddsTier) {
  const payout =
    oddsTier === 'demon' ? 2.0 :
    oddsTier === 'goblin' ? 1.15 :
    1.0;

  return prob * payout - (1 - prob);
}

function applyContextToProjection(row) {
  const market = marketKey(row);
  const team = teamKey(row);
  const opp = opponentKey(row);
  const game = gameKey(row);

  let projection = Number(row.projection);
  let contextProjectionDelta = 0;
  let contextProbDelta = 0;
  const flags = [];

  const lineup = CTX.lineups.players?.[norm(row.player)] || CTX.lineups.teams?.[team];
  if (lineup) {
    if (lineup.battingOrder && Number(lineup.battingOrder) >= 7 && ['hits', 'bases', 'hrr', 'runs', 'rbis'].includes(market)) {
      contextProjectionDelta -= 0.015;
      flags.push('LOW_LINEUP_SLOT_PROJECTION_DOWN');
    }
    if (lineup.status && !['confirmed', 'starting', 'active'].includes(norm(lineup.status))) {
      contextProbDelta -= 0.025;
      flags.push('LINEUP_NOT_CONFIRMED_PROB_DOWN');
    }
  }

  const bullpenTeam = opp || team;
  const pen = CTX.bullpen.teams?.[bullpenTeam];
  if (pen) {
    const tired =
      pen.fatigue === 'HIGH' ||
      Number(pen.backToBackRelievers || 0) >= 3 ||
      Number(pen.pitchCountLast2Days || 0) >= 90;

    if (tired && ['hits', 'bases', 'hrr', 'runs', 'rbis'].includes(market)) {
      contextProjectionDelta += 0.02;
      flags.push('OPP_BULLPEN_FATIGUE_HITTER_BOOST');
    }

    if (tired && ['pitching_outs'].includes(market)) {
      contextProjectionDelta -= 0.015;
      flags.push('BULLPEN_FATIGUE_OUTS_DOWN');
    }
  }

  const rest = CTX.travel.teams?.[team];
  if (rest && (rest.travelSpot === 'BAD' || rest.restDisadvantage === true)) {
    contextProbDelta -= 0.0125;
    flags.push('TRAVEL_REST_PROB_DOWN');
  }

  const ump = CTX.umpires.games?.[game];
  if (ump && market === 'strikeouts') {
    const kFactor = Number(ump.kFactor || 0);
    if (ump.kBoost === true || kFactor > 0.03) {
      contextProjectionDelta += 0.018;
      flags.push('UMPIRE_K_PROJECTION_BOOST');
    }
    if (ump.kDowngrade === true || kFactor < -0.03) {
      contextProjectionDelta -= 0.018;
      flags.push('UMPIRE_K_PROJECTION_DOWN');
    }
  }

  const frame = CTX.catchers.teams?.[team] || CTX.catchers.players?.[norm(row.catcher)];
  if (frame && market === 'strikeouts') {
    if (frame.framing === 'PLUS' || Number(frame.framingRuns || 0) > 3) {
      contextProjectionDelta += 0.0125;
      flags.push('CATCHER_FRAMING_K_BOOST');
    }
    if (frame.framing === 'MINUS' || Number(frame.framingRuns || 0) < -3) {
      contextProjectionDelta -= 0.0125;
      flags.push('CATCHER_FRAMING_K_DOWN');
    }
  }

  const adjustedProjection = projection * (1 + contextProjectionDelta);

  return {
    projection: adjustedProjection,
    context: {
      projectionDeltaPct: round(contextProjectionDelta, 4),
      probDelta: round(contextProbDelta, 4),
      flags
    }
  };
}

function applyCalibration(row, prob) {
  const market = marketKey(row);
  const side = sideKey(row);
  const bucket = probBucket(prob);

  const exactKey = `${market}_${side}_${bucket}`;
  const mdKey = `${market}_${side}`;

  const exact = CTX.calibration.byMarketDirectionBucket?.[exactKey];
  const md = CTX.calibration.byMarketDirection?.[mdKey];
  const b = CTX.calibration.byBucket?.[bucket];

  const chosen =
    exact && exact.sample >= 30 ? exact :
    md && md.sample >= 50 ? md :
    b && b.sample >= 75 ? b :
    null;

  if (!chosen) {
    return {
      prob,
      calibration: { applied: false, key: null, multiplier: 1, sample: 0 }
    };
  }

  const multiplier = Number(chosen.multiplier || chosen.adjustmentMultiplier || 1);
  const calibrated = clamp(prob * multiplier, 0.01, 0.99);

  return {
    prob: calibrated,
    calibration: {
      applied: true,
      key: chosen === exact ? exactKey : chosen === md ? mdKey : bucket,
      multiplier: round(multiplier, 4),
      sample: chosen.sample || 0,
      predicted: chosen.predicted ?? null,
      actual: chosen.actual ?? null,
      action: chosen.action ?? null
    }
  };
}

function applyMarketIntelligence(row, prob, ev) {
  const market = marketKey(row);
  const side = sideKey(row);
  const mdKey = `${market}_${side}`;

  const vol = CTX.volatility.byMarketDirection?.[mdKey] || CTX.volatility.byMarket?.[market];
  const auto = CTX.autoMarkets.byMarketDirection?.[mdKey] || CTX.autoMarkets.byMarket?.[market];

  let adjustedProb = prob;
  let adjustedEV = ev;
  const actions = [];

  if (vol?.volatilityScore >= 0.7) {
    adjustedProb = 0.5 + (adjustedProb - 0.5) * 0.88;
    adjustedEV *= 0.88;
    actions.push('VOLATILITY_SHRINK');
  }

  if (auto?.action === 'suppress') {
    adjustedProb = 0.5 + (adjustedProb - 0.5) * 0.75;
    adjustedEV *= 0.75;
    actions.push('AUTO_SUPPRESS');
  } else if (auto?.action === 'downgrade') {
    adjustedProb = 0.5 + (adjustedProb - 0.5) * 0.86;
    adjustedEV *= 0.86;
    actions.push('AUTO_DOWNGRADE');
  } else if (auto?.action === 'boost') {
    adjustedProb = 0.5 + (adjustedProb - 0.5) * 1.04;
    adjustedEV *= 1.04;
    actions.push('AUTO_BOOST');
  }

  return {
    prob: clamp(adjustedProb, 0.01, 0.99),
    ev: adjustedEV,
    marketIntelligence: {
      applied: actions.length > 0,
      actions,
      volatilityScore: vol?.volatilityScore ?? null,
      autoAction: auto?.action ?? null,
      sample: auto?.sample ?? vol?.sample ?? 0
    }
  };
}

const board = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));

const priced = board.map(row => {
  if (
    row.recordType !== 'merged_prop' ||
    row.projection === null ||
    row.line === null ||
    !row.market
  ) {
    return { ...row, pricingStatus: 'UNPRICED' };
  }

  const market = marketKey(row);
  const contextResult = applyContextToProjection(row);
  const contextProjection = contextResult.projection;

  let overProb = probabilityOver(contextProjection, row.line, market);
  overProb = clamp(overProb + contextResult.context.probDelta, 0.01, 0.99);

  let underProb = 1 - overProb;

  let recommendedSide = overProb >= 0.5 ? 'MORE' : 'LESS';
  let recommendedProb = Math.max(overProb, underProb);

  const calibrationResult = applyCalibration(
    { ...row, recommendedSide },
    recommendedProb
  );

  recommendedProb = calibrationResult.prob;

  if (recommendedSide === 'MORE') {
    overProb = recommendedProb;
    underProb = 1 - recommendedProb;
  } else {
    underProb = recommendedProb;
    overProb = 1 - recommendedProb;
  }

  let expectedValue = impliedMultiplierEV(recommendedProb, row.oddsTier);

  const intel = applyMarketIntelligence(
    { ...row, recommendedSide },
    recommendedProb,
    expectedValue
  );

  recommendedProb = intel.prob;
  expectedValue = intel.ev;

  if (recommendedSide === 'MORE') {
    overProb = recommendedProb;
    underProb = 1 - recommendedProb;
  } else {
    underProb = recommendedProb;
    overProb = 1 - recommendedProb;
  }

  return {
    ...row,
    pricingStatus: 'PRICED',
    rawProjection: round(row.projection),
    contextAdjustedProjection: round(contextProjection),
    projection: round(contextProjection),
    overProb: round(overProb),
    underProb: round(underProb),
    recommendedSide,
    recommendedProb: round(recommendedProb),
    fairLine: round(contextProjection),
    expectedValue: round(expectedValue),
    confidenceBucket: confidenceBucket(recommendedProb),
    contextAdjustment: contextResult.context,
    calibrationAdjustment: calibrationResult.calibration,
    marketIntelligence: intel.marketIntelligence,
    adaptiveIntelligenceVersion: 'tier_a_v1'
  };
});

const summary = {
  recordType: 'pricing_summary',
  createdAt: new Date().toISOString(),
  intelligenceVersion: 'tier_a_v1',
  totalRows: priced.length,
  pricedRows: priced.filter(r => r.pricingStatus === 'PRICED').length,
  contextAdjustedRows: priced.filter(r => r.contextAdjustment?.flags?.length).length,
  calibratedRows: priced.filter(r => r.calibrationAdjustment?.applied).length,
  marketIntelligenceRows: priced.filter(r => r.marketIntelligence?.applied).length,
  elite: priced.filter(r => r.confidenceBucket === 'elite').length,
  strong: priced.filter(r => r.confidenceBucket === 'strong').length,
  playable: priced.filter(r => r.confidenceBucket === 'playable').length,
  lean: priced.filter(r => r.confidenceBucket === 'lean').length,
  pass: priced.filter(r => r.confidenceBucket === 'pass').length
};

fs.writeFileSync(OUT_FILE, JSON.stringify([summary, ...priced], null, 2));

console.log(summary);
console.log(`Saved ${OUT_FILE}`);
