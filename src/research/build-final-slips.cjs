const fs = require("fs");
const { loadFullBoardPromotion, applyFullBoardPromotion } = require("../lib/fullBoardPromotion.cjs");

function readJsonSafe(path, fallback = {}) {
  try { return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback; }
  catch { return fallback; }
}

const EXPOSURE_GOVERNOR = readJsonSafe("data/learning/phase6-exposure-governor.json", {});
const PHASE6_FEATURES = readJsonSafe("data/learning/phase6-feature-attribution.json", {});
const PHASE6_REGIME = readJsonSafe("data/learning/phase6-regime-detection.json", {});
const PHASE6_HARDBAN = readJsonSafe("data/learning/phase6-hardban-reactivation.json", {});
const PHASE6_ADAPTIVE_RULES = readJsonSafe("data/learning/phase6-adaptive-rules.json", {});
const MAX_FINAL_SLIP_SIZE = Number(EXPOSURE_GOVERNOR.governor?.maxSlipSize || EXPOSURE_GOVERNOR.maxSlipSize || 6);
const EXPOSURE_SCORE_MULTIPLIER = Number(EXPOSURE_GOVERNOR.governor?.scoreMultiplier || EXPOSURE_GOVERNOR.scoreMultiplier || 1);
const { scoreEliteContext } = require("./elite-context-score.cjs");
const { marketModelScore } = require("./market-model-router.cjs");
const { applyHistoricalEdgeShrinkage } = require("./edge-shrinkage.cjs");
const { remapConfidence } = require("./confidence-remap.cjs");
const { autoMarketDecision } = require("./auto-market-suppression.cjs");
const { volatilityAdjustment } = require("./volatility-adjustment.cjs");
const { priceSlip } = require("../pricing/prizepicks-payout-engine.cjs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const priced = readJson("outputs/slips-distribution-enriched.json", null) || readJson("outputs/slips-priced.json", []);
const MARKET_TRUST = readJson("data/learning/market-trust.json", { byMarketDirection: {} });
const VALIDATION_RULES_RAW = readJson("data/results/validation-rules.json", []);
const VALIDATION_RULES = Array.isArray(VALIDATION_RULES_RAW)
  ? VALIDATION_RULES_RAW
  : [
      ...(VALIDATION_RULES_RAW.byProbability || []),
      ...(VALIDATION_RULES_RAW.byMarket || []),
      ...(VALIDATION_RULES_RAW.byBooks || [])
    ];

function sideKey(x) {
  return String(x.side || x.recommendedSide || "").toUpperCase();
}
function trustKey(x) {
  const market = String(x.market || x.stat || "unknown").toLowerCase().replace(/\s+/g, "_").trim();
  return `${market}_${sideKey(x)}`;
}
function marketTrust(x) {
  return MARKET_TRUST.byMarketDirection?.[trustKey(x)] || null;
}
function trustSuppressed(x) {
  return Boolean(marketTrust(x)?.suppressed);
}
function trustScoreAdjustment(x) {
  const t = marketTrust(x);
  if (!t) return 0;
  if (t.trust === "strong") return 0.025;
  if (t.trust === "weak") return -0.04;
  if (t.trust === "blocked") return -0.25;
  return 0;
}

function normMarketKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function probBucket(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p)) return null;
  const lo = Math.floor(p * 20) / 20;
  const hi = lo + 0.05;
  return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
}

function findValidationRule(x) {
  const market = normMarketKey(x.market || x.stat);
  const side = sideKey(x);
  const marketBucket = `${market} ${side}`;
  const prob = Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
  const bucket = probBucket(prob);

  const marketRule = VALIDATION_RULES.find(r =>
    String(r.type || "").toLowerCase() === "market" &&
    String(r.bucket || "").toLowerCase() === marketBucket.toLowerCase()
  );

  const probRule = VALIDATION_RULES.find(r =>
    String(r.type || "").toLowerCase() === "probability" &&
    String(r.bucket || "") === bucket
  );

  return { marketRule, probRule };
}

function validationScoreAdjustment(x) {
  const { marketRule, probRule } = findValidationRule(x);
  let adj = 0;

  for (const r of [marketRule, probRule]) {
    if (!r) continue;
    const action = String(r.action || "").toLowerCase();
    const ruleAdj = Number(r.adjustment || 0);
    const edge = Number(r.calibrationEdge || 0);

    if (Number.isFinite(ruleAdj)) adj += ruleAdj;
    if (action.includes("medium") && edge <= -0.12) adj -= 0.025;
    if (action.includes("large") && edge <= -0.10) adj -= 0.05;
  }

  return Number(Math.max(-0.12, Math.min(0.04, adj)).toFixed(4));
}

function validationSuppressed(x) {
  const { marketRule } = findValidationRule(x);
  if (!marketRule) return false;

  const count = Number(marketRule.count || 0);
  const actual = Number(marketRule.actual);
  const edge = Number(marketRule.calibrationEdge || 0);
  const action = String(marketRule.action || "").toLowerCase();

  // Only hard-block when there is enough signal. Small samples remain downgraded, not blocked.
  if (count >= 20 && actual < 0.48 && edge <= -0.12) return true;
  if (action.includes("large") && edge <= -0.15) return true;

  return false;
}

function validationTag(x) {
  const { marketRule, probRule } = findValidationRule(x);
  return {
    marketRule: marketRule || null,
    probabilityRule: probRule || null,
    adjustment: validationScoreAdjustment(x),
    suppressed: validationSuppressed(x)
  };
}


function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}


function sideKey(x) {
  return String(x.side || x.recommendedSide || "").toUpperCase();
}
function trustKey(x) {
  const market = String(x.market || x.stat || "unknown").toLowerCase().replace(/\s+/g, "_").trim();
  return `${market}_${sideKey(x)}`;
}
function marketTrust(x) {
  return MARKET_TRUST.byMarketDirection?.[trustKey(x)] || null;
}
function trustSuppressed(x) {
  return Boolean(marketTrust(x)?.suppressed);
}
function trustScoreAdjustment(x) {
  const t = marketTrust(x);
  if (!t) return 0;
  if (t.trust === "strong") return 0.025;
  if (t.trust === "weak") return -0.04;
  if (t.trust === "blocked") return -0.25;
  return 0;
}

