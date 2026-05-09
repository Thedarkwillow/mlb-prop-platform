import fs from 'fs';

const rows = JSON.parse(fs.readFileSync('outputs/priced-board.json', 'utf8'));

const MODE = String(process.argv[2] || process.env.SLIP_MODE || 'mixed').toLowerCase();
// modes:
// standard = standard props only
// mixed    = standard + demon/goblin, capped
// special  = demon/goblin only

const SIZES = [2, 3, 4, 5, 6];
const SLIPS_PER_SIZE = 3;
const MAX_CANDIDATES = 2459;

const MAX_PLAYER_EXPOSURE = 3;
const MAX_PROP_EXPOSURE = 1;
const MAX_TEAM_EXPOSURE = 8;
const MAX_GAME_EXPOSURE = 20;

// Mixed mode caps.
const MAX_SPECIAL_EXPOSURE_GLOBAL = 24;
const MAX_GOBLIN_EXPOSURE_GLOBAL = 10;
const MAX_GOBLINS_PER_SLIP = 1;

const MAX_SPECIAL_PER_SLIP = {
  2: 1,
  3: 1,
  4: 2,
  5: 2,
  6: 2
};

const DIVERSITY_PENALTY = 0.03;

const LEARNING_PATH = 'data/learning/market-learning.json';

