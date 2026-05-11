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
  autoMarkets: 'data/learning/auto-market-adjustments.json',
  savantForm: 'data/savant/rolling-form.json'
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

function playerKey(row) {
  return String(row.player || '')
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function isPitcherMarket(row) {
  const m = marketKey(row);
  return (
    m.includes('strikeout') ||
    m.includes('pitching') ||
    m.includes('outs') ||
    m.includes('earned_runs_allowed') ||
    m.includes('hits_allowed')
  );
}

function applySavantRollingForm(row, prob) {
  const key = playerKey(row);
  const market = marketKey(row);
  const side = sideKey(row);
  const pitcherMarket = isPitcherMarket(row);

  const form = pitcherMarket
    ? CTX.savantForm.pitchers?.[key]
    : CTX.savantForm.hitters?.[key];

  if (!form) {
    return {
      prob,
      savantRollingForm: {
        applied: false,
        reason: 'NO_FORM_MATCH'
      }
    };
  }

  let delta = 0;
  const flags = [];

  if (!pitcherMarket) {
    if (['hits', 'bases', 'hrr', 'runs', 'rbis', 'hr'].includes(market)) {
      if (form.formTier === 'hot') {
        delta += side === 'MORE' ? 0.018 : -0.018;
        flags.push('HOT_HITTER_FORM');
      } else if (form.formTier === 'positive') {
        delta += side === 'MORE' ? 0.010 : -0.010;
        flags.push('POSITIVE_HITTER_FORM');
      } else if (form.formTier === 'cold') {
        delta += side === 'MORE' ? -0.018 : 0.018;
        flags.push('COLD_HITTER_FORM');
      } else if (form.formTier === 'negative') {
        delta += side === 'MORE' ? -0.010 : 0.010;
        flags.push('NEGATIVE_HITTER_FORM');
      }
    }

    if (form.flags?.includes('K_RISK') && ['hits', 'bases', 'hrr'].includes(market)) {
      delta += side === 'MORE' ? -0.006 : 0.006;
      flags.push('HITTER_K_RISK');
    }
  }

  if (pitcherMarket && market.includes('strikeout')) {
    if (form.formTier === 'hot') {
      delta += side === 'MORE' ? 0.018 : -0.018;
      flags.push('HOT_PITCHER_K_FORM');
    } else if (form.formTier === 'positive') {
      delta += side === 'MORE' ? 0.010 : -0.010;
      flags.push('POSITIVE_PITCHER_K_FORM');
    } else if (form.formTier === 'cold') {
      delta += side === 'MORE' ? -0.018 : 0.018;
      flags.push('COLD_PITCHER_K_FORM');
    } else if (form.formTier === 'negative') {
      delta += side === 'MORE' ? -0.010 : 0.010;
      flags.push('NEGATIVE_PITCHER_K_FORM');
    }
  }

  // Hard cap: Savant rolling form is a modifier only.
  delta = clamp(delta, -0.02, 0.02);

  return {
    prob: clamp(prob + delta, 0.01, 0.99),
    savantRollingForm: {
      applied: delta !== 0,
      playerType: form.playerType,
      formTier: form.formTier,
      formScore: form.formScore,
      delta: round(delta, 4),
      flags,
      metrics: form.metrics || null
    }
  };
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


function handednessDeltaFromContext(row) {
  const h = row.handednessContext;
  const market = marketKey(row);
  const side = sideKey(row);

  if (!row.handednessReady || !h?.active) {
    return {
      delta: 0,
      applied: false,
      reason: 'NO_ACTIVE_HANDEDNESS_SPLIT'
    };
  }

  // Start hitter markets only. Pitcher-vs-batter-hand needs lineup handedness first.
  if (h.playerType !== 'batter') {
    return {
      delta: 0,
      applied: false,
      reason: 'PITCHER_SPLIT_METADATA_ONLY'
    };
  }

  if (!['hits', 'bases', 'hrr', 'runs', 'rbis', 'hr'].includes(market)) {
    return {
      delta: 0,
      applied: false,
      reason: 'MARKET_NOT_SUPPORTED'
    };
  }

  // HRR MORE stays conservative because this market has been unstable.
  if (market === 'hrr' && side === 'MORE') {
    return {
      delta: 0,
      applied: false,
      reason: 'HRR_MORE_NO_HANDEDNESS_BOOST'
    };
  }

  const active = h.active;
  const pa = Number(active.pa || 0);
  const xwoba = Number(active.xwoba);
  const xslg = Number(active.xslg);
  const kRate = Number(active.kRate);

  if (pa < 40) {
    return {
      delta: 0,
      applied: false,
      reason: 'SPLIT_SAMPLE_TOO_THIN',
      pa
    };
  }

  let strength = 0;
  const flags = [];

  if (Number.isFinite(xwoba)) {
    if (xwoba >= 0.390) {
      strength += 2;
      flags.push('PLUS_SPLIT_XWOBA');
    } else if (xwoba >= 0.350) {
      strength += 1;
      flags.push('GOOD_SPLIT_XWOBA');
    } else if (xwoba <= 0.285) {
      strength -= 2;
      flags.push('WEAK_SPLIT_XWOBA');
    } else if (xwoba <= 0.310) {
      strength -= 1;
      flags.push('BELOW_AVG_SPLIT_XWOBA');
    }
  }

  if (Number.isFinite(xslg)) {
    if (xslg >= 0.500) {
      strength += 1;
      flags.push('PLUS_SPLIT_XSLG');
    } else if (xslg <= 0.340) {
      strength -= 1;
      flags.push('WEAK_SPLIT_XSLG');
    }
  }

  if (Number.isFinite(kRate) && ['hits', 'bases', 'hrr'].includes(market)) {
    if (kRate >= 28) {
      strength -= 1;
      flags.push('SPLIT_K_RISK');
    } else if (kRate <= 17) {
      strength += 1;
      flags.push('LOW_SPLIT_K_RATE');
    }
  }

  let rawDelta = 0;
  if (strength >= 3) rawDelta = 0.015;
  else if (strength >= 1) rawDelta = 0.008;
  else if (strength <= -3) rawDelta = -0.015;
  else if (strength <= -1) rawDelta = -0.008;

  // Convert to selected side probability.
  let delta = side === 'MORE' ? rawDelta : -rawDelta;

  // Hard cap.
  delta = clamp(delta, -0.015, 0.015);

  return {
    delta,
    applied: delta !== 0,
    reason: delta !== 0 ? 'HANDEDNESS_SPLIT_ADJUSTED' : 'NEUTRAL_SPLIT',
    pa,
    selectedSplit: h.selectedSplit,
    pitcherHand: h.pitcherHand ?? null,
    opposingPitcher: h.opposingPitcher ?? null,
    strength,
    flags,
    active
  };
}

function applyHandednessAdjustment(row, prob) {
  const adj = handednessDeltaFromContext(row);
  return {
    prob: clamp(prob + adj.delta, 0.01, 0.99),
    handednessAdjustment: {
      applied: adj.applied,
      delta: round(adj.delta, 4),
      reason: adj.reason,
      pa: adj.pa ?? null,
      selectedSplit: adj.selectedSplit ?? null,
      pitcherHand: adj.pitcherHand ?? null,
      opposingPitcher: adj.opposingPitcher ?? null,
      strength: adj.strength ?? null,
      flags: adj.flags ?? [],
      active: adj.active ?? null
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

  const savantFormResult = applySavantRollingForm(
    { ...row, recommendedSide },
    recommendedProb
  );

  recommendedProb = savantFormResult.prob;

  const handednessResult = applyHandednessAdjustment(
    { ...row, recommendedSide },
    recommendedProb
  );

  recommendedProb = handednessResult.prob;

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
    savantRollingForm: savantFormResult.savantRollingForm,
    handednessAdjustment: handednessResult.handednessAdjustment,
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
  savantFormAdjustedRows: priced.filter(r => r.savantRollingForm?.applied).length,
  handednessAdjustedRows: priced.filter(r => r.handednessAdjustment?.applied).length,
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