function gameKey(x) {
  return String(x.game || x.sportsbookGame || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function teamKey(x) {
  return String(x.team || "").toUpperCase().trim();
}


const TEAM_FULL_NAMES = {
  ARI: "arizona diamondbacks",
  AZ: "arizona diamondbacks",
  ATH: "athletics",
  ATL: "atlanta braves",
  BAL: "baltimore orioles",
  BOS: "boston red sox",
  CHC: "chicago cubs",
  CWS: "chicago white sox",
  CHW: "chicago white sox",
  CIN: "cincinnati reds",
  CLE: "cleveland guardians",
  COL: "colorado rockies",
  DET: "detroit tigers",
  HOU: "houston astros",
  KC: "kansas city royals",
  KCR: "kansas city royals",
  LAA: "los angeles angels",
  LAD: "los angeles dodgers",
  MIA: "miami marlins",
  MIL: "milwaukee brewers",
  MIN: "minnesota twins",
  NYM: "new york mets",
  NYY: "new york yankees",
  OAK: "athletics",
  PHI: "philadelphia phillies",
  PIT: "pittsburgh pirates",
  SD: "san diego padres",
  SDP: "san diego padres",
  SEA: "seattle mariners",
  SF: "san francisco giants",
  SFG: "san francisco giants",
  STL: "st louis cardinals",
  TB: "tampa bay rays",
  TBR: "tampa bay rays",
  TEX: "texas rangers",
  TOR: "toronto blue jays",
  WSH: "washington nationals",
  WAS: "washington nationals"
};

function textNorm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstContextValue(x, keys) {
  for (const key of keys) {
    if (x && x[key] !== undefined && x[key] !== null && x[key] !== "") return x[key];
  }

  for (const key of keys) {
    const parts = key.split(".");
    let cur = x;
    let ok = true;

    for (const part of parts) {
      if (!cur || typeof cur !== "object" || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }

    if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
  }

  return "";
}

function normalizeHomeAway(v) {
  const x = textNorm(v);
  if (!x) return "";
  if (["home", "h"].includes(x)) return "home";
  if (["away", "road", "a"].includes(x)) return "away";
  return x;
}

function normalizePitcherHand(v) {
  const x = textNorm(v);
  if (!x) return "";
  if (["r", "rh", "rhp", "right", "righty", "right handed", "right hand"].includes(x)) return "RHP";
  if (["l", "lh", "lhp", "left", "lefty", "left handed", "left hand"].includes(x)) return "LHP";
  return String(v).toUpperCase();
}

function deriveHomeAwayFromGame(x) {
  const existing = normalizeHomeAway(firstContextValue(x, [
    "homeAway",
    "home_away",
    "location",
    "venueSide",
    "gameLocation",
    "splitHomeAway",
    "context.homeAway",
    "context.location",
    "splits.homeAway"
  ]));
  if (existing) return existing;

  const game = String(x.game || x.resolvedGame || x.sportsbookGame || "");
  const team = teamKey(x);
  const full = TEAM_FULL_NAMES[team] || "";

  if (!game || !full) return "";

  const parts = game.split(/\s+@\s+|\s+ at \s+/i);
  if (parts.length !== 2) return "";

  const away = textNorm(parts[0]);
  const home = textNorm(parts[1]);
  const teamName = textNorm(full);

  if (away.includes(teamName) || teamName.includes(away)) return "away";
  if (home.includes(teamName) || teamName.includes(home)) return "home";

  return "";
}

function deriveOpposingPitcher(x) {
  return String(firstContextValue(x, [
    "opposingPitcher",
    "probablePitcher",
    "starter",
    "opponentPitcher",
    "oppPitcher",
    "pitcherName",
    "opposingStarter",
    "context.opposingPitcher",
    "context.probablePitcher",
    "splits.opposingPitcher"
  ]) || "").trim();
}

function derivePitcherHand(x) {
  return normalizePitcherHand(firstContextValue(x, [
    "pitcherHand",
    "opposingPitcherHand",
    "starterHand",
    "probablePitcherHand",
    "opponentPitcherHand",
    "oppPitcherHand",
    "pitcher_hand",
    "throws",
    "throwsHand",
    "context.pitcherHand",
    "context.opposingPitcherHand",
    "splits.pitcherHand"
  ]));
}

function splitContextFields(x) {
  const matchup = pitcherMatchupContext(x);
  return {
    homeAway: deriveHomeAwayFromGame(x) || null,
    pitcherHand: derivePitcherHand(x) || matchup.pitcherHand || null,
    opposingPitcher: deriveOpposingPitcher(x) || matchup.opposingPitcher || null,
    opposingPitcherId: matchup.opposingPitcherId || null,
    pitcherMatchupSource: matchup.pitcherMatchupSource || null
  };
}


const PROBABLE_PITCHER_CONTEXT = readJson("data/context/probable-pitcher-hands.json", {});
const CONTEXT_DEPTH_PACK = readJson("data/context/context-depth-pack.json", {});
const GAME_MODEL_CONTEXT = readJson("data/context/game-model-context.json", {});

function normTeamCode(v) {
  const t = String(v || "").toUpperCase().trim();
  if (t === "AZ") return "ARI";
  if (t === "WSH") return "WSH";
  if (t === "WAS") return "WSH";
  if (t === "SDP") return "SD";
  if (t === "SFG") return "SF";
  if (t === "TBR") return "TB";
  if (t === "KCR") return "KC";
  if (t === "CHW") return "CWS";
  if (t === "OAK") return "ATH";
  return t;
}

function gameCandidatesFromPack(pack) {
  if (!pack || typeof pack !== "object" || !pack.games || typeof pack.games !== "object") return [];
  return Object.values(pack.games).filter(g => g && typeof g === "object");
}

function probableGames() {
  return gameCandidatesFromPack(PROBABLE_PITCHER_CONTEXT);
}

function richContextGames() {
  return [
    ...gameCandidatesFromPack(CONTEXT_DEPTH_PACK),
    ...gameCandidatesFromPack(GAME_MODEL_CONTEXT)
  ];
}

function sameGameByPk(g, x) {
  const a = Number(g?.gamePk);
  const b = Number(x.gamePk ?? x.resolvedGamePk);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

function sameGameByTeams(g, x) {
  const team = normTeamCode(teamKey(x));
  const away = normTeamCode(g.awayTeam);
  const home = normTeamCode(g.homeTeam);
  if (!team || !away || !home) return false;

  const game = String(x.game || x.resolvedGame || x.sportsbookGame || "");
  const compact = textNorm(game);

  if (game && compact) {
    const awayFull = textNorm(TEAM_FULL_NAMES[away] || away);
    const homeFull = textNorm(TEAM_FULL_NAMES[home] || home);
    if (compact.includes(awayFull) && compact.includes(homeFull)) return true;
    if (compact.includes(textNorm(`${away} ${home}`))) return true;
  }

  return team === away || team === home;
}

function findProbableGame(x) {
  const games = probableGames();
  return (
    games.find(g => sameGameByPk(g, x)) ||
    games.find(g => sameGameByTeams(g, x)) ||
    null
  );
}

function findRichGame(x) {
  const games = richContextGames();
  return (
    games.find(g => sameGameByPk(g, x)) ||
    games.find(g => sameGameByTeams(g, x)) ||
    null
  );
}

function sideForTeam(game, x) {
  const team = normTeamCode(teamKey(x));
  const away = normTeamCode(game?.awayTeam);
  const home = normTeamCode(game?.homeTeam);
  if (!team || !away || !home) return "";
  if (team === away) return "away";
  if (team === home) return "home";
  return "";
}

function probableOpposingPitcherFromGame(game, x) {
  const side = sideForTeam(game, x);
  if (side === "away") {
    return {
      opposingPitcher: game.homeProbablePitcher || null,
      opposingPitcherId: game.homePitcherId || null,
      pitcherHand: normalizePitcherHand(game.homePitcherHand) || null
    };
  }
  if (side === "home") {
    return {
      opposingPitcher: game.awayProbablePitcher || null,
      opposingPitcherId: game.awayPitcherId || null,
      pitcherHand: normalizePitcherHand(game.awayPitcherHand) || null
    };
  }
  return { opposingPitcher: null, opposingPitcherId: null, pitcherHand: null };
}

function richOpposingPitcherFromGame(game, x) {
  const side = sideForTeam(game, x);
  if (side === "away") {
    const sp = game.home?.startingPitcher || null;
    return {
      opposingPitcher: sp?.name || null,
      opposingPitcherId: sp?.id || null,
      pitcherHand: normalizePitcherHand(sp?.hand) || null
    };
  }
  if (side === "home") {
    const sp = game.away?.startingPitcher || null;
    return {
      opposingPitcher: sp?.name || null,
      opposingPitcherId: sp?.id || null,
      pitcherHand: normalizePitcherHand(sp?.hand) || null
    };
  }
  return { opposingPitcher: null, opposingPitcherId: null, pitcherHand: null };
}

function pitcherMatchupContext(x) {
  const probable = findProbableGame(x);
  const rich = findRichGame(x);

  const probableCtx = probable ? probableOpposingPitcherFromGame(probable, x) : {};
  const richCtx = rich ? richOpposingPitcherFromGame(rich, x) : {};

  return {
    opposingPitcher: probableCtx.opposingPitcher || richCtx.opposingPitcher || null,
    opposingPitcherId: probableCtx.opposingPitcherId || richCtx.opposingPitcherId || null,
    pitcherHand: richCtx.pitcherHand || probableCtx.pitcherHand || null,
    pitcherMatchupSource: rich
      ? "context_depth_or_game_model"
      : probable
        ? "probable_pitcher_hands"
        : null
  };
}

function isCheapHrrHalf(x) {
  const market = String(x.market || x.stat || "").toLowerCase();
  return market === "hrr" && Number(x.line) === 0.5;
}

function cheapHrrHalfCount(legs) {
  return legs.filter(isCheapHrrHalf).length;
}


function syntheticPricingPenalty(x) {
  const market = String(x.market || x.stat || "").toLowerCase();
  if (!x.sportsbookSynthetic) return 0;
  if (market === "singles") return -0.18;
  return -0.08;
}

function isSyntheticSingles(x) {
  return Boolean(x.sportsbookSynthetic) &&
    String(x.market || x.stat || "").toLowerCase() === "singles";
}

function marketFamily(x) {
  const m = String(x.market || x.stat || "").toLowerCase();
  if (["hits", "bases", "hrr", "runs", "rbis", "home_runs"].includes(m)) return "hitter_counting";
  if (m === "hitter_strikeouts") return "hitter_k";
  if (m.includes("strikeout")) return "pitcher_k";
  return m;
}


function ensembleAgreement(x) {
  const grade = displayGrade(x);
  const prob = Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
  const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? x.edge);
  const sav = String(x.savantReportGrade || x.savantGradeReport || x.savantGrade || "").toUpperCase();

  const modelStrong = Number.isFinite(prob) && prob >= 0.60;
  const modelPlayable = Number.isFinite(prob) && prob >= 0.52;
  const marketStrong = Number.isFinite(edge) && edge >= 0.05;
  const marketPlayable = Number.isFinite(edge) && edge > 0;
  const savantNegative = sav.includes("DOWNGRADE");

  if (grade === "GREEN" && modelStrong && marketStrong && !savantNegative) return "MODEL_AGREEMENT";
  if (grade === "GREEN" && marketStrong && !modelPlayable) return "MARKET_ONLY";
  if (modelStrong && !marketPlayable) return "MODEL_ONLY";
  if (modelPlayable && marketPlayable && savantNegative) return "DISAGREEMENT";
  if (grade === "GREEN" || marketPlayable || modelPlayable) return "LOW_CONFIDENCE";
  return "PASS";
}

function ensembleScoreAdjustment(x) {
  const a = ensembleAgreement(x);
  if (a === "MODEL_AGREEMENT") return 0.045;
  if (a === "MARKET_ONLY") return -0.015;
  if (a === "MODEL_ONLY") return -0.08;
  if (a === "DISAGREEMENT") return -0.075;
  if (a === "LOW_CONFIDENCE") return -0.025;
  return -0.10;
}

function bookSupportMultiplier(x) {
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);
  if (books >= 8) return 1.10;
  if (books >= 5) return 1.05;
  if (books >= 3) return 1.00;
  if (books >= 2) return 0.92;
  return 0.82;
}

function hasDistributionModel(x) {
  return Number.isFinite(Number(x.calibratedDistributionProb)) || Number.isFinite(Number(x.distributionProb));
}

function minEdgeForSlipSize(size) {
  if (size <= 2) return 0.17;
  if (size === 3) return 0.15;
  if (size === 4) return 0.12;
  return 0.10;
}



function selectedSideProb(x) {
  return Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
}

function oppositeSide(side) {
  return String(side || "").toUpperCase() === "MORE" ? "LESS" : "MORE";
}

function twoSidedPricing(x) {
  const side = sideKey(x);
  const selectedProb = selectedSideProb(x);
  if (!Number.isFinite(selectedProb)) {
    return {
      selectedSide: side,
      oppositeSide: oppositeSide(side),
      selectedProb: null,
      oppositeProb: null,
      modelOnlyEdge: null,
      valid: false
    };
  }

  const clamped = Math.max(0.01, Math.min(0.99, selectedProb));
  const oppositeProb = Math.max(0.01, Math.min(0.99, 1 - clamped));

  return {
    selectedSide: side,
    oppositeSide: oppositeSide(side),
    selectedProb: Number(clamped.toFixed(4)),
    oppositeProb: Number(oppositeProb.toFixed(4)),
    modelOnlyEdge: Number((clamped - 0.5).toFixed(4)),
    valid: true
  };
}

function priceCoverageTier(x) {
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);
  const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? x.adjustedEdge ?? x.edge);
  if (books <= 0 || !Number.isFinite(edge)) return "NO_PRICE";
  if (books < 3) return "LOW_BOOK";
  if (books < 5) return "MEDIUM_BOOK";
  return "FULL_MARKET";
}