function readJsonSafe(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const MARKET_LEARNING = readJsonSafe(LEARNING_PATH, {
  byMarketDirectionBucket: {},
  byMarketDirection: {},
  byBucket: {}
});

function clampProb(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return null;
  return Math.max(0.01, Math.min(0.99, x));
}

function probBucket(prob) {
  const p = clampProb(prob);
  if (p == null) return null;
  const low = Math.floor(p * 20) / 20;
  const high = low + 0.05;
  return `${low.toFixed(2)}-${high.toFixed(2)}`;
}

function learningMarketKey(r) {
  return String(r.market || r.stat || 'unknown')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .trim();
}

function learningDirectionKey(r) {
  return String(r.side || r.recommendedSide || r.pick || r.direction || '')
    .toUpperCase()
    .includes('LESS')
    ? 'LESS'
    : 'MORE';
}

function getLearningAdjustment(r, prob) {
  const marketKey = learningMarketKey(r);
  const directionKey = learningDirectionKey(r);
  const bucket = probBucket(prob);

  const bucketKey = `${marketKey}_${directionKey}_${bucket}`;
  const mdKey = `${marketKey}_${directionKey}`;

  const exact = MARKET_LEARNING.byMarketDirectionBucket?.[bucketKey];
  const marketDirection = MARKET_LEARNING.byMarketDirection?.[mdKey];
  const bucketOnly = MARKET_LEARNING.byBucket?.[bucket];

  const chosen =
    exact && exact.sample >= 50 ? exact :
    marketDirection && marketDirection.sample >= 100 ? marketDirection :
    bucketOnly && bucketOnly.sample >= 150 ? bucketOnly :
    null;

  if (!chosen) {
    return {
      applied: false,
      key: null,
      sample: 0,
      multiplier: 1,
      suppressed: false,
      bias: 0
    };
  }

  return {
    applied: true,
    key: exact === chosen ? bucketKey : marketDirection === chosen ? mdKey : bucket,
    sample: chosen.sample || 0,
    multiplier: Number(chosen.adjustmentMultiplier || 1),
    suppressed: Boolean(chosen.suppressed),
    bias: Number(chosen.bias || 0),
    predicted: chosen.predicted ?? null,
    actual: chosen.actual ?? null
  };
}

function applyLearningToRow(r, prob) {
  const p0 = clampProb(prob);
  if (p0 == null) return { prob, learning: null };

  const adj = getLearningAdjustment(r, p0);
  const learnedProb = clampProb(p0 * adj.multiplier);

  return {
    prob: learnedProb ?? p0,
    learning: {
      ...adj,
      originalProb: Number(p0.toFixed(4)),
      learnedProb: Number((learnedProb ?? p0).toFixed(4))
    }
  };
}



function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function k(v) {
  return String(v || '').toLowerCase().trim();
}

function tier(r) {
  return String(r.oddsTier || r.odds_tier || r.tier || '').toLowerCase();
}

function isSpecialTier(r) {
  const t = tier(r);
  return t === 'goblin' || t === 'demon';
}

function side(r) {
  if (isSpecialTier(r)) return 'MORE';
  return r.recommendedSide || r.side || r.pick || r.direction || null;
}

function sideKey(r) {
  return String(side(r) || '').toUpperCase();
}

function projectionSanityOk(r) {
  const sk = sideKey(r);
  const projection = n(r.projection);
  const line = n(r.line);

  if (!Number.isFinite(projection) || !Number.isFinite(line)) return false;

  // Core anti-inversion guard:
  // MORE needs projection above line.
  // LESS needs projection below line.
  if (sk === 'MORE' && projection < line) return false;
  if (sk === 'LESS' && projection > line) return false;

  return true;
}

function kLessTightOk(r) {
  if (market(r) !== 'strikeouts' || sideKey(r) !== 'LESS') return true;

  const line = n(r.line);
  const projection = n(r.projection);
  if (!Number.isFinite(line) || !Number.isFinite(projection)) return false;

  const gap = line - projection;

  return tier(r) === 'standard'
    && line >= 5.5
    && gap >= 0.60;
}


function market(r) {
  return k(r.market || r.stat);
}

function pitcher(r) {
  return market(r).includes('strikeout') || market(r).includes('pitcher');
}

function propKey(r) {
  return [
    k(r.player),
    market(r),
    String(r.line),
    sideKey(r)
  ].join('|');
}
function gameKey(r) {
  const g = String(r.game || '').trim();

  if (g.includes('@')) {
    const parts = g.split('@').map(s => s.trim());
    if (parts.length === 2) return parts.sort().join('-').toLowerCase();
  }

  const t = String(r.team || '').trim();
  const o = String(r.opponent || '').trim();

  if (t && o) return [t, o].sort().join('-').toLowerCase();

  return g.toLowerCase();
}

function isValidGameAssignment(row) {
  if (!row.game || !row.team) return false;
  if (String(row.game).includes('null')) return false;

  const parts = String(row.game).split('@').map(s => s.trim());
  if (parts.length !== 2) return false;

  const [away, home] = parts;
  return row.team === away || row.team === home;
}

function modeAllowed(r) {
  const special = isSpecialTier(r);
  const t = tier(r);

  if (MODE === 'standard') return t === 'standard' || !t;
  if (MODE === 'special') return special;
  return true;
}


function legKey(r) {
  return [
    String(r.player || '').toLowerCase().trim(),
    String(r.team || '').toUpperCase().trim(),
    String(market(r) || '').toLowerCase().trim(),
    String(sideKey(r) || '').toUpperCase().trim(),
    String(r.line ?? '').trim()
  ].join('|');
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = legKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}


function normalizeForOptimizer(r) {
  const rawMarketText = String(r.market || r.stat || "").toLowerCase();

  if (rawMarketText.includes("fantasy")) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: "fantasy scale not verified"
    };
  }

  const line = clampProb(null) ?? Number(r.line);
  const proj = Number(r.projection);

  let resolvedSide = String(r.side || r.recommendedSide || "").toUpperCase();
  if (!resolvedSide && Number.isFinite(Number(r.line)) && Number.isFinite(proj)) {
    resolvedSide = proj >= Number(r.line) ? "MORE" : "LESS";
  }

  let prob =
    clampProb(r.recommendedProb) ??
    clampProb(r.probability) ??
    clampProb(r.prob);

  if (prob == null) {
    const stat = String(r.stat || r.market || "").toLowerCase();
    const bp = r.ballpark || {};
    if (stat.includes("hit") && bp.hitProbability != null) prob = clampProb(bp.hitProbability);
    else if (stat.includes("home run") && bp.homeRunProbability != null) prob = clampProb(bp.homeRunProbability);
    else if (stat.includes("stolen") && bp.stolenBaseProbability != null) prob = clampProb(bp.stolenBaseProbability);
  }

  if (prob == null && Number.isFinite(Number(r.line)) && Number.isFinite(proj)) {
    const gap = Math.abs(proj - Number(r.line));
    prob = Math.max(0.51, Math.min(0.72, 0.52 + gap * 0.08));
  }

  const preLearningProb = prob;
  const learned = applyLearningToRow(
    {
      ...r,
      side: resolvedSide,
      recommendedSide: resolvedSide,
      market: r.market || r.stat
    },
    prob
  );

  prob = learned.prob;

  let ev = Number(r.expectedValue);
  if (!Number.isFinite(ev) && prob != null) ev = Number(((prob - 0.5) * 2).toFixed(3));

  let confidenceBucket = r.confidenceBucket;
  if (prob != null) {
    confidenceBucket =
      prob >= 0.66 ? "elite" :
      prob >= 0.60 ? "strong" :
      prob >= 0.55 ? "playable" :
      "lean";
  }

  return {
    ...r,
    side: resolvedSide,
    recommendedSide: resolvedSide,
    rawRecommendedProb: preLearningProb,
    recommendedProb: prob,
    learningAdjusted: Boolean(learned.learning?.applied),
    learningSuppressed: Boolean(learned.learning?.suppressed),
    learningAdjustment: learned.learning,
    expectedValue: ev,
    confidenceBucket,
    market: r.market || r.stat
  };
}
function playable(r) {
  if (r.rankEligible === false) return false;
  const isStandardK = market(r) === 'strikeouts' && tier(r) === 'standard';
  if (
    r.isFantasy === true ||
    String(r.market || r.stat || '').toLowerCase().includes('fantasy')
  ) return false;

  return r.recordType === 'merged_prop'
    && modeAllowed(r)
    && r.player
    && r.stat
    && side(r)
    // allow bases again now that DK pricing can filter bad legs
    // allow HRR/runs/RBIs again now that DK pricing can filter bad legs
    && !(market(r) === 'hits' && sideKey(r) === 'MORE' && tier(r) === 'goblin')
    // K MORE allowed now that strikeouts use Poisson probability.
    && !r.learningSuppressed
    && !['pass'].includes(String(r.confidenceBucket || '').toLowerCase())
    && isValidGameAssignment(r)
    && (isStandardK || projectionSanityOk(r))
    && kLessTightOk(r)
    && (
      tier(r) === 'standard'
        ? n(r.recommendedProb) >= 0.52
        : n(r.recommendedProb) >= 0.60
    )
    && n(r.recommendedProb) <= 0.85
    && (
      tier(r) === 'demon'
        ? n(r.expectedValue) >= 1.10
        : tier(r) === 'goblin'
          ? n(r.recommendedProb) >= 0.60
          : n(r.expectedValue) >= 0.00
    );
}

