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
  savantForm: 'data/savant/rolling-form.json',
  handednessSplits: 'data/savant/handedness-splits.json',
  probablePitcherHands: 'data/context/probable-pitcher-hands.json',
  umpireContext: 'data/context/umpires.json',
  catcherFraming: 'data/context/catcher-framing.json'
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
  const market = canonicalMarket(row);
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


function projectionFromBallpark(row, market) {
  const bp = row.ballpark || {};
  const raw = bp.raw || {};
  const isPitcher =
    row.sourceType === 'pitcher' ||
    bp.recordType === 'pitcher' ||
    String(bp.exportName || '').toLowerCase().includes('pitcher');

  if (market === 'pitching_outs') {
    if (!isPitcher) return NaN;
    const innings = Number(bp.innings ?? raw.Innings);
    if (Number.isFinite(innings) && innings > 0) return innings * 3;
    return NaN;
  }

  if (market === 'walks_allowed') {
    const bp = row.ballpark || {};
    const v = Number(bp.walksAllowed ?? bp.walks ?? bp.raw?.Walks ?? bp.raw?.BaseOnBalls ?? row.projection);
    if (Number.isFinite(v) && v >= 0) return v;
    return NaN;
  }

  if (market === 'hits_allowed') {
    const bp = row.ballpark || {};
    const v = Number(row.projection ?? bp.hitsAllowed ?? bp.raw?.HitsAllowed);
    return Number.isFinite(v) && v > 0 ? v : NaN;
  }

  if (market === 'earned_runs_allowed') {
    const bp = row.ballpark || {};
    const v = Number(row.projection ?? bp.earnedRunsAllowed ?? bp.runsAllowed ?? bp.raw?.EarnedRunsAllowed ?? bp.raw?.RunsAllowed);
    return Number.isFinite(v) && v >= 0 ? v : NaN;
  }

  if (market === 'walks_allowed') {
    const bp = row.ballpark || {};
    const v = Number(bp.walksAllowed ?? bp.walks ?? bp.raw?.Walks ?? bp.raw?.BaseOnBalls ?? row.projection);
    if (Number.isFinite(v) && v >= 0) return v;
    return NaN;
  }

  if (market === 'hits_allowed') {
    const bp = row.ballpark || {};
    const v = Number(row.projection ?? bp.hitsAllowed ?? bp.raw?.HitsAllowed);
    return Number.isFinite(v) && v > 0 ? v : NaN;
  }

  if (market === 'earned_runs_allowed') {
    const bp = row.ballpark || {};
    const v = Number(row.projection ?? bp.earnedRunsAllowed ?? bp.runsAllowed ?? bp.raw?.EarnedRunsAllowed ?? bp.raw?.RunsAllowed);
    return Number.isFinite(v) && v >= 0 ? v : NaN;
  }

  if (market === 'walks_allowed') {
    const bp = row.ballpark || {};
    const v = Number(bp.walksAllowed ?? bp.walks ?? bp.raw?.Walks ?? bp.raw?.BaseOnBalls ?? row.projection);
    if (Number.isFinite(v) && v >= 0) return v;
    return NaN;
  }

  return Number(row.projection);
}