function lowBookControlledUnlockV1(x, gate) {
  if (!gate || gate.passed === true) return false;

  const market = normalizedMarket(x);
  const side = sideKey(x);
  const tier = specialTier(x);
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);
  const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? x.adjustedEdge ?? x.edge);
  const two = twoSidedPricing(x);

  if (tier !== "standard") return false;
  if (!two.valid) return false;
  if (books < 1 || books > 2) return false;
  if (!Number.isFinite(edge)) return false;

  // Never low-book unlock known fragile/no-price/blocked markets.
  if (FINAL_BLOCKED_MARKETS.has(market)) return false;
  if (market === "home_runs") return false;

  const stableLess =
    side === "LESS" &&
    ["strikeouts", "pitching_outs", "hits_allowed", "hits"].includes(market);

  if (stableLess) {
    return two.selectedProb >= 0.62 && edge >= 0.075;
  }

  if (market === "earned_runs_allowed" && side === "LESS") {
    return two.selectedProb >= 0.64 && edge >= 0.10;
  }

  return false;
}


function marketSideKey(x) {
  return `${normalizedMarket(x)}_${sideKey(x)}`;
}
function oddsTier(x) {
  return String(x.oddsTier || x.tier || "standard").toLowerCase().trim();
}
function marketSideTierKey(x) {
  return `${marketSideKey(x)}_${oddsTier(x)}`;
}

function phase6Rows(obj) {
  if (Array.isArray(obj)) return obj;
  if (Array.isArray(obj.rows)) return obj.rows;
  if (obj.rows && typeof obj.rows === "object") return Object.values(obj.rows);
  if (Array.isArray(obj.features)) return obj.features;
  if (obj.features && typeof obj.features === "object") return Object.values(obj.features);
  if (Array.isArray(obj.markets)) return obj.markets;
  if (obj.markets && typeof obj.markets === "object") return Object.values(obj.markets);
  if (Array.isArray(obj.data)) return obj.data;
  if (obj.data && typeof obj.data === "object") return Object.values(obj.data);
  return [];
}

function phase6FeatureWeight(x) {
  const rows = phase6Rows(PHASE6_FEATURES);
  if (!rows.length) return 1;

  const checks = [
    ["market_side", marketSideKey(x)],
    ["market", normalizedMarket(x)],
    ["side", sideKey(x)]
  ];

  let weight = 1;
  for (const [feature, value] of checks) {
    const row = rows.find(r =>
      String(r.feature || "").toLowerCase() === feature &&
      String(r.value || r.key || "").toLowerCase() === String(value).toLowerCase()
    );
    if (row && Number.isFinite(Number(row.weight))) {
      weight *= Number(row.weight);
    }
  }

  return Math.max(0.35, Math.min(1.18, weight));
}

function phase6RegimeMultiplier(x) {
  const rows = phase6Rows(PHASE6_REGIME);
  const row = rows.find(r =>
    String(r.key || "").toLowerCase() === marketSideKey(x).toLowerCase()
  );
  if (!row) return 1;
  return Math.max(0.4, Math.min(1.12, Number(row.scoreMultiplier || 1)));
}

function phase6HardBanned(x) {
  const rows = phase6Rows(PHASE6_HARDBAN);
  const row = rows.find(r =>
    String(r.key || "").toLowerCase() === marketSideKey(x).toLowerCase()
  );
  if (!row) return false;
  const status = String(row.status || row.reactivation || "").toUpperCase();
  return status.includes("KEEP_HARD_BANNED") || status.includes("KEEP_SUPPRESSED");
}


function phase6ProbBucket(prob) {
  const p = Number(prob);
  if (!Number.isFinite(p)) return "unknown";
  if (p < 0.55) return "<55";
  if (p < 0.60) return "55-60";
  if (p < 0.65) return "60-65";
  if (p < 0.70) return "65-70";
  if (p < 0.75) return "70-75";
  return "75+";
}
function phase6EdgeBucket(edge) {
  const e = Number(edge);
  if (!Number.isFinite(e)) return "unknown";
  if (e < 0.05) return "<5%";
  if (e < 0.10) return "5-10%";
  if (e < 0.15) return "10-15%";
  return "15%+";
}
function phase6AdaptiveRuleSet(x) {
  const prob = Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
  const edge = Number(x.sportsbookAdjustedEdge ?? x.adjustedEdge ?? x.sportsbookEdge ?? x.edge);
  const market = normalizedMarket(x);
  const marketSide = marketSideKey(x);
  const marketSideTier = marketSideTierKey(x);
  const probBucket = phase6ProbBucket(prob);
  const edgeBucket = phase6EdgeBucket(edge);
  const rules = [
    PHASE6_ADAPTIVE_RULES.byMarket?.[market],
    PHASE6_ADAPTIVE_RULES.byMarketSideTier?.[marketSideTier],
    PHASE6_ADAPTIVE_RULES.byMarketSide?.[marketSide],
    PHASE6_ADAPTIVE_RULES.byProbabilityBucket?.[probBucket],
    PHASE6_ADAPTIVE_RULES.byEdgeBucket?.[edgeBucket]
  ].filter(Boolean);
  const multiplier = rules.reduce((m, r) => m * Number(r.multiplier ?? 1), 1);
  const thresholdAdjustment = rules.reduce((a, r) => a + Number(r.thresholdAdjustment ?? 0), 0);
  return {
    market,
    marketSide,
    marketSideTier,
    probBucket,
    edgeBucket,
    multiplier: Number(Math.max(0.45, Math.min(1.2, multiplier)).toFixed(4)),
    thresholdAdjustment: Number(Math.max(-0.03, Math.min(0.08, thresholdAdjustment)).toFixed(4)),
    actions: rules.map(r => ({
      bucket: r.bucket,
      action: r.action,
      multiplier: r.multiplier,
      thresholdAdjustment: r.thresholdAdjustment,
      reason: r.reason,
      graded: r.graded,
      hitRate: r.hitRate,
      roi: r.roi
    }))
  };
}
function phase6AdaptiveSuppressed(x) {
  return phase6AdaptiveRuleSet(x).actions.some(r =>
    String(r.action || "").toUpperCase() === "SUPPRESS" ||
    (String(r.action || "").toUpperCase() === "TIGHTEN" && Number(r.roi) <= -0.30 && Number(r.graded) >= 20)
  );
}

function phase6ScoreMultiplier(x) {
  return Math.max(
    0.25,
    Math.min(
      1.25,
      EXPOSURE_SCORE_MULTIPLIER * phase6FeatureWeight(x) * phase6RegimeMultiplier(x)
    )
  );
}

const fullBoardPromotionMap = loadFullBoardPromotion();