function baseScore(r) {
  let score = n(r.expectedValue) * 2
    + n(r.recommendedProb)
    + n(r.vegasPickProb)
    + (r.confidenceBucket === 'elite' ? 0.05 : 0)
    + (r.savantMatched ? 0.015 : 0)
    + n(r.savantBoost);

  // In mixed mode, prevent special props from crowding out standard props.
  if (MODE === 'mixed' && isSpecialTier(r)) score -= 0.08;

  return score;
}

function exposureCount(map, key) {
  return map.get(key) || 0;
}
function canUse(legs, r, exposure, size) {
  const p = k(r.player);
  const t = k(r.team);
  const g = gameKey(r);
  const m = market(r);
  const pk = propKey(r);
  const sk = sideKey(r);
  const special = isSpecialTier(r);

  if (!isValidGameAssignment(r)) return false;

  if (exposureCount(exposure.players, p) >= MAX_PLAYER_EXPOSURE) return false;
  if (exposureCount(exposure.props, pk) >= MAX_PROP_EXPOSURE) return false;
  if (exposureCount(exposure.teams, t) >= MAX_TEAM_EXPOSURE) return false;
  if (exposureCount(exposure.games, g) >= MAX_GAME_EXPOSURE) return false;

  if (MODE === 'mixed' && special) {
    if (exposureCount(exposure.special, 'special') >= MAX_SPECIAL_EXPOSURE_GLOBAL) return false;

    const specialInSlip = legs.filter(x => isSpecialTier(x)).length;
    if (specialInSlip >= (MAX_SPECIAL_PER_SLIP[size] || 2)) return false;

    if (tier(r) === 'goblin') {
      if (exposureCount(exposure.goblins, 'goblin') >= MAX_GOBLIN_EXPOSURE_GLOBAL) return false;

      const goblinsInSlip = legs.filter(x => tier(x) === 'goblin').length;
      if (goblinsInSlip >= MAX_GOBLINS_PER_SLIP) return false;
    }
  }

  if (legs.some(x => k(x.player) === p)) return false;
  if (legs.some(x => propKey(x) === pk)) return false;

  const sameTeam = legs.filter(x => k(x.team) === t).length;
  if (sameTeam >= 2) return false;

  // Same game is allowed on PrizePicks. Only block duplicate player, handled above.

  if (pitcher(r) && legs.some(pitcher)) return false;

  const sameMarket = legs.filter(x => market(x) === m).length;
  if (sameMarket >= 3) return false;

  const maxSameSide = size <= 3 ? size : Math.ceil(size * 0.85);
  const sameSide = legs.filter(x => sideKey(x) === sk).length;
  if (sameSide >= maxSameSide) return false;

  return true;
}