function canonicalMarket(row) {
  const raw = String(row.market || row.stat || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  if (raw === 'pitching outs' || raw === 'pitcher outs' || raw === 'outs recorded') return 'pitching_outs';
  if (raw === 'walks allowed' || raw === 'pitcher walks' || raw === 'pitcher walks allowed') return 'walks_allowed';

  return marketKey(row);
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


function hasValidProjection(row) {
  const projection = Number(row.projection);
  return Number.isFinite(projection) && projection > 0;
}

function specialTierLessBlocked(row, side = row.recommendedSide || row.side) {
  const oddsTier = String(row.oddsTier || row.odds_tier || row.tier || '').toLowerCase();
  const resolvedSide = String(side || '').toUpperCase();
  return (oddsTier === 'demon' || oddsTier === 'goblin') && resolvedSide === 'LESS';
}

function disabledPricingRow(row, reason) {
  return {
    ...row,
    recommendedSide: null,
    recommendedProb: null,
    expectedValue: null,
    fairLine: null,
    rankEligible: false,
    pricingStatus: 'DISABLED',
    disabledReason: reason
  };
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

  let projection = projectionFromBallpark(row, market);
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



function displayName(v) {
  const raw = String(v || '').trim();
  if (raw.includes(',')) {
    const [last, first] = raw.split(',').map(x => x.trim());
    if (first && last) return `${first} ${last}`;
  }
  return raw;
}

function directHandednessPlayerKey(row) {
  return displayName(row.player)
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function directTeamKey(row) {
  return String(row.resolvedTeam || row.team || '').toUpperCase().trim();
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

function directOpponentPitcherHand(row) {
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

  const team = directTeamKey(row);
  const opp = CTX.probablePitcherHands.opponentPitcherByTeam?.[team];

  if (opp?.hand) {
    return {
      hand: opp.hand,
      source: 'probable_pitcher_context',
      pitcher: opp.pitcher ?? null,
      opponent: opp.opponent ?? null,
      gamePk: opp.gamePk ?? null
    };
  }

  return { hand: null, source: 'unknown' };
}

function buildDirectHandednessContext(row) {
  const key = directHandednessPlayerKey(row);
  const pitcherMarket = isPitcherMarket(row);

  if (pitcherMarket) {
    // Keep pitcher handedness splits metadata-only until batter handedness / lineup mix exists.
    const rec = CTX.handednessSplits.pitchers?.[key];
    if (!rec) {
      return {
        handednessMatched: false,
        handednessReady: false,
        handednessMatchType: 'NO_PITCHER_SPLIT',
        handednessContext: null
      };
    }

    return {
      handednessMatched: true,
      handednessReady: false,
      handednessMatchType: 'PITCHER_SPLIT_AVAILABLE_BATTER_HAND_UNKNOWN',
      handednessContext: {
        playerType: 'pitcher',
        selectedSplit: null,
        vsLHB: splitSummary(rec.vsLHB),
        vsRHB: splitSummary(rec.vsRHB),
        active: null
      }
    };
  }

  const rec = CTX.handednessSplits.batters?.[key];
  if (!rec) {
    return {
      handednessMatched: false,
      handednessReady: false,
      handednessMatchType: 'NO_BATTER_SPLIT',
      handednessContext: null
    };
  }

  const handInfo = directOpponentPitcherHand(row);
  const vsKey =
    handInfo.hand === 'L' ? 'vsLHP' :
    handInfo.hand === 'R' ? 'vsRHP' :
    null;

  return {
    handednessMatched: true,
    handednessReady: Boolean(vsKey),
    handednessMatchType: vsKey ? 'BATTER_VS_PITCHER_HAND' : 'BATTER_SPLIT_AVAILABLE_PITCHER_HAND_UNKNOWN',
    handednessContext: {
      playerType: 'batter',
      pitcherHand: handInfo.hand,
      pitcherHandSource: handInfo.source,
      opposingPitcher: handInfo.pitcher ?? null,
      opponent: handInfo.opponent ?? null,
      selectedSplit: vsKey,
      vsLHP: splitSummary(rec.vsLHP),
      vsRHP: splitSummary(rec.vsRHP),
      active: vsKey ? splitSummary(rec[vsKey]) : null
    }
  };
}

function handednessDeltaFromContext(row) {
  const direct = buildDirectHandednessContext(row);
  const h = row.handednessContext || direct.handednessContext;
  const ready = row.handednessReady === true || direct.handednessReady === true;
  const market = marketKey(row);
  const side = sideKey(row);

  if (!ready || !h?.active) {
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



function gameTeams(row) {
  const game = String(row.resolvedGame || row.game || "");
  const parts = game.split("@").map(x => x.trim().toUpperCase());
  return { away: parts[0] || null, home: parts[1] || null };
}

function currentGameUmpire(row) {
  const umps = CTX.umpireContext || {};
  const { away, home } = gameTeams(row);
  const team = String(row.resolvedTeam || row.team || "").toUpperCase();

  const candidates = [];

  if (Array.isArray(umps)) candidates.push(...umps);
  if (Array.isArray(umps.games)) candidates.push(...umps.games);
  if (Array.isArray(umps.rows)) candidates.push(...umps.rows);
  if (umps.byGame && typeof umps.byGame === "object") candidates.push(...Object.values(umps.byGame));
  if (umps.games && typeof umps.games === "object" && !Array.isArray(umps.games)) candidates.push(...Object.values(umps.games));

  const rec = candidates.find(u => {
    const h = String(u.home_team || u.homeTeam || u.home || "").toUpperCase();
    const a = String(u.away_team || u.awayTeam || u.away || "").toUpperCase();
    const g = String(u.game || u.gameKey || "").toUpperCase();
    return (
      (away && home && ((a === away && h === home) || g.includes(away) && g.includes(home))) ||
      (team && (a === team || h === team))
    );
  });

  return rec || null;
}

function catcherFramingForRow(row) {
  const c = CTX.catcherFraming || {};
  const team = String(row.resolvedTeam || row.team || "").toUpperCase();

  const candidates = [];

  if (Array.isArray(c)) candidates.push(...c);
  if (Array.isArray(c.rows)) candidates.push(...c.rows);
  if (Array.isArray(c.catchers)) candidates.push(...c.catchers);
  if (c.byTeam && team && c.byTeam[team]) candidates.push(c.byTeam[team]);
  if (c.teams && team && c.teams[team]) candidates.push(c.teams[team]);

  const rec = candidates.find(x => {
    const t = String(x.team || x.teamAbbr || x.resolvedTeam || "").toUpperCase();
    return team && t === team;
  });

  return rec || null;
}


function batterSavantProfile(row) {
  const form = row.savantRollingForm || {};
  const metrics = form.metrics || {};
  const direct = row.savant || row.savantProfile || {};

  const profile = {
    xwoba: Number(metrics.xwoba ?? form.xwoba ?? direct.xwoba ?? row.xwoba ?? 0),
    xslg: Number(metrics.xslg ?? form.xslg ?? direct.xslg ?? row.xslg ?? 0),
    xba: Number(metrics.xba ?? form.xba ?? direct.xba ?? row.xba ?? 0),
    hardHitRate: Number(metrics.hardHitRate ?? form.hardHitRate ?? form.hardHit ?? direct.hardHitRate ?? row.hardHitRate ?? 0),
    barrelRate: Number(metrics.barrelRate ?? form.barrelRate ?? form.barrel ?? direct.barrelRate ?? row.barrelRate ?? 0),
    sweetSpotRate: Number(metrics.sweetSpotRate ?? form.sweetSpotRate ?? direct.sweetSpotRate ?? row.sweetSpotRate ?? 0),
    avgExitVelocity: Number(metrics.avgExitVelocity ?? form.avgExitVelocity ?? direct.avgExitVelocity ?? row.avgExitVelocity ?? 0),
    avgLaunchAngle: Number(metrics.avgLaunchAngle ?? form.avgLaunchAngle ?? direct.avgLaunchAngle ?? row.avgLaunchAngle ?? 0),
    whiffRate: Number(metrics.whiffRate ?? form.whiffRate ?? direct.whiffRate ?? row.whiffRate ?? 0),
    kRate: Number(metrics.kRate ?? form.kRate ?? direct.kRate ?? row.kRate ?? 0),
    pa: Number(metrics.pa ?? form.pa ?? direct.pa ?? row.pa ?? 0)
  };

  return profile;
}

function applyContactQualityAdjustment(row, prob) {
  const m = marketKey(row);
  const s = sideKey(row);

  const hitterMarkets = new Set([
    'hits',
    'bases',
    'hrr',
    'runs',
    'rbis',
    'hr',
    'home_runs'
  ]);

  if (!hitterMarkets.has(m)) {
    return {
      prob,
      adjustment: {
        applied: false,
        delta: 0,
        reason: 'NON_HITTER_MARKET'
      }
    };
  }

  const q = batterSavantProfile(row);
  const flags = [];
  let contactScore = 0;
  let riskScore = 0;

  if (q.pa && q.pa < 25) {
    return {
      prob,
      adjustment: {
        applied: false,
        delta: 0,
        reason: 'SAMPLE_TOO_SMALL',
        profile: q
      }
    };
  }

  if (q.xwoba >= 0.380) {
    contactScore += 1;
    flags.push('PLUS_XWOBA');
  }
  if (q.xwoba >= 0.420) {
    contactScore += 1;
    flags.push('ELITE_XWOBA');
  }
  if (q.xslg >= 0.500) {
    contactScore += 1;
    flags.push('PLUS_XSLG');
  }
  if (q.hardHitRate >= 48) {
    contactScore += 1;
    flags.push('PLUS_HARD_HIT');
  }
  if (q.barrelRate >= 12) {
    contactScore += 1;
    flags.push('PLUS_BARREL');
  }
  if (q.sweetSpotRate >= 35) {
    contactScore += 0.5;
    flags.push('PLUS_SWEET_SPOT');
  }
  if (q.avgExitVelocity >= 91) {
    contactScore += 0.5;
    flags.push('PLUS_EXIT_VELO');
  }

  if (q.xwoba > 0 && q.xwoba <= 0.285) {
    riskScore += 1;
    flags.push('WEAK_XWOBA');
  }
  if (q.xslg > 0 && q.xslg <= 0.350) {
    riskScore += 1;
    flags.push('WEAK_XSLG');
  }
  if (q.hardHitRate > 0 && q.hardHitRate <= 33) {
    riskScore += 1;
    flags.push('LOW_HARD_HIT');
  }
  if (q.barrelRate >= 0 && q.barrelRate <= 4 && q.xslg > 0) {
    riskScore += 0.75;
    flags.push('LOW_BARREL');
  }
  if (q.whiffRate >= 32 || q.kRate >= 30) {
    riskScore += 0.75;
    flags.push('SWING_MISS_RISK');
  }

  let rawDelta = 0;

  if (contactScore >= 4) rawDelta += 0.008;
  else if (contactScore >= 2.5) rawDelta += 0.005;
  else if (contactScore >= 1.5) rawDelta += 0.003;

  if (riskScore >= 2.5) rawDelta -= 0.007;
  else if (riskScore >= 1.5) rawDelta -= 0.004;
  else if (riskScore >= 0.75) rawDelta -= 0.002;

  if (m === 'hr' || m === 'home_runs') {
    rawDelta *= 1.15;
  }

  if (m === 'hits') {
    rawDelta *= 0.75;
  }

  // Convert hitter contact lean into side probability movement.
  let delta = s === 'MORE' ? rawDelta : -rawDelta;
  delta = clamp(delta, -0.009, 0.009);

  return {
    prob: clamp(prob + delta, 0.01, 0.99),
    adjustment: {
      applied: Math.abs(delta) > 0,
      delta: Number(delta.toFixed(4)),
      contactScore: Number(contactScore.toFixed(3)),
      riskScore: Number(riskScore.toFixed(3)),
      flags,
      profile: q
    }
  };
}


function applyUmpireFramingAdjustment(row, prob) {
  const m = marketKey(row);
  const s = sideKey(row);

  let delta = 0;
  const flags = [];
  const details = {};

  const ump = currentGameUmpire(row);

  if (ump) {
    const accuracyAboveX = Number(ump.accuracy_above_x ?? ump.accuracyAboveExpected ?? ump.accuracyAboveX ?? 0);
    const consistency = Number(ump.consistency ?? 0);
    const pitcherImpact = Number(ump.pitcher_impact ?? ump.home_pitcher_impact ?? ump.away_pitcher_impact ?? 0);
    const totalRunImpact = Number(ump.total_run_impact ?? ump.totalRunImpact ?? 0);

    details.umpire = {
      name: ump.umpire || ump.name || null,
      accuracyAboveX,
      consistency,
      pitcherImpact,
      totalRunImpact
    };

    // Tiny capped effects only.
    if (m.includes("strikeout")) {
      if (consistency >= 95 || pitcherImpact > 0.5) {
        delta += s === "MORE" ? 0.005 : -0.005;
        flags.push("UMP_K_ZONE_TINY_BOOST");
      }
      if (accuracyAboveX <= -2.5) {
        delta += s === "MORE" ? -0.004 : 0.004;
        flags.push("UMP_VOLATILE_ZONE_TINY_DOWNGRADE");
      }
    }

    if (["hits", "bases", "hrr", "runs", "rbis", "hr", "home_runs"].includes(m)) {
      if (totalRunImpact >= 2.0) {
        delta += s === "MORE" ? 0.004 : -0.004;
        flags.push("UMP_RUN_ENV_TINY_BOOST");
      }
      if (totalRunImpact <= 0.5) {
        delta += s === "MORE" ? -0.003 : 0.003;
        flags.push("UMP_LOW_RUN_ENV_TINY_DOWNGRADE");
      }
    }
  }

  const framing = catcherFramingForRow(row);

  if (framing) {
    const framingRuns = Number(
      framing.framingRuns ??
      framing.catcherFramingRuns ??
      framing.strikeRuns ??
      framing.runs ??
      0
    );

    const strikeRate = Number(
      framing.strikeRate ??
      framing.calledStrikeRate ??
      framing.csaa ??
      framing.CSAA ??
      0
    );

    details.catcherFraming = {
      catcher: framing.catcher || framing.name || framing.player || null,
      team: framing.team || framing.teamAbbr || null,
      framingRuns,
      strikeRate
    };

    if (m.includes("strikeout")) {
      if (framingRuns >= 3 || strikeRate >= 1) {
        delta += s === "MORE" ? 0.006 : -0.006;
        flags.push("CATCHER_FRAMING_K_TINY_BOOST");
      }
      if (framingRuns <= -3 || strikeRate <= -1) {
        delta += s === "MORE" ? -0.006 : 0.006;
        flags.push("CATCHER_FRAMING_K_TINY_DOWNGRADE");
      }
    }

    if (m.includes("walk")) {
      if (framingRuns >= 3 || strikeRate >= 1) {
        delta += s === "LESS" ? 0.004 : -0.004;
        flags.push("CATCHER_FRAMING_WALK_SUPPRESSION_TINY");
      }
    }
  }

  // Hard cap: max 0.8 percentage points total.
  delta = clamp(delta, -0.008, 0.008);

  return {
    prob: clamp(prob + delta, 0.01, 0.99),
    adjustment: {
      applied: Math.abs(delta) > 0,
      delta: Number(delta.toFixed(4)),
      flags,
      details
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
  const market = canonicalMarket(row);
  const repairedProjection = projectionFromBallpark(row, market);

  if (
    row.recordType !== 'merged_prop' ||
    !Number.isFinite(Number(repairedProjection)) ||
    row.line === null ||
    !market
  ) {
    return {
      ...row,
      market,
      projection: null,
      rawProjection: null,
      contextAdjustedProjection: null,
      recommendedSide: null,
      recommendedProb: null,
      expectedValue: null,
      pricingStatus: 'UNPRICED',
      unpricedReason: 'NO_VALID_PROJECTION'
    };
  }

  row = {
    ...row,
    market,
    projection: repairedProjection
  };

  const contextResult = applyContextToProjection(row);
  const contextProjection = contextResult.projection;

  let overProb = probabilityOver(contextProjection, row.line, market);
  overProb = clamp(overProb + contextResult.context.probDelta, 0.01, 0.99);

  let underProb = 1 - overProb;

  let recommendedSide = overProb >= 0.5 ? 'MORE' : 'LESS';
  
  if (!hasValidProjection({ ...row, projection: contextProjection })) {
    return disabledPricingRow(row, 'missing_or_zero_projection');
  }

  if (specialTierLessBlocked(row, recommendedSide)) {
    recommendedSide = 'MORE';
  }

  let recommendedProb = recommendedSide === 'MORE' ? overProb : underProb;

  const savantFormResult = applySavantRollingForm(
    { ...row, recommendedSide },
    recommendedProb
  );

  recommendedProb = savantFormResult.prob;

  
  const contactQualityResult = applyContactQualityAdjustment(
    { ...row, recommendedSide, savantRollingForm: savantFormResult.savantRollingForm },
    recommendedProb
  );
  recommendedProb = contactQualityResult.prob;
const directHandedness = buildDirectHandednessContext({ ...row, recommendedSide });

  const handednessResult = applyHandednessAdjustment(
    { ...row, ...directHandedness, recommendedSide },
    recommendedProb
  );

  recommendedProb = handednessResult.prob;

  const calibrationResult = applyCalibration(
    { ...row, recommendedSide },
    recommendedProb
  );

  recommendedProb = calibrationResult.prob;

  
  const umpireFramingResult = applyUmpireFramingAdjustment(
    { ...row, recommendedSide },
    recommendedProb
  );
  recommendedProb = umpireFramingResult.prob;
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
    rawProjection: round(repairedProjection),
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
    contactQualityAdjusted: Boolean(contactQualityResult.adjustment?.applied),
    contactQualityAdjustment: contactQualityResult.adjustment,
    handednessMatched: directHandedness.handednessMatched,
    handednessReady: directHandedness.handednessReady,
    handednessMatchType: directHandedness.handednessMatchType,
    handednessContext: directHandedness.handednessContext,
    handednessAdjustment: handednessResult.handednessAdjustment,
    calibrationAdjustment: calibrationResult.calibration,
    umpireFramingAdjusted: Boolean(umpireFramingResult.adjustment?.applied),
    umpireFramingAdjustment: umpireFramingResult.adjustment,
    marketIntelligence: intel.marketIntelligence,
    adaptiveIntelligenceVersion: 'tier_a_v1'
  };
});

function normalizeSpecialTierSide(row) {
  const oddsTier = String(row.oddsTier || row.odds_tier || row.tier || '').toLowerCase();
  const market = String(row.market || row.stat || '').toLowerCase();
  const isSpecial = oddsTier === 'goblin' || oddsTier === 'demon';
  const isFantasy = market.includes('fantasy');

  if (!isSpecial && !isFantasy) return row;

  const rawSide = row.rawSide ?? row.side ?? row.recommendedSide ?? row.pick ?? row.direction ?? null;

  const next = {
    ...row,
    rawSide,
    specialTier: isSpecial || row.specialTier === true
  };

  if (isSpecial) {
    next.side = 'MORE';
    next.recommendedSide = 'MORE';
    next.playableSide = 'MORE';
  }

  if (isFantasy) {
    next.trackingOnly = true;
    next.rankEligible = false;
    next.playableEligible = false;
    next.playable = false;
    next.disabledReason = 'fantasy scale not verified';
  }

  return next;
}

const normalizedPriced = priced.map(normalizeSpecialTierSide);

const summary = {
  recordType: 'pricing_summary',
  createdAt: new Date().toISOString(),
  intelligenceVersion: 'tier_a_v1',
  totalRows: priced.length,
  pricedRows: priced.filter(r => r.pricingStatus === 'PRICED').length,
  contextAdjustedRows: priced.filter(r => r.contextAdjustment?.flags?.length).length,
  savantFormAdjustedRows: priced.filter(r => r.savantRollingForm?.applied).length,
  contactQualityAdjustedRows: priced.filter(r => r.contactQualityAdjustment?.applied).length,
  handednessAdjustedRows: priced.filter(r => r.handednessAdjustment?.applied).length,
  umpireFramingAdjustedRows: priced.filter(r => r.umpireFramingAdjustment?.applied).length,
  calibratedRows: priced.filter(r => r.calibrationAdjustment?.applied).length,
  marketIntelligenceRows: priced.filter(r => r.marketIntelligence?.applied).length,
  elite: priced.filter(r => r.confidenceBucket === 'elite').length,
  strong: priced.filter(r => r.confidenceBucket === 'strong').length,
  playable: priced.filter(r => r.confidenceBucket === 'playable').length,
  lean: priced.filter(r => r.confidenceBucket === 'lean').length,
  pass: priced.filter(r => r.confidenceBucket === 'pass').length
};

fs.writeFileSync(OUT_FILE, JSON.stringify([summary, ...normalizedPriced], null, 2));

console.log(summary);
console.log(`Saved ${OUT_FILE}`);