function finalScore(x) {
  const rawEdge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? -999);
  const edgeShrinkage = applyHistoricalEdgeShrinkage(rawEdge, x);
  const edge = Number(edgeShrinkage.edge);
  const cal = Number(x.calibratedDistributionProb);
  const raw = Number(x.distributionProb);
  const marketModel = marketModelScore(x);
  const elite = scoreEliteContext({
    savant: x.savantReportGrade,
    books: x.sportsbookBookCount,
    edge: x.sportsbookEdge
  });

  let score = edge;

  if (Number.isFinite(cal)) score += (cal - 0.5) * 0.18;
  else if (Number.isFinite(raw)) score += (raw - 0.5) * 0.08;

  const distProb = Number(x.calibratedDistributionProb ?? x.prob ?? x.recommendedProb ?? 0);
  const distConf = String(x.distributionModel?.confidence || "").toUpperCase();

  // Do not reward fake HIGH confidence unless probability is truly strong.
  if (distConf === "HIGH" && distProb >= 0.60) score += 0.01;
  if (distConf === "HIGH" && distProb < 0.55) score -= 0.02;
  if (distConf === "LOW") score -= 0.015;

  score += marketModel.marketModelScore;
  score += elite.contextScore;
  score += trustScoreAdjustment(x);

  score *= phase6ScoreMultiplier(x);
  score *= phase6AdaptiveRuleSet(x).multiplier;
  return Number(score.toFixed(4));
}


function displayGrade(x) {
  const grade = x.qualityGrade || x.grade;
  const market = String(x.market || x.stat || "").toLowerCase();
  const adj = Number(x.sportsbookAdjustedEdge ?? x.adjustedEdge);
  const calibrated = Number(x.calibratedDistributionProb);
  const edge = Number(x.sportsbookEdge ?? x.edge);
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);

  if (
    grade !== "FADE" &&
    books >= 1 &&
    Number.isFinite(adj) &&
    Number.isFinite(calibrated) &&
    adj >= 0.085 &&
    calibrated >= 0.67
  ) {
    return "GREEN";
  }

  if (
    grade === "FADE" &&
    ["bases", "hits", "runs", "rbis"].includes(market) &&
    Number.isFinite(edge) &&
    Number.isFinite(adj) &&
    edge > 0 &&
    adj >= 0.015
  ) {
    return "WATCHLIST";
  }

  return grade;
}


const FINAL_SUPPORTED_MARKETS = new Set([
  "strikeouts",
  "pitching_outs",
  "hits_allowed",
  "earned_runs_allowed",
  "hits",
  "bases",
  "runs",
  "rbis",
  "home_runs",
  "walks",
  "walks_allowed",
  "pitches_thrown",
  "hitter_strikeouts"
]);

const FINAL_BLOCKED_MARKETS = new Set([
  "hitter_fantasy_score",
  "pitcher_fantasy_score",
  "plate_appearances",
  "singles",
  "doubles",
  "triples",
  "stolen_bases",
  "pitcher_strikeouts_(combo)"
]);

function normalizedMarket(x) {
  return String(x.market || x.stat || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function unsupportedFinalMarket(x) {
  const market = normalizedMarket(x);
  if (FINAL_BLOCKED_MARKETS.has(market)) return true;
  if (!FINAL_SUPPORTED_MARKETS.has(market)) return true;
  return false;
}

function marketSpecificFinalGate(x) {
  const market = normalizedMarket(x);
  const side = sideKey(x);
  const prob = Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
  const adj = Number(x.sportsbookAdjustedEdge ?? x.adjustedEdge ?? x.sportsbookEdge ?? x.edge ?? 0);
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);

  if (!Number.isFinite(prob)) return false;
  if (!Number.isFinite(adj)) return false;

  if (market === "bases" && side === "MORE") return prob >= 0.56 && adj >= 0.08 && books >= 3;
  if (market === "hits") {
    if (side === "LESS") return prob >= 0.56 && adj >= 0.08 && books >= 3;
    return prob >= 0.58 && adj >= 0.09 && books >= 3;
  }
  if (market === "strikeouts") return prob >= 0.56 && adj >= 0.08 && books >= 2;
  if (market === "pitching_outs") return prob >= 0.56 && adj >= 0.09 && books >= 2;
  if (market === "hits_allowed") return prob >= 0.58 && adj >= 0.09 && books >= 3;
  if (market === "earned_runs_allowed") return prob >= 0.60 && adj >= 0.12 && books >= 3;
  if (market === "runs" || market === "rbis") return prob >= 0.64 && adj >= 0.12 && books >= 4;
  if (market === "home_runs") return prob >= 0.65 && adj >= 0.15 && books >= 4;

  return false;
}


function cleanLeg(x) {
  return {
    player: x.player,
    team: x.team,
    game: x.game || x.sportsbookGame || null,
    gamePk: x.gamePk || null,
    teamResolved: x.teamResolved,
    teamValid: x.teamValid,
    teamResolverStatus: x.teamResolverStatus ?? null,
    resolvedTeam: x.resolvedTeam ?? null,
    resolvedGame: x.resolvedGame ?? null,
    resolvedGamePk: x.resolvedGamePk ?? null,
    disabledReason: x.disabledReason ?? null,
    market: x.market,
    side: x.side,
    line: x.line,
    oddsTier: x.oddsTier || "standard",
    specialTier: x.oddsTier || x.specialTier || x.tier || "standard",
    edge: x.sportsbookEdge,
    adjustedEdge: x.sportsbookAdjustedEdge,
    historicalEdgeShrinkage: applyHistoricalEdgeShrinkage(
      Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge),
      x
    ),
    finalScore: x.finalScore,
    prePromotionScore: x.prePromotionScore ?? null,
    postPromotionScore: x.postPromotionScore ?? null,
    promotionDelta: x.promotionDelta ?? null,
    fullBoardPromotion: x.fullBoardPromotion ?? null,
    distributionProb: x.distributionProb ?? null,
    calibratedDistributionProb: x.calibratedDistributionProb ?? null,
    twoSidedPricing: twoSidedPricing(x),
    priceCoverageTier: priceCoverageTier(x),
    lowBookControlledUnlock: lowBookControlledUnlockV1(x, finalExecutionGate(x)),
    distributionConfidence: x.distributionModel?.confidence || null,

    // Phase 5 context audit fields
    contextBaseProjection: x.contextBaseProjection ?? null,
    contextAdjustedProjection: x.contextAdjustedProjection ?? null,
    contextMultiplier: x.contextMultiplier ?? null,
    contextProjectionNotes: x.contextProjectionNotes ?? [],
    teamTotal: x.teamTotal ?? null,
    opponent: x.opponent ?? null,
    ...splitContextFields(x),
    opponentBullpenWeak: x.opponentBullpenWeak ?? null,
    opponentBullpenElite: x.opponentBullpenElite ?? null,
    handednessAdvantage: x.handednessAdvantage ?? null,
    recentForm: x.recentForm ?? null,
    velocityTrend: x.velocityTrend ?? null,
    hardHitRate: x.hardHitRate ?? null,
    pitchTypeMatchupScore: x.pitchTypeMatchupScore ?? null,
    pitchTypeMatchupTier: x.pitchTypeMatchupTier ?? null,

    grade: displayGrade(x),
    books: x.sportsbookBookCount,
    savant: x.savantReportGrade,
    eliteContext: scoreEliteContext({
      savant: x.savantReportGrade,
      books: x.sportsbookBookCount,
      edge: x.sportsbookEdge
    }),
    marketModel: marketModelScore(x),
    marketTrust: marketTrust(x),
    validationRule: validationTag(x),
    finalMarketSupported: !unsupportedFinalMarket(x),
    finalMarketGatePassed: marketSpecificFinalGate(x),
    finalExecutionGate: finalExecutionGate(x),
    calibratedConfidence: remapConfidence({
      ...x,
      validationRule: validationTag(x),
      historicalEdgeShrinkage: applyHistoricalEdgeShrinkage(
        Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge),
        x
      ),
      finalMarketGatePassed: marketSpecificFinalGate(x)
    }),
    autoMarketDecision: autoMarketDecision(x),
    volatilityAdjustment: volatilityAdjustment(x),
    phase6Adaptive: phase6AdaptiveRuleSet(x),
    marketSupportFlag: x.marketSupportFlag || null,
    phase6: {
      hardBanned: phase6HardBanned(x),
      featureWeight: phase6FeatureWeight(x),
      regimeMultiplier: phase6RegimeMultiplier(x),
      exposureScoreMultiplier: EXPOSURE_SCORE_MULTIPLIER,
      scoreMultiplier: phase6ScoreMultiplier(x)
    }
  };
}

function counts(legs, x) {
  const g = gameKey(x);
  const t = teamKey(x);
  const fam = marketFamily(x);
  const market = String(x.market || x.stat || "").toLowerCase();
  return {
    sameGame: legs.filter(l => gameKey(l) === g).length,
    sameTeam: legs.filter(l => teamKey(l) === t).length,
    sameFamily: legs.filter(l => marketFamily(l) === fam).length,
    sameMarket: legs.filter(l => String(l.market || l.stat || "").toLowerCase() === market).length
  };
}