function adjustedScore(r, exposure, legs = []) {
  const p = k(r.player);
  const playerCount = exposureCount(exposure.players, p);
  const playerPenalty = playerCount * DIVERSITY_PENALTY;

  const sameMarketCount = legs.filter(x => market(x) === market(r)).length;
  const marketPenalty = sameMarketCount * 0.01;

  const sidePenalty = sideKey(r) === 'MORE' ? 0.08 : 0;
  const sideBoost = sideKey(r) === 'LESS' ? 0.10 : 0;
  return baseScore(r) - playerPenalty - marketPenalty - sidePenalty + sideBoost;
}
function addExposure(r, exposure) {
  const p = k(r.player);
  const t = k(r.team);
  const g = gameKey(r);
  const pk = propKey(r);

  exposure.players.set(p, exposureCount(exposure.players, p) + 1);
  exposure.props.set(pk, exposureCount(exposure.props, pk) + 1);
  exposure.teams.set(t, exposureCount(exposure.teams, t) + 1);
  exposure.games.set(g, exposureCount(exposure.games, g) + 1);

  if (isSpecialTier(r)) {
    exposure.special.set('special', exposureCount(exposure.special, 'special') + 1);
  }

  if (tier(r) === 'goblin') {
    exposure.goblins.set('goblin', exposureCount(exposure.goblins, 'goblin') + 1);
  }
}

function clean(r) {
  return {
    player: r.player,
    team: r.team,
    game: r.game,
    gamePk: r.gamePk ?? null,
    stat: r.stat,
    line: r.line,
    projection: r.projection,
    side: side(r),
    recommendedSide: side(r),
    recommendedProb: r.recommendedProb,
    expectedValue: r.expectedValue,
    confidenceBucket: r.confidenceBucket,
    oddsTier: r.oddsTier || r.odds_tier || r.tier || null,
    market: r.market,
    vegasDriven: !!r.vegasDriven,
    vegasLine: r.vegasLine ?? null,
    vegasPickProb: r.vegasPickProb ?? null,
    probabilitySource: r.probabilitySource ?? null,
    savantMatched: !!r.savantMatched,
    savantBoost: r.savantBoost ?? 0,
    savant: r.savant ?? null,
    slipMode: MODE
  };
}

