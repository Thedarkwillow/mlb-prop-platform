const fs = require("fs");

function readJsonSafe(path, fallback = {}) {
  try { return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback; }
  catch { return fallback; }
}

const EXPOSURE_GOVERNOR = readJsonSafe("data/learning/phase6-exposure-governor.json", {});
const MAX_FINAL_SLIP_SIZE = Number(EXPOSURE_GOVERNOR.governor?.maxSlipSize || EXPOSURE_GOVERNOR.maxSlipSize || 6);
const { scoreEliteContext } = require("./elite-context-score.cjs");
const { marketModelScore } = require("./market-model-router.cjs");

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

function isCheapHrrHalf(x) {
  const market = String(x.market || x.stat || "").toLowerCase();
  return market === "hrr" && Number(x.line) === 0.5;
}

function cheapHrrHalfCount(legs) {
  return legs.filter(isCheapHrrHalf).length;
}

function marketFamily(x) {
  const m = String(x.market || x.stat || "").toLowerCase();
  if (["hits", "bases", "hrr", "runs", "rbis", "home_runs"].includes(m)) return "hitter_counting";
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
  if (size <= 2) return 0.18;
  if (size === 3) return 0.15;
  if (size === 4) return 0.12;
  return 0.10;
}

function finalScore(x) {
  const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? -999);
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
    edge: x.sportsbookEdge,
    adjustedEdge: x.sportsbookAdjustedEdge,
    finalScore: x.finalScore,
    distributionProb: x.distributionProb ?? null,
    calibratedDistributionProb: x.calibratedDistributionProb ?? null,
    distributionConfidence: x.distributionModel?.confidence || null,
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
    marketSupportFlag: x.marketSupportFlag || null
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
  if (fam === "pitcher_k" && c.sameFamily >= 1) return false;
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

function isFinalCandidate(x) {
  if (trustSuppressed(x)) return false;
  if (validationSuppressed(x)) return false;
  if (!hasDistributionModel(x)) return false;
  if (!x.sportsbookMatch) return false;
  if (typeof x.sportsbookEdge !== "number") return false;
  if (x.sportsbookEdge <= 0) return false;

  const grade = displayGrade(x);
  return grade === "GREEN" || grade === "NEUTRAL";
}


const top = priced
  .filter(isFinalCandidate)
  .map(x => ({ ...x, finalScore: finalScore(x) }))
  .sort((a, b) => b.finalScore - a.finalScore);

const finalTop = [];
for (const x of top) {
  if (canAddStrict(finalTop, x)) finalTop.push(x);
}

const slipDefs = [
  { name: "2-MAN POWER", size: 2 },
  { name: "3-MAN FLEX", size: 3 },
  { name: "4-MAN FLEX", size: 4 },
  { name: "5-MAN FLEX", size: 5 },
  { name: "6-MAN FLEX", size: 6 }
].filter(x => x.size <= MAX_FINAL_SLIP_SIZE);

const slips = slipDefs.map(def => {
  const legs = [];
  for (const x of top) {
    if (legs.length >= def.size) break;
    const edge = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? 0);
    if (edge < minEdgeForSlipSize(def.size)) continue;
    const ok = def.size <= 4 ? canAddStrict(legs, x) : canAddBalanced(legs, x);
    if (ok) legs.push(x);
  }
  if (def.size === 6 && legs.length < 6) {
    for (const x of top) {
      if (legs.length >= 6) break;
      if (legs.some(l => normName(l.player) === normName(x.player))) continue;
      if (gameKey(x) && counts(legs, x).sameGame >= 1) continue;
      if (!isFinalCandidate(x)) continue;
      legs.push(x);
    }
  }

  return {
    name: def.name,
    size: def.size,
    complete: legs.length === def.size,
    green: legs.filter(x => displayGrade(x) === "GREEN").length,
    neutral: legs.filter(x => displayGrade(x) === "NEUTRAL").length,
    watchlist: legs.filter(x => displayGrade(x) === "WATCHLIST").length,
    fade: legs.filter(x => displayGrade(x) === "FADE").length,
    correlation: correlationLabel(legs),
    legs: legs.map(cleanLeg)
  };
});

const output = {
  generatedAt: new Date().toISOString(),
  topLegs: finalTop.map(cleanLeg),
  slips
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
  complete: s.complete,
  green: s.green,
  neutral: s.neutral,
  correlation: s.correlation
})));