function canAddStrict(legs, x) {
  const player = normName(x.player);
  const moreCount = legs.filter(l => String(l.side || l.recommendedSide || "").toUpperCase() === "MORE").length;
  const nextMore = String(x.side || x.recommendedSide || "").toUpperCase() === "MORE" ? 1 : 0;
  const nextMorePct = (moreCount + nextMore) / Math.max(1, legs.length + 1);
  if (legs.length >= 2 && nextMorePct > 0.75) return false;
  if (legs.some(l => normName(l.player) === player)) return false;
  const c = counts(legs, x);
  const fam = marketFamily(x);
  if (gameKey(x) && c.sameGame >= 1) return false;
  if (teamKey(x) && c.sameTeam >= 1) return false;
  if (isCheapHrrHalf(x) && cheapHrrHalfCount(legs) >= 1) return false;
  if (fam === "hitter_counting" && c.sameFamily >= 4) return false;
  if (fam === "pitcher_k" && c.sameFamily >= 2) return false;
  if (c.sameMarket >= 2) return false;
  return true;
}

function canAddBalanced(legs, x) {
  const player = normName(x.player);
  const moreCount = legs.filter(l => String(l.side || l.recommendedSide || "").toUpperCase() === "MORE").length;
  const nextMore = String(x.side || x.recommendedSide || "").toUpperCase() === "MORE" ? 1 : 0;
  const nextMorePct = (moreCount + nextMore) / Math.max(1, legs.length + 1);
  if (legs.length >= 3 && nextMorePct > 0.80) return false;
  if (legs.some(l => normName(l.player) === player)) return false;
  const c = counts(legs, x);
  const fam = marketFamily(x);
  if (gameKey(x) && c.sameGame >= 1) return false;
  if (teamKey(x) && c.sameTeam >= 1) return false;
  if (isCheapHrrHalf(x) && cheapHrrHalfCount(legs) >= 2) return false;
  if (fam === "hitter_counting" && c.sameFamily >= 5) return false;
  if (fam === "pitcher_k" && c.sameFamily >= 1) return false;
  if (c.sameMarket >= 4) return false;

  // Larger slips can use more HRR 0.5, but still cap exposure.
  if (isCheapHrrHalf(x) && cheapHrrHalfCount(legs) >= 2) return false;

  return true;
}

function correlationLabel(legs) {
  const byGame = new Map();
  const byTeam = new Map();
  for (const l of legs) {
    const g = gameKey(l);
    const t = teamKey(l);
    if (g) byGame.set(g, (byGame.get(g) || 0) + 1);
    if (t) byTeam.set(t, (byTeam.get(t) || 0) + 1);
  }
  const maxGame = Math.max(0, ...byGame.values());
  const maxTeam = Math.max(0, ...byTeam.values());
  if (maxGame >= 3 || maxTeam >= 3) return "HIGH_CORRELATION";
  if (maxGame >= 2) return "GAME_STACK";
  if (maxTeam >= 2) return "TEAM_PAIR";
  return "OK";
}


function autoMarketSuppressed(x) {
  return autoMarketDecision(x).suppressed;
}

function autoMarketScoreAdjustment(x) {
  const d = autoMarketDecision(x);
  if (d.action === "SUPPRESS") return -0.30;
  if (d.action === "DOWNGRADE") return -0.08;
  if (d.action === "BOOST_OK") return 0.015;
  return 0;
}



function adaptiveThresholds(x, confidence) {
  const base = {
    absoluteScoreFloor: 0.10,
    nonEliteScoreFloor: 0.15,
    eliteScoreFloor: 0.10
  };

  const phase6Mult = phase6ScoreMultiplier(x);
  const featureWeight = phase6FeatureWeight(x);
  const regimeMult = phase6RegimeMultiplier(x);
  const marketSide = marketSideKey(x);

  let absoluteScoreFloor = base.absoluteScoreFloor;
  let nonEliteScoreFloor = base.nonEliteScoreFloor;
  let eliteScoreFloor = base.eliteScoreFloor;

  // If Phase 6 has downweighted this market/side, require stronger score.
  if (featureWeight < 0.9 || regimeMult < 0.9 || phase6Mult < 0.75) {
    absoluteScoreFloor += 0.015;
    nonEliteScoreFloor += 0.03;
    eliteScoreFloor += 0.04;
  }

  // Severe downweight = force elite plays to still clear meaningful score.
  if (featureWeight < 0.75 || phase6Mult < 0.55) {
    absoluteScoreFloor += 0.015;
    nonEliteScoreFloor += 0.03;
    eliteScoreFloor += 0.02;
  }

  // Strong historical LESS buckets can remain normal.
  if (
    marketSide.endsWith("_LESS") &&
    featureWeight >= 1.03 &&
    regimeMult >= 1
  ) {
    absoluteScoreFloor -= 0.01;
    nonEliteScoreFloor -= 0.01;
    eliteScoreFloor -= 0.01;
  }

  return {
    absoluteScoreFloor: Number(Math.max(0.08, Math.min(0.18, absoluteScoreFloor)).toFixed(4)),
    nonEliteScoreFloor: Number(Math.max(0.13, Math.min(0.24, nonEliteScoreFloor)).toFixed(4)),
    eliteScoreFloor: Number(Math.max(0.10, Math.min(0.20, eliteScoreFloor)).toFixed(4)),
    phase6Multiplier: phase6Mult,
    featureWeight,
    regimeMultiplier: regimeMult,
    marketSide
  };
}


function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const adaptiveOverrides = readJsonSafe("data/learning/adaptive-overrides.json", { rules: [] });

function scoreBucket(score) {
  if (!Number.isFinite(Number(score))) return null;
  const s = Number(score);
  if (s < 0.05) return "<0.05";
  if (s < 0.10) return "0.05-0.10";
  if (s < 0.15) return "0.10-0.15";
  if (s < 0.20) return "0.15-0.20";
  if (s < 0.25) return "0.20-0.25";
  return "0.25+";
}

function marketSideTierBucket(x) {
  const market = String(x.market || "").toLowerCase();
  const side = String(x.side || x.recommendedSide || "").toUpperCase();
  const tier = String(x.oddsTier || x.tier || "standard").toLowerCase();
  return `${market}_${side}_${tier}`;
}


function controlledUnblockV2(x, gate) {
  if (!gate || gate.passed === true) return false;

  const reasons = new Set(gate.reasons || []);
  const market = normalizedMarket(x);
  const side = sideKey(x);
  const tier = specialTier(x);
  const prob = Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
  const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? x.adjustedEdge ?? x.edge);
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);

  if (tier !== "standard") return false;
  if (!Number.isFinite(prob)) return false;

  const hardBlocks = [
    "auto_market_suppressed",
    "phase6_adaptive_suppressed",
    "unmodeled_confidence",
    "unsupported_market",
    "negative_edge",
    "missing_distribution",
    "missing_sportsbook_price"
  ];
  if (hardBlocks.some(r => reasons.has(r))) return false;

  const pitcherStable =
    market === "strikeouts" ||
    market === "pitching_outs" ||
    market === "hits_allowed";

  if (pitcherStable) {
    if (Number.isFinite(edge)) return prob >= 0.58 && edge >= 0.045 && books >= 3;
    return prob >= 0.595;
  }

  if (market === "earned_runs_allowed") {
    return prob >= 0.60 && edge >= 0.08 && books >= 3;
  }

  if ((market === "runs" || market === "rbis") && side === "LESS") {
    return prob >= 0.64 && edge >= 0.12 && books >= 4;
  }

  if (market === "hits" && side === "LESS") {
    if (Number.isFinite(edge)) return prob >= 0.57 && edge >= 0.06 && books >= 3;
    return prob >= 0.57;
  }

  return false;
}

function isAdaptiveUnblocked(x, gate) {
  const rules = adaptiveOverrides.rules || [];
  if (!rules.length || !gate) return false;

  const buckets = new Set([
    marketSideTierBucket(x),
    scoreBucket(gate.score),
    ...(gate.reasons || [])
  ].filter(Boolean));

  return rules.some(r =>
    r.action === "UNBLOCK" &&
    buckets.has(r.bucket)
  );
}


function specialTier(x) {
  const raw = [
    x.oddsTier,
    x.special,
    x.specialTier,
    x.tier,
    x.projectionType,
    x.pickType,
    x.variant,
    x.promoType
  ].filter(Boolean).join(" ").toLowerCase();

  if (raw.includes("goblin")) return "goblin";
  if (raw.includes("demon")) return "demon";
  return "standard";
}

function bestLegProb(x) {
  const vals = [
    x.calibratedDistributionProb,
    x.phase55Prob,
    x.adjustedProb,
    x.finalProb,
    x.probability,
    x.prob
  ];

  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n < 1) return n;
  }

  return null;
}