function avg(legs, field) {
  return legs.reduce((s, x) => s + n(x[field]), 0) / Math.max(legs.length, 1);
}

function buildSlip(candidates, size, offset, exposure) {
  const legs = [];

  while (legs.length < size) {
    const ranked = candidates
      .filter(r => canUse(legs, r, exposure, size))
      .map(r => ({
        row: r,
        score: adjustedScore(r, exposure, legs)
      }))
      .sort((a, b) => b.score - a.score);

    if (!ranked.length) break;

    const pickIndex = Math.min(offset, ranked.length - 1);
    const chosen = ranked[pickIndex].row;

    legs.push(chosen);
    addExposure(chosen, exposure);
  }

  return {
    recordType: 'slip',
    name: `optimizer_v4_5_${MODE}_${size}_man_${offset + 1}`,
    mode: MODE,
    size,
    complete: legs.length === size,
    avgProb: Number(avg(legs, 'recommendedProb').toFixed(3)),
    avgEV: Number(avg(legs, 'expectedValue').toFixed(3)),
    legs: legs.map(clean)
  };
}
const beforePlayable = rows.filter(r => r.recordType === 'merged_prop').length;
const invalidGameRows = rows.filter(r => r.recordType === 'merged_prop' && !isValidGameAssignment(r)).length;

const normalizedRows = rows.map(normalizeForOptimizer);
const candidates = dedupeRows(normalizedRows.filter(playable))
  .sort((a, b) => baseScore(b) - baseScore(a))
  .slice(0, MAX_CANDIDATES);

console.log('Optimizer V4.5 candidates:', candidates.length);
console.log('Mode:', MODE);
console.log('Merged props:', beforePlayable);
console.log('Removed invalid team/game rows:', invalidGameRows);
console.log('Max player exposure:', MAX_PLAYER_EXPOSURE);
console.log('Max prop exposure:', MAX_PROP_EXPOSURE);
console.log('Max team exposure:', MAX_TEAM_EXPOSURE);
console.log('Max game exposure:', MAX_GAME_EXPOSURE);
console.log('Goblin/Demon side rule: MORE only');

const exposure = {
  players: new Map(),
  props: new Map(),
  teams: new Map(),
  games: new Map(),
  special: new Map(),
  goblins: new Map()
};

const slips = [];

for (const size of SIZES) {
  for (let i = 0; i < SLIPS_PER_SIZE; i++) {
    slips.push(buildSlip(candidates, size, i, exposure));
  }
}

fs.writeFileSync('outputs/slips.json', JSON.stringify(slips, null, 2));

const legs = slips.flatMap(s => s.legs || []);
const badSlipLegs = legs.filter(x => !isValidGameAssignment(x));
const uniqueProps = new Set(legs.map(propKey)).size;
const badSpecialSides = legs.filter(x =>
  ['goblin', 'demon'].includes(tier(x)) &&
  sideKey(x) !== 'MORE'
);

console.log('Saved outputs/slips.json');
console.log('Slip legs:', legs.length);
console.log('Bad slip legs:', badSlipLegs.length);
console.log('Unique players:', new Set(legs.map(x => x.player)).size);
console.log('Unique props:', uniqueProps);
console.log('Complete slips:', slips.filter(x => x.complete).length);
console.log('Bad goblin/demon sides:', badSpecialSides.length);
console.log('Side counts:', legs.reduce((a, x) => {
  a[x.side] = (a[x.side] || 0) + 1;
  return a;
}, {}));
console.log('Tier counts:', legs.reduce((a, x) => {
  a[x.oddsTier] = (a[x.oddsTier] || 0) + 1;
  return a;
}, {}));
