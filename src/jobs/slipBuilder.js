import fs from 'fs';
import { applyPhase55RiskAdjustments } from '../lib/phase55Adjustments.js';
import { applyPhase5ContextAdjustments } from '../lib/phase5ContextEngine.js';

const rows = JSON.parse(fs.readFileSync('outputs/priced-board.json', 'utf8'));

function readJsonSafeGoblinTrust(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const GOBLIN_MARKET_TRUST = readJsonSafeGoblinTrust('data/learning/goblin-market-trust.json', { markets: [] });
const GOBLIN_MARKET_TRUST_MAP = new Map(
  (GOBLIN_MARKET_TRUST.markets || []).map(r => [
    `${String(r.market || '').toLowerCase()}|${String(r.side || 'MORE').toUpperCase()}`,
    r
  ])
);

const DEMON_MARKET_TRUST = readJsonSafeGoblinTrust('data/learning/demon-market-trust.json', { markets: [] });
const DEMON_MARKET_TRUST_MAP = new Map(
  (DEMON_MARKET_TRUST.markets || []).map(r => [
    `${String(r.market || '').toLowerCase()}|${String(r.side || 'MORE').toUpperCase()}`,
    r
  ])
);

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
const MARKET_TRUST_PATH = 'data/learning/market-trust.json';
const ADAPTIVE_CALIBRATION_PATH = 'data/learning/adaptive-calibration.json';

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
const MARKET_TRUST = readJsonSafe(MARKET_TRUST_PATH, {
  byMarketDirection: {}
});
const ADAPTIVE_CALIBRATION = readJsonSafe(ADAPTIVE_CALIBRATION_PATH, {
  byBucket: {},
  byMarket: {},
  byMarketDirection: {},
  byMarketDirectionBucket: {}
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

function marketTrustKey(r) {
  return `${learningMarketKey(r)}_${learningDirectionKey(r)}`;
}
function getMarketTrust(r) {
  return MARKET_TRUST.byMarketDirection?.[marketTrustKey(r)] || {
    trust: 'unknown',
    suppressed: false,
    adjustmentMultiplier: 1,
    sample: 0
  };
}
function marketTrustAllowed(r) {
  const t = getMarketTrust(r);
  return !t.suppressed;
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
function normPitcherRestName(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function yesterdayDateIso() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function flattenPitcherRestRows(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flattenPitcherRestRows(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.pitcher) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flattenPitcherRestRows(val, out);
  }
  return out;
}
function pitcherRestReadJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function buildYesterdayPitcherAppearanceSet() {
  const y = yesterdayDateIso();
  const files = [
    `outputs/live/mlb-live-inning-graded-${y}.json`,
    `outputs/history/${y}-full-board-graded.json`,
    "outputs/graded-results.json"
  ];
  const names = new Set();
  const pitcherMarkets = new Set([
    "strikeouts",
    "pitching_outs",
    "pitcher_outs",
    "outs",
    "earned_runs_allowed",
    "runs_allowed",
    "hits_allowed",
    "walks_allowed",
    "pitches_thrown",
    "pitcher_fantasy_score"
  ]);

  for (const file of files) {
    const raw = pitcherRestReadJson(file, null);
    if (!raw) continue;
    for (const r of flattenPitcherRestRows(raw)) {
      const m = String(r.market || r.stat || r.type || "").toLowerCase().trim();
      const actual = Number(r.actual ?? r.actualValue ?? r.resultValue);
      const result = String(r.result || r.status || "").toUpperCase();
      if (!pitcherMarkets.has(m) && !m.includes("pitcher") && !m.includes("strikeout")) continue;
      if (!Number.isFinite(actual) && !["HIT", "MISS", "PUSH"].includes(result)) continue;
      const player = normPitcherRestName(r.player || r.playerName || r.name || r.pitcher);
      if (player) names.add(player);
    }
  }
  return names;
}
function buildTodayProbablePitcherSet() {
  const raw = pitcherRestReadJson("data/context/probable-pitcher-hands.json", {});
  const names = new Set();
  const add = v => {
    const n = normPitcherRestName(v);
    if (n) names.add(n);
  };

  for (const g of Object.values(raw.games || {})) {
    add(g.awayProbablePitcher);
    add(g.homeProbablePitcher);
    add(g.awayPitcher);
    add(g.homePitcher);
  }

  for (const obj of [raw.pitcherByTeam || {}, raw.opponentPitcherByTeam || {}]) {
    for (const p of Object.values(obj)) {
      if (p && typeof p === "object") add(p.pitcher || p.name || p.player || p.fullName);
      else add(p);
    }
  }

  return names;
}
const YESTERDAY_PITCHER_APPEARANCES = buildYesterdayPitcherAppearanceSet();
const TODAY_PROBABLE_PITCHERS = buildTodayProbablePitcherSet();

function pitcherRestBlocked(r) {
  const m = market(r);
  const pitcherLike =
    pitcher(r) ||
    [
      "strikeouts",
      "pitching_outs",
      "pitcher_outs",
      "outs",
      "earned_runs_allowed",
      "runs_allowed",
      "hits_allowed",
      "walks_allowed",
      "pitches_thrown",
      "pitcher_fantasy_score",
      "runs",
      "walks",
      "hits"
    ].includes(m);

  if (!pitcherLike) return false;

  const player = normPitcherRestName(r.player || r.playerName || r.name);
  if (!player) return false;
  if (!YESTERDAY_PITCHER_APPEARANCES.has(player)) return false;
  if (TODAY_PROBABLE_PITCHERS.has(player)) return false;
  return true;
}

function propKey(r) {
  return [
    k(r.player),
    market(r),
    String(r.line),
    sideKey(r)
  ].join('|');
}
function canonicalTeam(r) {
  return String(r.resolvedTeam || r.team || '').trim();
}

function canonicalGame(r) {
  return String(r.resolvedGame || r.game || '').trim();
}

function gameKey(r) {
  const g = canonicalGame(r);

  if (g.includes('@')) {
    const parts = g.split('@').map(s => s.trim());
    if (parts.length === 2) return parts.sort().join('-').toLowerCase();
  }

  const t = canonicalTeam(r);
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
    canonicalTeam(r).toUpperCase().trim(),
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


function invalidProjectionRow(r) {
  const projection = Number(r.projection);
  return !Number.isFinite(projection) || projection <= 0;
}

function specialTierLessBlockedForSlip(r) {
  const oddsTier = String(r.oddsTier || r.odds_tier || r.tier || '').toLowerCase();
  const resolvedSide = String(r.side || r.recommendedSide || '').toUpperCase();
  return (oddsTier === 'demon' || oddsTier === 'goblin') && resolvedSide === 'LESS';
}

function goblinStrikeoutsMoreBlockedForSlip(r) {
  const oddsTier = String(r.oddsTier || r.odds_tier || r.tier || '').toLowerCase();
  const resolvedSide = String(r.side || r.recommendedSide || '').toUpperCase();
  const m = String(r.market || r.stat || "").toLowerCase();

  return oddsTier === "goblin" && m === "strikeouts" && resolvedSide === "MORE";
}

function goblinMarketTrustRule(r) {
  if (tier(r) !== 'goblin') return null;

  const key = `${market(r)}|${sideKey(r) || 'MORE'}`;
  return GOBLIN_MARKET_TRUST_MAP.get(key) || null;
}

function goblinMarketTrustBlockedForSlip(r) {
  const rule = goblinMarketTrustRule(r);
  if (!rule) return false;

  if (String(rule.action || '').toUpperCase() === 'SUPPRESS') return true;

  if (String(rule.action || '').toUpperCase() === 'WATCH') {
    return !(
      n(r.recommendedProb) >= 0.64 &&
      n(r.expectedValue) >= 0.08 &&
      String(r.confidenceBucket || '').toLowerCase() === 'elite'
    );
  }

  return false;
}

function goblinMarketTrustDisabledReason(r) {
  const rule = goblinMarketTrustRule(r);
  if (!rule) return null;

  const action = String(rule.action || '').toUpperCase();
  if (action === 'SUPPRESS') return `goblin_market_trust_suppressed:${rule.market}:${rule.reason || 'no_reason'}`;
  if (action === 'WATCH') return `goblin_market_trust_watch:${rule.market}:${rule.reason || 'no_reason'}`;
  return null;
}

function demonMarketTrustRule(r) {
  if (tier(r) !== 'demon') return null;

  const key = `${market(r)}|${sideKey(r) || 'MORE'}`;
  return DEMON_MARKET_TRUST_MAP.get(key) || null;
}

function demonMarketTrustBlockedForSlip(r) {
  const rule = demonMarketTrustRule(r);
  if (!rule) return false;

  if (String(rule.action || '').toUpperCase() === 'SUPPRESS') return true;

  // Demons are hard lines. WATCH requires extreme model confirmation.
  if (String(rule.action || '').toUpperCase() === 'WATCH') {
    return !(
      n(r.recommendedProb) >= 0.70 &&
      n(r.expectedValue) >= 0.20 &&
      String(r.confidenceBucket || '').toLowerCase() === 'elite' &&
      n(r.sportsbookBookCount || r.books) >= 3
    );
  }

  return false;
}

function demonMarketTrustDisabledReason(r) {
  const rule = demonMarketTrustRule(r);
  if (!rule) return null;

  const action = String(rule.action || '').toUpperCase();
  if (action === 'SUPPRESS') return `demon_market_trust_suppressed:${rule.market}:${rule.reason || 'no_reason'}`;
  if (action === 'WATCH') return `demon_market_trust_watch:${rule.market}:${rule.reason || 'no_reason'}`;
  return null;
}

function normalizeForOptimizer(r) {
  if (invalidProjectionRow(r)) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: "missing_or_zero_projection"
    };
  }
  if (specialTierLessBlockedForSlip(r)) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: "special_tier_less_not_allowed"
    };
  }

  if (goblinStrikeoutsMoreBlockedForSlip(r)) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: "goblin_strikeouts_more_suppressed"
    };
  }

  if (goblinMarketTrustBlockedForSlip(r)) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: goblinMarketTrustDisabledReason(r) || "goblin_market_trust_blocked"
    };
  }

  if (demonMarketTrustBlockedForSlip(r)) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: demonMarketTrustDisabledReason(r) || "demon_market_trust_blocked"
    };
  }
  const rawMarketText = String(r.market || r.stat || "").toLowerCase();

  if (rawMarketText.includes("fantasy")) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: "fantasy scale not verified"
    };
  }
  if (pitcherRestBlocked(r)) {
    return {
      ...r,
      rankEligible: false,
      disabledReason: "pitcher_pitched_yesterday_not_probable_today"
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
function hrrMoreAllowed(r) {
  if (market(r) !== 'hrr' || sideKey(r) !== 'MORE') return true;
  // HRR MORE is underperforming historically, so only allow extreme overrides.
  return (
    tier(r) === 'standard' &&
    n(r.recommendedProb) >= 0.72 &&
    n(r.expectedValue) >= 0.35 &&
    String(r.confidenceBucket || '').toLowerCase() === 'elite'
  );
}

function playable(r) {
  if (invalidProjectionRow(r)) return false;
  if (specialTierLessBlockedForSlip(r)) return false;
  if (goblinStrikeoutsMoreBlockedForSlip(r)) return false;
  if (goblinMarketTrustBlockedForSlip(r)) return false;
  if (demonMarketTrustBlockedForSlip(r)) return false;
  if (phase6DirectionalBlocked(r)) return false;
  if (pitcherRestBlocked(r)) return false;
  if (r.rankEligible === false) return false;

  // CONTROLLED HRR POLICY:
  // HRR is tracked and may enter lean/watchlist reporting,
  // but it is not allowed into official slips yet.
  if (market(r) === 'hrr') return false;

  // HARD BLOCK: runs MORE is currently 0-for-11 in graded history.
  // Re-enable only after the market trust engine upgrades it.
  if (market(r) === 'runs' && sideKey(r) === 'MORE') return false;
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
    && marketTrustAllowed(r)
    && hrrMoreAllowed(r)
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

  score *= phase6DirectionalMultiplier(r);
  return score;
}


function readJsonSafePhase5(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const PHASE5_LEARNING = readJsonSafePhase5("data/learning/phase5-market-trust.json", { rows: {} });
const PHASE5_AUTO = readJsonSafePhase5("data/learning/auto-market-adjustments.json", { rows: {} });
const PHASE5_EDGE = readJsonSafePhase5("data/learning/roi-edge-confidence.json", { rows: {} });

function phase5Key(r) {
  return `${market(r)}_${sideKey(r)}`;
}

function phase5MarketRule(r) {
  return PHASE5_LEARNING.rows?.[phase5Key(r)] || PHASE5_AUTO.rows?.[phase5Key(r)] || null;
}

function phase5HardAllowed(r) {
  const rule = phase5MarketRule(r);
  if (!rule) return true;
  if (rule.action === "SUPPRESS" && Number(rule.sample || 0) >= 30) return false;
  return true;
}

function phase5Weight(r) {
  const rule = phase5MarketRule(r);
  if (!rule) return 1;
  if (rule.action === "BOOST") return 1.08;
  if (rule.action === "DOWNWEIGHT") return 0.75;
  if (rule.action === "SUPPRESS") return 0.55;
  return 1;
}


const PHASE6_CAL = readJsonSafePhase5("data/learning/phase6-calibration-shrinkage.json", {
  calibration: {},
  shrinkage: {},
  confidence: {}
});

function phase6ProbBucketValue(p) {
  const v = Number(p);
  if (!Number.isFinite(v)) return "unknown";
  const low = Math.floor(v * 20) / 20;
  return `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
}

function phase6EdgeBucketValue(e) {
  const v = Math.abs(Number(e));
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.03) return "0.00-0.03";
  if (v < 0.06) return "0.03-0.06";
  if (v < 0.10) return "0.06-0.10";
  if (v < 0.20) return "0.10-0.20";
  if (v < 0.35) return "0.20-0.35";
  return "0.35+";
}

function phase6BaseKey(r) {
  return `${market(r)}_${sideKey(r)}`;
}

function phase6CalibratedProb(r) {
  const raw = Number(r.calibratedProb ?? r.recommendedProb ?? r.prob);
  if (!Number.isFinite(raw)) return raw;
  const key = `${phase6BaseKey(r)}_${phase6ProbBucketValue(raw)}`;
  const rule = PHASE6_CAL.calibration?.[key] || PHASE6_CAL.confidence?.[phase6BaseKey(r)];
  const mult = Number(rule?.probMultiplier ?? 1);
  return Math.max(0.01, Math.min(0.99, raw * mult));
}

function phase6EdgeMultiplier(r) {
  const edge = Number(r.adjEdge ?? r.edge ?? 0);
  const key = `${phase6BaseKey(r)}_${phase6EdgeBucketValue(edge)}`;
  const rule = PHASE6_CAL.shrinkage?.[key] || PHASE6_CAL.confidence?.[phase6BaseKey(r)];
  return Number(rule?.edgeMultiplier ?? 1);
}

function phase6AdjustedScore(r, score) {
  const prob = phase6CalibratedProb(r);
  const edgeMult = phase6EdgeMultiplier(r);
  const probBoost = Number.isFinite(prob) ? (prob - 0.5) * 0.15 : 0;
  return (score * edgeMult) + probBoost;
}


const PHASE6_REGIME = readJsonSafePhase5("data/learning/phase6-regime-detection.json", {
  combined: {}
});

function phase6RegimeRule(r) {
  return PHASE6_REGIME.combined?.[`${market(r)}_${sideKey(r)}`] || null;
}

function phase6RegimeAllowed(r) {
  const rule = phase6RegimeRule(r);
  if (!rule) return true;
  if (rule.action === "SUPPRESS_RECENT") return false;
  return true;
}


function phase6DirectionalMultiplier(r) {
  const m = market(r);
  const side = String(r.side || r.recommendedSide || r.pickSide || "").toUpperCase();

  // Global MORE leak control.
  if (side === "MORE") return 0.75;

  // LESS is currently the stronger direction, but do not overboost.
  if (side === "LESS") return 1.05;

  return 1;
}

function phase6DirectionalBlocked(r) {
  const m = market(r);
  const side = String(r.side || r.recommendedSide || r.pickSide || "").toUpperCase();

  // Hits MORE is allowed only with stronger confirmation.
  if (
    side === "MORE" &&
    m === "hits"
  ) {
    const prob = Number(r.calibratedDistributionProb ?? r.recommendedProb ?? r.prob ?? 0);
    const books = Number(r.sportsbookBookCount ?? r.books ?? 0);
    if (!(prob >= 0.60 && books >= 5)) return true;
  }

  // Hard block the worst observed MORE pitcher outcome markets.
  if (
    side === "MORE" &&
    [
      "hits_allowed",
      "earned_runs_allowed",
      "walks_allowed",
      "pitcher_fantasy_score"
    ].includes(m)
  ) {
    return true;
  }

  // Existing known bad MORE markets from Phase 6.
  // Exception: standard pitcher K MORE can enter watchlist/slips if probability is strong.
  if (
    side === "MORE" &&
    [
      "rbis",
      "runs",
      "hitter_fantasy_score"
    ].includes(m)
  ) {
    return true;
  }

  if (side === "MORE" && m === "strikeouts") {
    const prob = Number(r.recommendedProb ?? r.prob ?? 0);
    const t = String(r.oddsTier || r.odds_tier || r.tier || "").toLowerCase();
    if (!(t === "standard" && prob >= 0.52)) return true;
  }

  return false;
}

function phase6RegimeScoreMultiplier(r) {
  const rule = phase6RegimeRule(r);
  return Number(rule?.scoreMultiplier ?? 1);
}


const PHASE6_EXPOSURE = readJsonSafePhase5("data/learning/phase6-exposure-governor.json", {
  governor: {
    maxSlipSize: 6,
    scoreMultiplier: 1,
    maxSameMarket: 3,
    maxSameSidePct: 0.85
  }
});

function phase6Governor() {
  return PHASE6_EXPOSURE.governor || {
    maxSlipSize: 6,
    scoreMultiplier: 1,
    maxSameMarket: 3,
    maxSameSidePct: 0.85
  };
}

function phase6SlipSizeAllowed(size) {
  return size <= Number(phase6Governor().maxSlipSize || 6);
}

function phase6GlobalScoreMultiplier() {
  return Number(phase6Governor().scoreMultiplier || 1);
}

function phase6MaxSameMarket() {
  return Number(phase6Governor().maxSameMarket || 3);
}

function phase6MaxSameSidePct() {
  return Number(phase6Governor().maxSameSidePct || 0.85);
}

function exposureCount(map, key) {
  return map.get(key) || 0;
}
function canUse(legs, r, exposure, size) {
  const p = k(r.player);
  const t = k(canonicalTeam(r));
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
  if (sameMarket >= phase6MaxSameMarket()) return false;

  const sameSide = legs.filter(x => sideKey(x) === sk).length;

  // Prevent all-MORE slips. Specials are already MORE-only, so this keeps
  // standard legs from crowding every slip into one direction.
  if (size >= 3 && sk === 'MORE') {
    const maxMorePerSlip = size - 1;
    if (sameSide >= maxMorePerSlip) return false;
  }

  const maxSameSide = size <= 2 ? size : size - 1;
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
  return phase6AdjustedScore(r, (baseScore(r) - playerPenalty - marketPenalty - sidePenalty + sideBoost) * phase5Weight(r) * phase6RegimeScoreMultiplier(r) * phase6GlobalScoreMultiplier());
}
function addExposure(r, exposure) {
  const p = k(r.player);
  const t = k(canonicalTeam(r));
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
    team: canonicalTeam(r),
    game: canonicalGame(r),
    rawTeam: r.team ?? null,
    rawGame: r.game ?? null,
    gamePk: r.gamePk ?? null,
    teamResolved: r.teamResolved,
    teamValid: r.teamValid,
    teamResolverStatus: r.teamResolverStatus ?? null,
    resolvedTeam: r.resolvedTeam ?? null,
    resolvedGame: r.resolvedGame ?? null,
    resolvedGamePk: r.resolvedGamePk ?? null,
    disabledReason: r.disabledReason ?? null,
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
    adaptiveAdjusted: !!r.adaptiveAdjusted,
    adaptiveCalibration: r.adaptiveCalibration ?? null,
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

function applyPhase55ToOptimizerRow(r) {
  const adjusted = applyPhase55RiskAdjustments({
    ...r,
    probability: r.recommendedProb,
    prob: r.recommendedProb,
    confidence: r.confidenceBucket,
    side: r.recommendedSide || r.side,
    market: r.market || r.stat
  });

  const adjustedProb = Number(adjusted.probability ?? adjusted.prob ?? r.recommendedProb);
  const expectedValue = Number(((adjustedProb - 0.5) * 2).toFixed(3));

  return {
    ...r,
    recommendedProb: adjustedProb,
    prob: adjustedProb,
    probability: adjustedProb,
    expectedValue,
    confidenceBucket: adjusted.confidence || r.confidenceBucket,
    phase55: adjusted.phase55 ?? null
  };
}


function diagnostics(rows) {
  const counts = {
    total: 0,
    afterRecordType: 0,
    afterGameValid: 0,
    afterProjection: 0,
    afterSideRule: 0,
    afterDirectional: 0,
    afterMarketTrust: 0,
    afterProb: 0,
    afterEV: 0,
    finalPlayable: 0
  };

  for (const r of rows) {
    if (r.recordType !== 'merged_prop') continue;
    counts.total++;

    if (!isValidGameAssignment(r)) continue;
    counts.afterGameValid++;

    if (invalidProjectionRow(r)) continue;
    counts.afterProjection++;

    if (specialTierLessBlockedForSlip(r)) continue;
    counts.afterSideRule++;

    if (phase6DirectionalBlocked(r)) continue;
    counts.afterDirectional++;

    if (!marketTrustAllowed(r)) continue;
    counts.afterMarketTrust++;

    const prob = Number(r.recommendedProb);
    if (!(prob >= (tier(r) === 'standard' ? 0.52 : 0.60))) continue;
    counts.afterProb++;

    const ev = Number(r.expectedValue);
    if (!(tier(r) === 'standard' ? ev >= 0 : ev >= 1.10)) continue;
    counts.afterEV++;

    counts.finalPlayable++;
  }

  console.log("FILTER DIAGNOSTICS");
  console.table(counts);
}



function hasCleanGamePk(r) {
  return !!(r.gamePk || r.game_pk || r.mlbGamePk || r.gameId || r.game_id);
}

function hasCleanStartTime(r) {
  return !!(
    r.startTime ||
    r.start_time ||
    r.gameTime ||
    r.game_time ||
    r.commence_time ||
    r.scheduledStart ||
    r.scheduled_start
  );
}

function getDoubleHeaderMatchupKey(r) {
  return (
    r.canonicalGameKey ||
    r.gameKey ||
    r.game_key ||
    r.matchup ||
    r.game ||
    ((r.awayTeam || r.away || r.away_team) && (r.homeTeam || r.home || r.home_team)
      ? `${r.awayTeam || r.away || r.away_team}@${r.homeTeam || r.home || r.home_team}`
      : null)
  );
}

function applyDoubleHeaderGuard(rows) {
  const gamePkByMatchup = new Map();
  const startTimesByMatchup = new Map();

  for (const r of rows) {
    const key = getDoubleHeaderMatchupKey(r);
    if (!key) continue;

    const pk = r.gamePk || r.game_pk || r.mlbGamePk || r.gameId || r.game_id;
    const start = r.startTime || r.start_time || r.gameTime || r.game_time || r.commence_time || r.scheduledStart || r.scheduled_start;

    if (pk) {
      if (!gamePkByMatchup.has(key)) gamePkByMatchup.set(key, new Set());
      gamePkByMatchup.get(key).add(String(pk));
    }

    if (start) {
      if (!startTimesByMatchup.has(key)) startTimesByMatchup.set(key, new Set());
      startTimesByMatchup.get(key).add(String(start));
    }
  }

  return rows.map(r => {
    const key = getDoubleHeaderMatchupKey(r);
    const gamePkCount = key && gamePkByMatchup.has(key) ? gamePkByMatchup.get(key).size : 0;
    const startCount = key && startTimesByMatchup.has(key) ? startTimesByMatchup.get(key).size : 0;
    const possibleDoubleHeader = !!key && (gamePkCount > 1 || startCount > 1);

    if (!possibleDoubleHeader) return r;

    if (!hasCleanGamePk(r)) {
      return {
        ...r,
        rankEligible: false,
        playableEligible: false,
        playable: false,
        doubleHeaderRisk: true,
        disabledReason: r.disabledReason || "doubleheader_missing_gamepk"
      };
    }

    if (!hasCleanStartTime(r)) {
      return {
        ...r,
        rankEligible: false,
        playableEligible: false,
        playable: false,
        doubleHeaderRisk: true,
        disabledReason: r.disabledReason || "doubleheader_missing_start_time"
      };
    }

    return {
      ...r,
      doubleHeaderRisk: true,
      doubleHeaderCleared: true
    };
  });
}

const normalizedRows = applyDoubleHeaderGuard(rows.map(normalizeForOptimizer).map(applyPhase55ToOptimizerRow).map(applyPhase5ContextAdjustments));
diagnostics(normalizedRows);


function executionMarket(m) {
  return String(m || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function executionSide(r) {
  return String(r.side || r.recommendedSide || r.direction || "").toUpperCase();
}

function executionProb(r) {
  return Number(r.calibratedDistributionProb ?? r.distributionProb ?? r.prob ?? r.recommendedProb ?? 0);
}

function executionEdge(r) {
  return Number(r.adjustedEdge ?? r.edge ?? r.sportsbookAdjustedEdge ?? r.sportsbookEdge ?? 0);
}

function executionBooks(r) {
  return Number(r.sportsbookBookCount ?? r.books ?? 0);
}

function executionConfidence(r) {
  return String(r.confidenceBucket || r.confidence || r.calibratedConfidence?.confidence || "").toLowerCase();
}

function passesExecutionFilter(r) {
  const market = executionMarket(r.market || r.stat);
  const side = executionSide(r);
  const prob = executionProb(r);
  const edge = executionEdge(r);
  const books = executionBooks(r);
  const confidence = executionConfidence(r);
  const tier = String(r.oddsTier || r.tier || r.specialTier || "standard").toLowerCase();

  const allowedMarkets = new Set([
    "strikeouts",
    "hits",
    "bases",
    "hrr",
    "runs",
    "rbis",
    "rbi",
    "pitching_outs",
    "hits_allowed",
    "earned_runs_allowed"
  ]);

  const hitterMarkets = new Set(["hits", "bases", "hrr", "runs", "rbis", "rbi"]);

  if (!allowedMarkets.has(market)) return false;
  if (["goblin", "demon"].includes(tier)) return false;
  if (!["MORE", "LESS"].includes(side)) return false;
  if (!Number.isFinite(prob) || prob < 0.56) return false;
  if (!Number.isFinite(edge) || edge < 0.03) return false;
  // Books can be missing on otherwise valid model rows; require books later in final-slips layer.
  // Confidence labels are not consistently populated here; use probability/edge/market/side gates instead.

  // v1 side-bias protection: raw board shows hitter MORE is structurally weak.
  if (hitterMarkets.has(market) && side === "MORE") return false;

  return true;
}

const baseCandidates = dedupeRows(normalizedRows.filter(r => playable(r) && phase5HardAllowed(r) && phase6RegimeAllowed(r)));

const standardKWatchlist = normalizedRows
  .filter(r =>
    r.recordType === 'merged_prop' &&
    market(r) === 'strikeouts' &&
    tier(r) === 'standard' &&
    sideKey(r) === 'MORE' &&
    isValidGameAssignment(r) &&
    n(r.recommendedProb) >= 0.52 &&
    !['pass'].includes(String(r.confidenceBucket || '').toLowerCase())
  )
  .map(r => ({
    ...r,
    kWatchlistCandidate: true
  }));

const preExecutionCandidates = dedupeRows([...baseCandidates, ...standardKWatchlist])
  .sort((a, b) => baseScore(b) - baseScore(a));

const executionPassedCandidates = preExecutionCandidates.filter(passesExecutionFilter);
const candidates = preExecutionCandidates.slice(0, MAX_CANDIDATES); // report-only for now; do not enforce until fresh slate validation.


const executionRejects = {};
for (const r of preExecutionCandidates) {
  const market = executionMarket(r.market || r.stat);
  const side = executionSide(r);
  const prob = executionProb(r);
  const edge = executionEdge(r);
  const tier = String(r.oddsTier || r.tier || r.specialTier || "standard").toLowerCase();

  let reason = "pass";
  if (!new Set(["strikeouts","hits","bases","hrr","runs","rbis","rbi","pitching_outs","hits_allowed","earned_runs_allowed"]).has(market)) reason = `market:${market}`;
  else if (["goblin", "demon"].includes(tier)) reason = `tier:${tier}`;
  else if (!["MORE", "LESS"].includes(side)) reason = `side:${side}`;
  else if (!Number.isFinite(prob) || prob < 0.56) reason = `prob:${prob}`;
  else if (!Number.isFinite(edge) || edge < 0.03) reason = `edge:${edge}`;
  else if (new Set(["hits","bases","hrr","runs","rbis","rbi"]).has(market) && side === "MORE") reason = `hitter_more:${market}`;

  executionRejects[reason] = (executionRejects[reason] || 0) + 1;
}
console.log("Execution reject reasons:", executionRejects);

console.log("Execution filter before:", preExecutionCandidates.length);
console.log("Execution filter after:", executionPassedCandidates.length);

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

for (const size of SIZES.filter(phase6SlipSizeAllowed)) {
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