function adaptiveUnblockV1(x, reasons) {
  const tier = specialTier(x);
  const market = normalizedMarket(x);
  const side = sideKey(x);
  const prob = Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
  const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? x.adjustedEdge ?? x.edge);
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);

  if (tier !== "standard") return false;
  if (!Number.isFinite(prob) || !Number.isFinite(edge)) return false;
  if (books < 3) return false;

  const hardBlocks = new Set([
    "auto_market_suppressed",
    "phase6_adaptive_suppressed",
    "unmodeled_confidence",
    "failed_market_gate",
    "high_volatility_non_elite"
  ]);
  if (reasons.some(r => hardBlocks.has(r))) return false;

  const allowedMarkets = new Set([
    "strikeouts",
    "pitching_outs",
    "hits_allowed",
    "earned_runs_allowed",
    "hits"
  ]);
  if (!allowedMarkets.has(market)) return false;
  if (side === "MORE" && market !== "strikeouts") return false;

  return (
    (prob >= 0.58 && edge >= 0.12 && books >= 3) ||
    (prob >= 0.55 && edge >= 0.20 && books >= 3)
  );
}

function finalExecutionGate(x) {
  const confidence = remapConfidence({
    ...x,
    validationRule: validationTag(x),
    historicalEdgeShrinkage: applyHistoricalEdgeShrinkage(
      Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge),
      x
    ),
    volatilityAdjustment: volatilityAdjustment(x),
    finalMarketGatePassed: marketSpecificFinalGate(x)
  });

  const score = finalScore(x);
  const auto = autoMarketDecision(x);
  const vol = volatilityAdjustment(x);
  const thresholds = adaptiveThresholds(x, confidence.confidence);
  const adaptive = phase6AdaptiveRuleSet(x);
  thresholds.absoluteScoreFloor = Number((thresholds.absoluteScoreFloor + adaptive.thresholdAdjustment).toFixed(4));
  thresholds.nonEliteScoreFloor = Number((thresholds.nonEliteScoreFloor + adaptive.thresholdAdjustment).toFixed(4));
  thresholds.eliteScoreFloor = Number((thresholds.eliteScoreFloor + adaptive.thresholdAdjustment).toFixed(4));

  const reasons = [];

  if (auto.suppressed) reasons.push("auto_market_suppressed");
  if (phase6AdaptiveSuppressed(x)) reasons.push("phase6_adaptive_suppressed");
  if (confidence.confidence === "weak") reasons.push("weak_confidence");
  if (confidence.confidence === "unmodeled") reasons.push("unmodeled_confidence");
  if (score < thresholds.absoluteScoreFloor) reasons.push("score_below_adaptive_minimum");
  if (confidence.confidence === "elite" && score < thresholds.eliteScoreFloor) reasons.push("elite_score_below_adaptive_floor");
  if (
    confidence.confidence !== "elite" &&
    score < (thresholds.nonEliteScoreFloor - 0.03)
  ) reasons.push("non_elite_score_below_adaptive_floor");
  if (vol.volatility === "high" && confidence.confidence !== "elite") reasons.push("high_volatility_non_elite");
  if (!marketSpecificFinalGate(x)) reasons.push("failed_market_gate");

  const tier = specialTier(x);
  const legProb = bestLegProb(x);
  const adjEdge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? 0);

  if (tier === "goblin" && (legProb == null || legProb < 0.72)) {
    reasons.push("goblin_prob_below_72");
  }

  if (tier === "demon" && (!Number.isFinite(adjEdge) || adjEdge < 0.06)) {
    reasons.push("demon_edge_below_6pct");
  }

  const goblinStrongOverride =
    tier === "goblin" &&
    legProb != null &&
    legProb >= 0.68 &&
    Number.isFinite(adjEdge) &&
    adjEdge >= 0.30;

  if (goblinStrongOverride) {
    const removable = new Set([
      "non_elite_score_below_adaptive_floor",
      "high_volatility_non_elite",
      "score_below_adaptive_minimum"
    ]);

    for (let i = reasons.length - 1; i >= 0; i--) {
      if (removable.has(reasons[i])) reasons.splice(i, 1);
    }

    reasons.push("goblin_strong_override");
  }

  if (adaptiveUnblockV1(x, reasons)) {
    const removable = new Set([
      "weak_confidence",
      "score_below_adaptive_minimum",
      "non_elite_score_below_adaptive_floor",
      "elite_score_below_adaptive_floor"
    ]);
    for (let i = reasons.length - 1; i >= 0; i--) {
      if (removable.has(reasons[i])) reasons.splice(i, 1);
    }
    reasons.push("adaptive_unblock_v1");
  }

  return {
    passed: reasons.length === 0 || (reasons.length === 1 && reasons[0] === "adaptive_unblock_v1"),
    reasons,
    score,
    confidence: confidence.confidence,
    confidenceScore: confidence.score,
    autoMarketAction: auto.action,
    volatility: vol.volatility,
    volatilityPenalty: vol.penalty,
    adaptiveRules: adaptive,
    adaptiveThresholds: thresholds
  };
}


function isFinalCandidate(x) {
  if (phase6HardBanned(x)) return false;
  if (trustSuppressed(x)) return false;
  if (validationSuppressed(x)) return false;
  if (autoMarketSuppressed(x)) return false;
  if (phase6AdaptiveSuppressed(x)) return false;
  if (!hasDistributionModel(x)) return false;
  if (!x.sportsbookMatch) return false;
  if (typeof x.sportsbookEdge !== "number") return false;
  if (x.sportsbookEdge <= 0) return false;

  const gate = finalExecutionGate(x);
  if (!gate.passed && !isAdaptiveUnblocked(x, gate)) return false;

  const grade = displayGrade(x);
  return grade === "GREEN" || grade === "NEUTRAL";
}



const blockedCandidates = [];
const leanWatchlistCandidates = [];

function hasAnyReason(reasons, names) {
  const set = new Set(names);
  return Array.isArray(reasons) && reasons.some(r => set.has(r));
}

function classifyLeanWatchlistCandidate(x) {
  const reasons = Array.isArray(x.reasons) ? x.reasons : [];
  const prob = Number(x.prob);
  const edge = Number(x.edge);
  const score = Number(x.score);
  const confidence = String(x.confidence || "").toLowerCase();
  const market = String(x.market || "").toLowerCase();
  const side = String(x.side || "").toUpperCase();

  const hardRejectReasons = [
    "weak_confidence",
    "unmodeled_confidence",
    "auto_market_suppressed",
    "phase6_adaptive_suppressed",
    "trust_suppressed",
    "validation_suppressed",
    "phase6_hardban",
    "no_distribution_model",
    "no_sportsbook_match",
    "no_edge",
    "negative_edge"
  ];

  if (hasAnyReason(reasons, hardRejectReasons)) return null;
  if (!Number.isFinite(prob) || !Number.isFinite(edge) || !Number.isFinite(score)) return null;
  if (edge <= 0) return null;

  const acceptableMissReasons = [
    "score_below_adaptive_minimum",
    "non_elite_score_below_adaptive_floor",
    "elite_score_below_adaptive_floor",
    "high_volatility_non_elite",
    "failed_market_gate",
    "goblin_prob_below_72"
  ];

  const onlyAcceptableMisses = reasons.every(r => acceptableMissReasons.includes(r));
  if (!onlyAcceptableMisses) return null;

  const isGoblinBelow72 = reasons.includes("goblin_prob_below_72");
  const isHighVol = reasons.includes("high_volatility_non_elite");
  const failedMarketGate = reasons.includes("failed_market_gate");

  const goodMarkets = new Set([
    "bases",
    "hits",
    "walks",
    "strikeouts",
    "pitching_outs",
    "hits_allowed",
    "earned_runs_allowed"
  ]);

  if (!goodMarkets.has(market)) return null;

  if (
    prob >= 0.65 &&
    edge >= 0.10 &&
    ["playable", "strong", "elite"].includes(confidence)
  ) {
    return {
      classification: isGoblinBelow72 || isHighVol || failedMarketGate ? "LEAN" : "LEAN",
      stakeGuidance: "0.25u max / optional only",
      officialEligible: false
    };
  }

  if (
    prob >= 0.58 &&
    edge >= 0.06 &&
    ["watchlist", "playable", "strong", "elite"].includes(confidence)
  ) {
    return {
      classification: "WATCHLIST",
      stakeGuidance: "track only / no official bet",
      officialEligible: false
    };
  }

  return null;
}

function maybeAddLeanWatchlistCandidate(candidate) {
  const label = classifyLeanWatchlistCandidate(candidate);
  if (!label) return;

  leanWatchlistCandidates.push({
    ...candidate,
    ...label,
    note: candidate.reasons?.includes("goblin_prob_below_72")
      ? "Strong candidate, but goblin probability is below official 72% requirement."
      : candidate.reasons?.includes("high_volatility_non_elite")
        ? "Positive edge candidate, but volatility is too high for official."
        : candidate.reasons?.includes("failed_market_gate")
          ? "Positive edge candidate, but market gate did not clear official standards."
          : "Positive edge candidate that missed official threshold."
  });
}


