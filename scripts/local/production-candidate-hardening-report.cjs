const fs = require("fs");
const FULL_CONFIRMATION_FILE = "outputs/full-prop-confirmation/full-prop-confirmation-report-latest.json";
const EXTERNAL_CONFIRMATION_FILE = "outputs/external-confirmation/external-mlb-form-confirmation-latest.json";
const PICKFINDER_BACKFILL_FILE = "data/pickfinder/pickfinder-style-backfill-latest.json";

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const INPUTS = [
  `outputs/production-candidates-${DATE}.json`,
  "outputs/production-candidates.json",
];

const HIGH_PROB_UNLOCKS = [
  `outputs/controlled-highprob-unlocks-${DATE}.json`,
  "outputs/controlled-highprob-unlocks-latest.json",
];

const OUT_JSON = `outputs/production-candidate-hardening-${DATE}.json`;
const OUT_TXT = `outputs/production-candidate-hardening-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/production-candidate-hardening-latest.json";
const OUT_LATEST_TXT = "outputs/production-candidate-hardening-latest.txt";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function str(v) {
  return String(v ?? "").trim();
}

function normMarket(v) {
  return str(v).toLowerCase();
}

function normSide(v) {
  return str(v).toUpperCase();
}

function normTier(row) {
  return str(row.oddsTier || row.tier || row.specialTier || "standard").toLowerCase();
}

function getProb(row) {
  return num(
    row.prob ??
    row.probability ??
    row.distributionProb ??
    row.calibratedDistributionProb ??
    row.finalProbability,
    0
  );
}

function getEdge(row) {
  return num(row.edge ?? row.adjustedEdge ?? row.finalEdge, 0);
}

function getBooks(row) {
  return num(
    row.books ??
    row.bookCount ??
    row.sportsbookBookCount ??
    row.directBookCount ??
    row.bookSupportCount,
    0
  );
}

function getGrade(row) {
  return str(row.grade || row.bookGrade || row.supportGrade || "UNKNOWN").toUpperCase();
}

function getSupport(row) {
  return str(row.support || row.marketSupportFlag || row.bookSupport || row.supportStatus || "UNKNOWN").toUpperCase();
}

function getClass(row) {
  return str(row.class || row.candidateClass || row.layer || "UNKNOWN").toUpperCase();
}

function getReasons(row) {
  const raw = row.reasons || row.reason || row.disabledReason || [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw || "").split(/[|,;]/).map(s => s.trim()).filter(Boolean);
}

function getSideBiasTier(row) {
  const sb = row.sideBias;
  if (typeof sb === "string") return sb.toUpperCase();
  if (sb && typeof sb === "object") return str(sb.tier || sb.bucket || sb.label || "").toUpperCase();
  return "";
}

function getSideBiasHitRate(row) {
  const sb = row.sideBias;
  if (sb && typeof sb === "object") return num(sb.hitRate, null);
  return null;
}

function flatten(v, out = [], seen = new Set()) {
  if (!v || typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out, seen);
    return out;
  }

  const looksLikeRow =
    v.player || v.playerName || v.market || v.side || v.line || v.class || v.candidateClass;

  if (looksLikeRow) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out, seen);
  }

  return out;
}

function uniqueRows(rows) {
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const player = str(row.player || row.playerName);
    const key = [
      player.toLowerCase(),
      normMarket(row.market || row.statType),
      normSide(row.side),
      String(row.line ?? ""),
      normTier(row),
      getClass(row),
    ].join("|");

    if (!player || !row.market || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

function scoreCandidateSource(rows) {
  let okSupport = 0;
  let withBooks = 0;
  let green = 0;
  let usable = 0;

  for (const row of rows) {
    const support = getSupport(row);
    const books = getBooks(row);
    const grade = getGrade(row);

    if (support === "OK") okSupport++;
    if (books >= 2) withBooks++;
    if (grade === "GREEN") green++;
    if (row.player || row.playerName) usable++;
  }

  return {
    rows: rows.length,
    usable,
    okSupport,
    withBooks,
    green,
    score: okSupport * 5 + withBooks * 4 + green * 2 + usable * 0.01,
  };
}

function readProductionCandidates() {
  const candidates = [];

  for (const file of INPUTS) {
    const data = readJson(file);
    if (!data) continue;
    const rows = uniqueRows(flatten(data));
    if (!rows.length) continue;
    candidates.push({ file, data, rows, sourceScore: scoreCandidateSource(rows) });
  }

  if (!candidates.length) return { file: null, data: null, rows: [], sourceScore: null };

  candidates.sort((a, b) => b.sourceScore.score - a.sourceScore.score);
  return candidates[0];
}

function readHighProbUnlocks() {
  for (const file of HIGH_PROB_UNLOCKS) {
    const data = readJson(file);
    if (!data) continue;
    return { file, data };
  }
  return { file: null, data: null };
}

function isFantasy(row) {
  return normMarket(row.market).includes("fantasy");
}

function isHrrMore(row) {
  return normMarket(row.market) === "hrr" && normSide(row.side) === "MORE";
}

function isDemon(row) {
  return normTier(row) === "demon";
}

function isGoblin(row) {
  return normTier(row) === "goblin";
}

function isStandard(row) {
  return normTier(row) === "standard";
}

function isGoodLessMarket(market) {
  return new Set([
    "strikeouts",
    "earned_runs_allowed",
    "pitching_outs",
    "hits_allowed",
    "walks_allowed",
    "home_runs",
    "rbis",
    "hits",
    "runs",
    "walks",
    "bases",
  ]).has(normMarket(market));
}

function isLessControlledWatchCandidate(row, market, side, tier, prob, books, support, grade, sideBiasTier) {
  if (side !== "LESS") return false;
  if (!isGoodLessMarket(market)) return false;
  if (prob < 0.55) return false;
  if (tier === "demon") return false;
  if (isFantasy(row)) return false;
  if (normMarket(market) === "hrr") return false;
  if (sideBiasTier === "NEGATIVE") return false;

  const supportOk = support === "OK" || books >= 2;
  const gradeOk = grade === "GREEN" || grade === "NEUTRAL";
  return supportOk && gradeOk;
}

function isBadReason(reasons) {
  return reasons.some(r =>
    /blocked|research|shadow|fade|negative|weak|unknown|unpriced|fantasy|hrr_more_research|failed_market_gate/i.test(r)
  );
}


function propKeyForConfirmation(row) {
  return [
    norm(row.player || row.playerName || row.name || ""),
    String(row.team || "").toUpperCase(),
    normMarket(row.market || row.statType || row.stat || ""),
    normSide(row.side || row.direction || ""),
    String(row.line ?? row.target ?? row.threshold ?? "")
  ].join("|");
}

function loadConfirmationRows(file) {
  const data = readJson(file, null);
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.candidates)) return data.candidates;
  return [];
}


function pfStatusRank(status) {
  const s = String(status || "");
  if (s === "PF_CONFIRMED") return 4;
  if (s === "PF_WEAK") return 3;
  if (s === "PF_MISSING_LINEUP") return 2;
  if (s === "PF_NOT_CHECKED") return 1;
  return 0;
}

function mergeConfirmation(existing = {}, incoming = {}) {
  const out = { ...existing, ...incoming };
  const a = existing.pfStatus || existing.pickfinderStatus || "";
  const b = incoming.pfStatus || incoming.pickfinderStatus || "";
  out.pfStatus = pfStatusRank(b) >= pfStatusRank(a) ? b || a : a || b;
  return out;
}

function buildConfirmationMap() {
  const map = new Map();

  for (const r of loadConfirmationRows(FULL_CONFIRMATION_FILE)) {
    const key = propKeyForConfirmation(r);
    if (!key.replace(/\|/g, "")) continue;
    map.set(key, { ...(map.get(key) || {}), full: r });
  }

  for (const r of loadConfirmationRows(EXTERNAL_CONFIRMATION_FILE)) {
    const key = propKeyForConfirmation(r);
    if (!key.replace(/\|/g, "")) continue;
    map.set(key, { ...(map.get(key) || {}), external: r });
  }

  for (const r of loadConfirmationRows(PICKFINDER_BACKFILL_FILE)) {
    const key = propKeyForConfirmation(r);
    if (!key) continue;
    map.set(key, mergeConfirmation(map.get(key), {
      ...r,
      pfStatus: r.pfStatus || r.pickfinderStatus || "PF_NOT_CHECKED",
      backfill: {
        l5: r.l5 || null,
        l10: r.l10 || null,
        l15: r.l15 || null,
        season: r.season || null,
        splitHomeAway: r.splitHomeAway || null,
        vsPitcher: r.vsPitcher || null,
        source: "pickfinder_style_backfill"
      }
    }));
  }
  return map;
}

function pickfinderStatusFromConfirmation(row, confirmation = {
  const directPfStatus = confirmation.pfStatus || confirmation.pickfinderStatus;
  if (["PF_CONFIRMED", "PF_WEAK", "PF_NOT_CHECKED", "PF_MISSING_LINEUP"].includes(directPfStatus)) {
    return directPfStatus;
  }
}) {
  const full = confirmation.full || null;
  const external = confirmation.external || null;
  const blob = JSON.stringify({ full, external });

  if (/missing_lineup/i.test(blob)) return "PF_MISSING_LINEUP";

  const hasPf =
    /PF L5=|PF L10=|pickfinder_available|pfLine=|match=exact_line/i.test(blob) ||
    !!full?.pickfinder ||
    !!external?.pickfinder;

  const notChecked = /PF=not_checked|pickfinder_not_checked/i.test(blob);

  if (hasPf) {
    const weak =
      /L10=([0-4]?[0-9](?:\.\d+)?)(\s|%)/i.test(blob) ||
      /Season=([0-4]?[0-9](?:\.\d+)?)(\s|%)/i.test(blob) ||
      /vsP=([0-3]?[0-9](?:\.\d+)?)(\s|%)/i.test(blob);
    return weak ? "PF_WEAK" : "PF_CONFIRMED";
  }

  const positiveExternal =
    /l10_60_plus|l15_60_plus|season_60_plus|KEEP_SMALL_LEAN|RESEARCH_PLUS|WATCH_ONLY/i.test(blob);

  if (positiveExternal) return "PF_CONFIRMED";
  if (notChecked) return "PF_NOT_CHECKED";
  return "PF_NOT_CHECKED";
}

function confirmationSummaryFor(row, confirmation = {}) {
  const full = confirmation.full || null;
  const external = confirmation.external || null;
  return {
    fullDecision: full?.decision || null,
    externalDecision: external?.decision || null,
    externalScore: external?.score ?? null,
    pfStatus: pickfinderStatusFromConfirmation(row, confirmation)
  };
}

function applyPfConfirmationToHardenedRows(hardened, confirmationMap) {
  for (const row of hardened) {
    const confirmation = confirmationMap.get(propKeyForConfirmation(row)) || {};
    const summary = confirmationSummaryFor(row, confirmation);
    row.pfStatus = summary.pfStatus;
    row.confirmation = summary;

    row.flags = Array.isArray(row.flags) ? row.flags : [];
    if (summary.pfStatus === "PF_CONFIRMED" && !row.flags.includes("pf_confirmed")) row.flags.push("pf_confirmed");
    if (summary.pfStatus === "PF_WEAK" && !row.flags.includes("pf_weak")) row.flags.push("pf_weak");
    if (summary.pfStatus === "PF_NOT_CHECKED" && !row.flags.includes("pf_not_checked")) row.flags.push("pf_not_checked");
    if (summary.pfStatus === "PF_MISSING_LINEUP" && !row.flags.includes("pf_missing_lineup")) row.flags.push("pf_missing_lineup");
  }
  return hardened;
}


function classifyHardened(row, highProbKeys = new Set()) {
  const player = str(row.player || row.playerName);
  const market = normMarket(row.market);
  const side = normSide(row.side);
  const tier = normTier(row);
  const prob = getProb(row);
  const edge = getEdge(row);
  const books = getBooks(row);
  const grade = getGrade(row);
  const support = getSupport(row);
  const oldClass = getClass(row);
  const reasons = getReasons(row);
  const sideBiasTier = getSideBiasTier(row);
  const sideBiasHitRate = getSideBiasHitRate(row);

  const flags = [];

  const supportOk = support === "OK";
  const gradeGreen = grade === "GREEN";
  const gradeUsable = grade === "GREEN" || grade === "NEUTRAL";
  const strongSide = sideBiasTier === "STRONG_POSITIVE";
  const watchSide = sideBiasTier === "WATCH";
  const negativeSide = sideBiasTier === "NEGATIVE";
  const lowBook = books < 2;
  const unpriced = /UNPRICED|UNKNOWN|NO_BOOK|NO_LOCAL/.test(support);
  const highProbControlled =
    (
      highProbKeys.has("STANDARD_STRIKEOUTS_LESS") &&
      market === "strikeouts" &&
      side === "LESS" &&
      tier === "standard"
    ) ||
    (
      highProbKeys.has("SHADOW_HITS_MORE_HIGH_PROB") &&
      market === "hits" &&
      side === "MORE" &&
      tier === "goblin"
    );
  const lessControlledWatch = isLessControlledWatchCandidate(
    row,
    market,
    side,
    tier,
    prob,
    books,
    support,
    grade,
    sideBiasTier
  );

  if (lessControlledWatch) flags.push("less_controlled_watch_55pct_floor");
  if (isFantasy(row)) flags.push("fantasy_not_production_ready");
  if (isHrrMore(row)) flags.push("hrr_more_research_only");
  if (isDemon(row)) flags.push("demon_research_only");
  if (negativeSide) flags.push("negative_side_bias");
  if (lowBook) flags.push("books_below_2");
  if (unpriced) flags.push("unpriced_or_unknown_support");
  if (grade === "FADE") flags.push("grade_fade");
  if (oldClass === "SHADOW_BLOCKED") flags.push("shadow_blocked_original_class");
  if (oldClass === "BLOCKED") flags.push("blocked_original_class");

  let hardenedClass = "RESEARCH";
  let stake = "research only / no bet";

  if (lessControlledWatch) {
    hardenedClass = "LESS_CONTROLLED_WATCH";
    stake = "controlled LESS watch only / no official bet";
  } else if (
    highProbControlled &&
    supportOk &&
    books >= 2 &&
    gradeGreen &&
    !isFantasy(row) &&
    !isDemon(row) &&
    !isHrrMore(row)
  ) {
    hardenedClass = "CONTROLLED_WATCH";
    stake = "controlled watch only / no official bet";
    flags.push("controlled_highprob_unlock");
  } else if (
    isFantasy(row) ||
    isHrrMore(row) ||
    isDemon(row) ||
    unpriced ||
    oldClass === "SHADOW_BLOCKED"
  ) {
    hardenedClass = oldClass === "SHADOW_BLOCKED" ? "SHADOW_BLOCKED" : "RESEARCH";
  } else if (
    negativeSide ||
    grade === "FADE" ||
    lowBook ||
    isBadReason(reasons)
  ) {
    hardenedClass = "BLOCKED";
    stake = "blocked / no bet";
  } else if (
    isStandard(row) &&
    prob >= 0.67 &&
    edge >= 0.10 &&
    books >= 3 &&
    supportOk &&
    gradeGreen &&
    strongSide &&
    !isBadReason(reasons)
  ) {
    hardenedClass = "CORE";
    stake = "official candidate / 1u max only after final slate review";
  } else if (
    prob >= 0.60 &&
    edge >= 0.05 &&
    books >= 2 &&
    supportOk &&
    gradeUsable &&
    (strongSide || watchSide) &&
    !isFantasy(row) &&
    !isDemon(row) &&
    !isHrrMore(row)
  ) {
    hardenedClass = "LEAN";
    stake = "0.25u max / optional lean review only";
  } else if (
    highProbControlled ||
    (prob >= 0.55 && edge > 0 && (strongSide || watchSide))
  ) {
    hardenedClass = "WATCHLIST";
    stake = "track only / wait for confirmation";
  } else {
    hardenedClass = "RESEARCH";
  }

  return {
    player,
    team: row.team,
    market,
    side,
    line: row.line,
    tier,
    oldClass,
    hardenedClass,
    prob,
    edge,
    books,
    support,
    grade,
    sideBiasTier,
    sideBiasHitRate,
    stake,
    flags,
    reasons,
  };
}

function countBy(rows, key) {
  const out = {};
  for (const row of rows) {
    const k = typeof key === "function" ? key(row) : row[key];
    out[k || "UNKNOWN"] = (out[k || "UNKNOWN"] || 0) + 1;
  }
  return out;
}

function topRows(rows, n = 12) {
  return rows
    .slice()
    .sort((a, b) => {
      const ap = num(a.prob);
      const bp = num(b.prob);
      const ae = num(a.edge);
      const be = num(b.edge);
      return bp - ap || be - ae;
    })
    .slice(0, n);
}

function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "n/a";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

const prod = readProductionCandidates();
const highProb = readHighProbUnlocks();

const highProbKeys = new Set();
if (highProb.data && Array.isArray(highProb.data.unlocks)) {
  for (const u of highProb.data.unlocks) {
    if (u && u.key) highProbKeys.add(u.key);
  }
}

const hardened = prod.rows.map(row => classifyHardened(row, highProbKeys));
const confirmationMap = buildConfirmationMap();
applyPfConfirmationToHardenedRows(hardened, confirmationMap);

const byOldClass = countBy(hardened, "oldClass");
const byHardenedClass = countBy(hardened, "hardenedClass");
  const byPfStatus = countBy(hardened, "pfStatus");
const byMarketSide = countBy(hardened, r => `${r.market}|${r.side}`);
const byTier = countBy(hardened, "tier");

const productionCount =
  (byHardenedClass.CORE || 0) +
  (byHardenedClass.LEAN || 0) +
  (byHardenedClass.LESS_CONTROLLED_WATCH || 0) +
  (byHardenedClass.CONTROLLED_WATCH || 0) +
  (byHardenedClass.WATCHLIST || 0);

const warnings = [];
if (hardened.length > 120) warnings.push(`candidate_pool_too_large:${hardened.length}_rows`);
if (productionCount > 120) warnings.push(`production_pool_too_large:${productionCount}_rows`);
if (productionCount < 50) warnings.push(`production_pool_below_target:${productionCount}_rows`);
if ((byHardenedClass.CORE || 0) === 0) warnings.push("no_core_candidates");
if ((byHardenedClass.LEAN || 0) === 0) warnings.push("no_lean_candidates");
if ((byHardenedClass.LESS_CONTROLLED_WATCH || 0) > 0) warnings.push(`less_controlled_watch_report_only:${byHardenedClass.LESS_CONTROLLED_WATCH}_rows`);
if ((byHardenedClass.RESEARCH || 0) > 50) warnings.push("research_pool_too_large");
if ((byHardenedClass.SHADOW_BLOCKED || 0) > 50) warnings.push("shadow_blocked_pool_too_large");

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  sourceFile: prod.file,
  sourceQuality: prod.sourceScore || null,
  highProbUnlockFile: highProb.file,
  policy: {
    mode: "REPORT_ONLY",
    officialPromotion: "manual_review_required",
    slipBuilderMutation: false,
    phase: "Phase 8B - Production Filter Hardening",
    targetProductionCandidates: "50-120",
  },
  summary: {
    inputRows: prod.rows.length,
    productionPool: productionCount,
    byOldClass,
    byHardenedClass,
    byPfStatus,
    byTier,
    warnings,
  },
  byMarketSide,
  allRows: hardened,
  classes: {
    CORE: topRows(hardened.filter(r => r.hardenedClass === "CORE")),
    LEAN: topRows(hardened.filter(r => r.hardenedClass === "LEAN")),
    LESS_CONTROLLED_WATCH: topRows(hardened.filter(r => r.hardenedClass === "LESS_CONTROLLED_WATCH")),
    LESS_CONTROLLED_WATCH_PF_CONFIRMED: topRows(hardened.filter(r =>
      r.hardenedClass === "LESS_CONTROLLED_WATCH" && r.pfStatus === "PF_CONFIRMED"
    )),
    LESS_CONTROLLED_WATCH_NO_PF_CONFIRMATION: topRows(hardened.filter(r =>
      r.hardenedClass === "LESS_CONTROLLED_WATCH" && r.pfStatus !== "PF_CONFIRMED"
    )),
    CONTROLLED_WATCH: topRows(hardened.filter(r => r.hardenedClass === "CONTROLLED_WATCH")),
    CONTROLLED_WATCH_PF_CONFIRMED: topRows(hardened.filter(r =>
      r.hardenedClass === "CONTROLLED_WATCH" && r.pfStatus === "PF_CONFIRMED"
    )),
    CONTROLLED_WATCH_NO_PF_CONFIRMATION: topRows(hardened.filter(r =>
      r.hardenedClass === "CONTROLLED_WATCH" && r.pfStatus !== "PF_CONFIRMED"
    )),
    WATCHLIST: topRows(hardened.filter(r => r.hardenedClass === "WATCHLIST")),
    RESEARCH: topRows(hardened.filter(r => r.hardenedClass === "RESEARCH")),
    BLOCKED: topRows(hardened.filter(r => r.hardenedClass === "BLOCKED")),
    SHADOW_BLOCKED: topRows(hardened.filter(r => r.hardenedClass === "SHADOW_BLOCKED")),
  },
  rows: hardened,
};

const lines = [];
lines.push("PRODUCTION CANDIDATE HARDENING REPORT V1");
lines.push("=========================================");
lines.push(`date=${DATE}`);
lines.push(`mode=REPORT_ONLY`);
lines.push(`source=${prod.file || "missing"}`);
lines.push(`sourceQuality=${JSON.stringify(prod.sourceScore || {})}`);
lines.push(`highProbUnlocks=${highProb.file || "missing"}`);
lines.push("");
lines.push("SUMMARY");
lines.push("-------");
lines.push(`inputRows=${report.summary.inputRows}`);
lines.push(`productionPool=${report.summary.productionPool}`);
lines.push(`targetProductionCandidates=50-120`);
lines.push(`oldClasses=${JSON.stringify(byOldClass)}`);
lines.push(`hardenedClasses=${JSON.stringify(byHardenedClass)}`);
lines.push(`pfStatus=${JSON.stringify(byPfStatus)}`);
lines.push(`tiers=${JSON.stringify(byTier)}`);
lines.push(`warnings=${warnings.length ? warnings.join(",") : "none"}`);
lines.push("");

for (const cls of [
  "CORE",
  "LEAN",
  "LESS_CONTROLLED_WATCH",
  "LESS_CONTROLLED_WATCH_PF_CONFIRMED",
  "LESS_CONTROLLED_WATCH_NO_PF_CONFIRMATION",
  "CONTROLLED_WATCH",
  "CONTROLLED_WATCH_PF_CONFIRMED",
  "CONTROLLED_WATCH_NO_PF_CONFIRMATION",
  "WATCHLIST",
  "RESEARCH",
  "BLOCKED",
  "SHADOW_BLOCKED"
]) {
  const rows = report.classes[cls] || [];
  lines.push(cls);
  lines.push("-".repeat(cls.length));
  if (!rows.length) {
    lines.push("none");
    lines.push("");
    continue;
  }

  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.player} | ${r.team || "?"} | ${r.market} ${r.side} ${r.line} | ${r.tier}`);
    lines.push(`   oldClass=${r.oldClass} | prob=${pct(r.prob)} | edge=${r.edge.toFixed ? r.edge.toFixed(4) : r.edge} | books=${r.books} | support=${r.support} | grade=${r.grade} | sideBias=${r.sideBiasTier || "UNKNOWN"}`);
    lines.push(`   stake=${r.stake}`);
    lines.push(`   flags=${r.flags.length ? r.flags.join(",") : "none"}`);
    lines.push(`   reasons=${r.reasons.length ? r.reasons.join(",") : "none"}`);
  });
  lines.push("");
}

writeJson(OUT_JSON, report);
writeJson(OUT_LATEST_JSON, report);
writeText(OUT_TXT, lines.join("\n"));
writeText(OUT_LATEST_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