function getBlockReason(x) {
  if (phase6HardBanned(x)) return "phase6_hardban";
  if (trustSuppressed(x)) return "trust_suppressed";
  if (validationSuppressed(x)) return "validation_suppressed";
  if (autoMarketSuppressed(x)) return "auto_market_suppressed";
  if (phase6AdaptiveSuppressed(x)) return "phase6_adaptive_suppressed";
  const gate = finalExecutionGate(x);
  if (!gate.passed) return gate.reasons[0] || "failed_final_execution_gate";
  if (unsupportedFinalMarket(x)) return "unsupported_market";
  if (!hasDistributionModel(x)) return "no_distribution_model";
  if (!marketSpecificFinalGate(x)) return "failed_market_gate";
  if (!x.sportsbookMatch) return "no_sportsbook_match";
  if (typeof x.sportsbookEdge !== "number") return "no_edge";
  if (x.sportsbookEdge <= 0) return "negative_edge";
  return "unknown";
}


const top = priced
  .filter(x => {
    const ok = isFinalCandidate(x);
    if (!ok) {
      const rawScore = finalScore(x);
      const gate = finalExecutionGate(x);
      const audited = applyFullBoardPromotion(
        { ...x, finalScore: rawScore },
        fullBoardPromotionMap
      );

      const blockedRecord = {
        player: x.player,
        team: x.team ?? null,
        game: x.game || x.sportsbookGame || x.resolvedGame || null,
        gamePk: x.gamePk || x.resolvedGamePk || null,
        resolvedTeam: x.resolvedTeam ?? null,
        resolvedGame: x.resolvedGame ?? null,
        resolvedGamePk: x.resolvedGamePk ?? null,
        ...splitContextFields(x),
        market: x.market,
        side: x.side,
        line: x.line,
        reason: gate.reasons?.[0] || getBlockReason(x),
        reasons: gate.reasons || [],
        prob: x.calibratedDistributionProb ?? null,
        edge: x.sportsbookAdjustedEdge ?? x.adjustedEdge ?? x.edge ?? x.sportsbookEdge ?? null,
        score: rawScore,
        finalScore: rawScore,
        confidence: gate.confidence ?? null,
        confidenceScore: gate.confidenceScore ?? null,
        autoMarketAction: gate.autoMarketAction ?? null,
        volatility: gate.volatility ?? null,
        volatilityPenalty: gate.volatilityPenalty ?? null,
        thresholds: gate.adaptiveThresholds ?? null,
        adaptiveThresholds: gate.adaptiveThresholds ?? null,
        adaptiveRules: gate.adaptiveRules ?? null,
        adaptiveUnblocked: isAdaptiveUnblocked(x, gate),
        prePromotionScore: audited.prePromotionScore ?? null,
        postPromotionScore: audited.postPromotionScore ?? null,
        promotionDelta: audited.promotionDelta ?? null,
        fullBoardPromotion: audited.fullBoardPromotion ?? null,
        promotionAuditOnly: true
      };
      blockedCandidates.push(blockedRecord);
      maybeAddLeanWatchlistCandidate(blockedRecord);
    }
    return ok;
  })
  .map(x => applyFullBoardPromotion({ ...x, finalScore: finalScore(x) }, fullBoardPromotionMap))
  .sort((a, b) => b.finalScore - a.finalScore);

const finalTop = [];
for (const x of top) {
  const gate = finalExecutionGate(x);
  if (!gate.passed && !isAdaptiveUnblocked(x, gate)) {
    const audited = applyFullBoardPromotion(
      { ...x, finalScore: finalScore(x) },
      fullBoardPromotionMap
    );

    const blockedRecord = {
      player: x.player,
      team: x.team ?? null,
      game: x.game || x.sportsbookGame || x.resolvedGame || null,
      gamePk: x.gamePk || x.resolvedGamePk || null,
      resolvedTeam: x.resolvedTeam ?? null,
      resolvedGame: x.resolvedGame ?? null,
      resolvedGamePk: x.resolvedGamePk ?? null,
      ...splitContextFields(x),
      market: x.market,
      side: x.side,
      line: x.line,
      reason: gate.reasons[0] || "failed_final_execution_gate",
      reasons: gate.reasons,
      prob: x.calibratedDistributionProb ?? null,
      edge: x.sportsbookAdjustedEdge ?? x.adjustedEdge ?? x.edge ?? x.sportsbookEdge ?? null,
      score: x.finalScore ?? finalScore(x),
      finalScore: x.finalScore ?? finalScore(x),
      confidence: gate.confidence ?? null,
      confidenceScore: gate.confidenceScore ?? null,
      autoMarketAction: gate.autoMarketAction ?? null,
      volatility: gate.volatility ?? null,
      volatilityPenalty: gate.volatilityPenalty ?? null,
      thresholds: gate.adaptiveThresholds ?? null,
      adaptiveThresholds: gate.adaptiveThresholds ?? null,
      adaptiveRules: gate.adaptiveRules ?? null,
      adaptiveUnblocked: isAdaptiveUnblocked(x, gate),
      prePromotionScore: audited.prePromotionScore ?? null,
      postPromotionScore: audited.postPromotionScore ?? null,
      promotionDelta: audited.promotionDelta ?? null,
      fullBoardPromotion: audited.fullBoardPromotion ?? null,
      promotionAuditOnly: true
    };
    blockedCandidates.push(blockedRecord);
    maybeAddLeanWatchlistCandidate(blockedRecord);
    continue;
  }
  if (canAddStrict(finalTop, x)) finalTop.push(x);
}




const PORTFOLIO_EXPOSURE_LIMITS = {
  maxPlayer: 2,
  maxGame: 3,
  maxMarket: 3
};

function exposureKey(v) {
  return String(v || "").trim().toLowerCase();
}

function makeExposureState() {
  return {
    players: {},
    games: {},
    markets: {}
  };
}

function incrementExposure(state, leg) {
  const player = exposureKey(leg.player);
  const game = exposureKey(leg.game || leg.resolvedGame || leg.sportsbookGame);
  const market = exposureKey(leg.market);

  if (player) state.players[player] = (state.players[player] || 0) + 1;
  if (game) state.games[game] = (state.games[game] || 0) + 1;
  if (market) state.markets[market] = (state.markets[market] || 0) + 1;
}

function wouldViolateExposure(state, leg) {
  const violations = [];

  const player = exposureKey(leg.player);
  const game = exposureKey(leg.game || leg.resolvedGame || leg.sportsbookGame);
  const market = exposureKey(leg.market);

  if (player && (state.players[player] || 0) >= PORTFOLIO_EXPOSURE_LIMITS.maxPlayer) {
    violations.push(`player_exposure:${leg.player}`);
  }

  if (game && (state.games[game] || 0) >= PORTFOLIO_EXPOSURE_LIMITS.maxGame) {
    violations.push(`game_exposure:${leg.game || leg.resolvedGame || leg.sportsbookGame}`);
  }

  if (market && (state.markets[market] || 0) >= PORTFOLIO_EXPOSURE_LIMITS.maxMarket) {
    violations.push(`market_exposure:${leg.market}`);
  }

  return {
    violates: violations.length > 0,
    violations
  };
}

function summarizeExposure(legs) {
  const state = makeExposureState();
  for (const leg of legs || []) incrementExposure(state, leg);

  return {
    limits: PORTFOLIO_EXPOSURE_LIMITS,
    playerCounts: state.players,
    gameCounts: state.games,
    marketCounts: state.markets
  };
}

function isPitcherMarketName(market) {
  const m = String(market || "").toLowerCase();
  return (
    m.includes("pitch") ||
    m === "strikeouts" ||
    m === "hits_allowed" ||
    m === "earned_runs_allowed" ||
    m === "walks_allowed"
  );
}

function evaluateCorrelationRisk(legs) {
  const issues = [];
  const teams = {};
  const games = {};
  const hittersByTeam = {};

  for (const leg of legs || []) {
    const team = leg.team;
    const game = leg.game || leg.resolvedGame || leg.sportsbookGame;
    const market = String(leg.market || "").toLowerCase();
    const isPitcher = isPitcherMarketName(market);
    const isHitter = !isPitcher;

    if (team) teams[team] = (teams[team] || 0) + 1;
    if (game) games[game] = (games[game] || 0) + 1;
    if (isHitter && team) hittersByTeam[team] = (hittersByTeam[team] || 0) + 1;
  }

  for (const [team, count] of Object.entries(hittersByTeam)) {
    if (count >= 3) issues.push(`too_many_hitters_same_team:${team}`);
  }

  for (const [team, count] of Object.entries(teams)) {
    if (count >= 3) issues.push(`too_many_legs_same_team:${team}`);
  }

  for (const [game, count] of Object.entries(games)) {
    if (count >= 3) issues.push(`too_many_same_game:${game}`);
  }

  for (const a of legs || []) {
    for (const b of legs || []) {
      if (a === b) continue;

      const aMarket = String(a.market || "").toLowerCase();
      const bMarket = String(b.market || "").toLowerCase();

      const aIsPitcher = isPitcherMarketName(aMarket);
      const bIsPitcher = isPitcherMarketName(bMarket);

      const aIsHitter = !aIsPitcher;
      const bIsHitter = !bIsPitcher;

      const aGame = a.game || a.resolvedGame || a.sportsbookGame;
      const bGame = b.game || b.resolvedGame || b.sportsbookGame;

      if (
        aIsHitter &&
        bIsPitcher &&
        aGame &&
        bGame &&
        aGame === bGame &&
        a.team &&
        b.team &&
        a.team !== b.team
      ) {
        issues.push(`hitter_vs_opposing_pitcher:${a.player || "hitter"}:${b.player || "pitcher"}`);
      }

      if (
        bIsHitter &&
        aIsPitcher &&
        aGame &&
        bGame &&
        aGame === bGame &&
        a.team &&
        b.team &&
        a.team !== b.team
      ) {
        issues.push(`hitter_vs_opposing_pitcher:${b.player || "hitter"}:${a.player || "pitcher"}`);
      }
    }
  }

  return {
    isCorrelated: issues.length > 0,
    issues: [...new Set(issues)]
  };
}

function evaluateSlipQuality(legs) {
  const probs = (legs || []).map(x => Number(
    x.calibratedDistributionProb ??
    x.distributionProb ??
    x.prob ??
    0
  )).filter(Number.isFinite);

  const minLegProb = probs.length ? Math.min(...probs) : 0;
  const avgLegProb = probs.length
    ? probs.reduce((a, b) => a + b, 0) / probs.length
    : 0;

  const weakMarkets = (legs || []).filter(x => {
    const trust = String(
      x.marketTrust?.trust ??
      x.marketTrustTier ??
      x.marketSupportFlag ??
      ""
    ).toLowerCase();

    const score = Number(
      x.marketTrustScore ??
      x.marketTrust?.adjustmentMultiplier ??
      1
    );

    return (
      trust.includes("weak") ||
      trust.includes("suppressed") ||
      x.finalMarketSupported === false ||
      x.finalMarketGatePassed === false ||
      (Number.isFinite(score) && score < 0.5)
    );
  });

  const marketMixScore = legs.length
    ? (legs.length - weakMarkets.length) / legs.length
    : 0;

  const rejectReasons = [];
  if (legs.length > 0 && minLegProb < 0.60) rejectReasons.push("low_min_prob");
  if (legs.length > 0 && avgLegProb < 0.64) rejectReasons.push("low_avg_prob");
  if (weakMarkets.length > 0) rejectReasons.push("weak_market");

  let tier = "C";
  if (avgLegProb >= 0.68 && minLegProb >= 0.62 && weakMarkets.length === 0) {
    tier = "A";
  } else if (avgLegProb >= 0.64 && minLegProb >= 0.60 && weakMarkets.length === 0) {
    tier = "B";
  }

  return {
    minLegProb: Number(minLegProb.toFixed(4)),
    avgLegProb: Number(avgLegProb.toFixed(4)),
    marketMixScore: Number(marketMixScore.toFixed(4)),
    weakMarkets: weakMarkets.length,
    tier,
    rejectReasons,
    isRejected: rejectReasons.length > 0
  };
}

const slipDefs = [
  { name: "2-MAN POWER", size: 2 },
  { name: "3-MAN FLEX", size: 3 },
  { name: "4-MAN FLEX", size: 4 },
  { name: "5-MAN FLEX", size: 5 },
  { name: "6-MAN FLEX", size: 6 }
].filter(x => x.size <= MAX_FINAL_SLIP_SIZE);


function entryModeFromName(name) {
  return String(name || "").toUpperCase().includes("FLEX") ? "flex" : "power";
}

function safePayoutPricing(legs, mode) {
  try {
    if (!Array.isArray(legs) || legs.length < 2) return null;
    if (mode === "flex" && legs.length < 3) return null;
    return priceSlip({ legs, mode });
  } catch (err) {
    return { mode, error: err.message };
  }
}

const portfolioExposure = makeExposureState();

const slips = slipDefs.map(def => {
  const legs = [];
  const exposureViolations = [];
  const slipPool = top.filter(x => {
    const gate = finalExecutionGate(x);
    return gate.passed === true || isAdaptiveUnblocked(x, gate) || controlledUnblockV2(x, gate) || lowBookControlledUnlockV1(x, gate);
  });
  for (const x of slipPool) {
    if (legs.length >= def.size) break;
    const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? 0);
    if (edge < minEdgeForSlipSize(def.size)) continue;

    const exposureCheck = wouldViolateExposure(portfolioExposure, x);
    if (exposureCheck.violates) {
      exposureViolations.push({
        player: x.player,
        market: x.market,
        side: x.side,
        line: x.line,
        violations: exposureCheck.violations
      });
      continue;
    }

    const ok = def.size <= 4 ? canAddStrict(legs, x) : canAddBalanced(legs, x);
    if (ok) legs.push(x);
  }
  if (def.size === 6 && legs.length < 6) {
    for (const x of slipPool) {
      if (legs.length >= 6) break;
      if (legs.some(l => normName(l.player) === normName(x.player))) continue;
      if (gameKey(x) && counts(legs, x).sameGame >= 1) continue;
      if (!isFinalCandidate(x)) continue;
      legs.push(x);
    }
  }

  const quality = evaluateSlipQuality(legs);
  const correlationRisk = evaluateCorrelationRisk(legs);
  const rejectReasons = [
    ...quality.rejectReasons,
    ...(correlationRisk.isCorrelated ? ["correlation_risk"] : [])
  ];
  const rejected = quality.isRejected || correlationRisk.isCorrelated;
  const complete = legs.length === def.size && !rejected;

  const acceptedLegs = rejected ? [] : legs;
  for (const leg of acceptedLegs) incrementExposure(portfolioExposure, leg);
  const entryMode = entryModeFromName(def.name);
  const payoutPricing = complete ? safePayoutPricing(acceptedLegs, entryMode) : null;

  return {
    name: def.name,
    size: def.size,
    entryMode,
    payoutPricing,
    trueEV: payoutPricing?.ev ?? null,
    trueEVPct: payoutPricing?.evPct ?? null,
    payoutConfigKey: payoutPricing?.configKey ?? null,
    payout: payoutPricing?.payout ?? null,
    payoutMap: payoutPricing?.payoutMap ?? null,
    complete,
    rejected,
    rejectReasons,
    quality,
    correlationFlag: correlationRisk.isCorrelated,
    correlationIssues: correlationRisk.issues,
    exposure: summarizeExposure(acceptedLegs),
    exposureSkipped: exposureViolations,
    green: legs.filter(x => displayGrade(x) === "GREEN").length,
    neutral: legs.filter(x => displayGrade(x) === "NEUTRAL").length,
    watchlist: legs.filter(x => displayGrade(x) === "WATCHLIST").length,
    fade: legs.filter(x => displayGrade(x) === "FADE").length,
    correlation: correlationRisk.isCorrelated ? "RISK" : correlationLabel(legs),
    legs: acceptedLegs.map(cleanLeg)
  };
});

const evRankedSlips = [...slips].sort((a, b) => {
  const av = Number(a.trueEV ?? -999);
  const bv = Number(b.trueEV ?? -999);

  if (Number.isFinite(av) && Number.isFinite(bv) && bv !== av) {
    return bv - av;
  }

  return Number(b.complete === true) - Number(a.complete === true);
});

const output = {
  generatedAt: new Date().toISOString(),
  rankingMethod: "true_ev_desc",
  topLegs: finalTop.map(cleanLeg),
  slips: evRankedSlips
};

fs.writeFileSync("outputs/final-slips.json", JSON.stringify(output, null, 2));

const SLATE_DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

fs.writeFileSync(`outputs/final-slips-${SLATE_DATE}.json`, JSON.stringify(output, null, 2));

console.log("Wrote outputs/final-slips.json");
console.log(`Wrote outputs/final-slips-${SLATE_DATE}.json`);
console.log("Top legs:");
console.table(finalTop.slice(0, 10).map((x, i) => ({
  rank: i + 1,
  player: x.player,
  team: x.team,
  game: x.game || x.sportsbookGame || null,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: x.sportsbookEdge,
  adjEdge: x.sportsbookAdjustedEdge,
  dist: x.calibratedDistributionProb ?? null,
  score: x.finalScore,
  grade: displayGrade(x),
  books: x.sportsbookBookCount
})));

console.log("Slip correlation:");
console.table(slips.map(s => ({
  name: s.name,
  size: s.size,
  mode: s.entryMode,
  complete: s.complete,
  trueEVPct: s.trueEVPct == null ? null : Number(s.trueEVPct.toFixed(2)),
  payoutKey: s.payoutConfigKey,
  payout: s.payout,
  green: s.green,
  neutral: s.neutral,
  correlation: s.correlation
})));


fs.writeFileSync(
  "outputs/blocked-final-candidates.json",
  JSON.stringify(blockedCandidates, null, 2)
);
fs.writeFileSync(
  "outputs/lean-watchlist-candidates.json",
  JSON.stringify(leanWatchlistCandidates, null, 2)
);
console.log("Blocked candidates:", blockedCandidates.length);
console.log("Lean/watchlist candidates:", leanWatchlistCandidates.length);
