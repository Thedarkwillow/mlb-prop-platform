const fs = require("fs");
const path = require("path");

const OUT = "outputs/production-candidates.json";
const OUT_TXT = "outputs/production-candidates.txt";

const SOURCES = {
  enriched: "outputs/slips-distribution-enriched.json",
  leans: "outputs/lean-final-slips.json",
  blocked: "outputs/blocked-final-candidates.json",
  final: "outputs/final-slips.json",
  playable: "outputs/playable-final-slips.json",
  shadowPromotion: "outputs/shadow-promotion-audit-latest.json",
  fantasyReadiness: "outputs/fantasy-readiness-report.json",
  fullBoardLearning: "data/learning/full-board-market-learning.json",
  sportsbookBoard: "outputs/sportsbook-enriched-board.json",
  phase8Audit: "outputs/phase8-candidate-audit.json"
};

function detectSlateDate() {
  const explicit =
    process.env.SLATE_DATE ||
    process.env.npm_config_date ||
    process.argv[2] ||
    "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  const finalRows = readJson(SOURCES.final, []);
  const rows = Array.isArray(finalRows) ? finalRows : [];
  for (const row of rows) {
    const raw = row.startTime || row.gameTime || row.board_time || row.updated_at;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d);
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
const SLATE_DATE = detectSlateDate();
const OUT_DATED = `outputs/production-candidates-${SLATE_DATE}.json`;
const OUT_TXT_DATED = `outputs/production-candidates-${SLATE_DATE}.txt`;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return norm(v).toLowerCase();
}

function upper(v) {
  return norm(v).toUpperCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function key(row) {
  return [
    norm(row.player),
    lower(row.market),
    upper(row.side),
    String(row.line ?? "")
  ].join("|");
}

function marketSideKey(row) {
  return `${lower(row.market)} ${upper(row.side)}`.trim();
}

function getProb(row) {
  return num(
    row.prob ??
    row.calibratedDistributionProb ??
    row.contextAdjustedDistributionProb ??
    row.recommendedProb ??
    row.pickProb,
    null
  );
}

function getEdge(row) {
  return num(
    row.edge ??
    row.sportsbookAdjustedEdge ??
    row.adjustedEdge ??
    row.sportsbookEdge ??
    row.expectedValue,
    null
  );
}

function getBooks(row) {
  return num(row.books ?? row.sportsbookBookCount ?? row.bookCount, null);
}

function getSupport(row) {
  return norm(row.support ?? row.marketSupportFlag ?? row.priceCoverageTier ?? "");
}
function isPhase8Unpriced(row) {
  return row.source === "phase8_audit" || getSupport(row) === "PHASE8_UNPRICED";
}

function getGrade(row) {
  return upper(row.grade ?? row.qualityGrade ?? row.savantReportGrade ?? "");
}

function getTier(row) {
  return lower(row.oddsTier ?? row.specialTier ?? row.tier ?? "standard") || "standard";
}

function isFantasy(row) {
  return lower(row.market).includes("fantasy");
}

function isLiveMicro(row) {
  return Boolean(row.inningWindow || row.durationName || row.sourceType === "live_micro");
}

function getSideBias(row, fullBoardByMarketSide) {
  const rec = fullBoardByMarketSide?.[marketSideKey(row)] || null;
  if (!rec) return null;

  const count = num(rec.count ?? rec.graded, 0);
  const hitRate = num(rec.hitRate, null);
  const roi = num(rec.roi, null);

  let tier = "UNKNOWN";
  if (count >= 100 && roi !== null && roi >= 0.15 && hitRate !== null && hitRate >= 0.57) tier = "STRONG_POSITIVE";
  else if (count >= 100 && roi !== null && roi >= 0.05) tier = "POSITIVE";
  else if (count >= 100 && roi !== null && roi <= -0.05) tier = "NEGATIVE";
  else if (count >= 100 && roi !== null && roi <= -0.15) tier = "STRONG_NEGATIVE";
  else if (count > 0) tier = "WATCH";

  return {
    key: marketSideKey(row),
    count,
    hitRate,
    roi,
    tier
  };
}

function lineBucket(row) {
  const line = num(row.line, null);
  if (line === null) return "unknown";
  if (line < 0.5) return "<0.5";
  if (line === 0.5) return "0.5";
  if (line <= 1.5) return "1-1.5";
  if (line <= 3.5) return "2-3.5";
  if (line <= 5.5) return "4-5.5";
  return "6+";
}

function probBucket(row) {
  const p = getProb(row);
  if (p === null) return "unknown";
  if (p < 0.5) return "<50";
  if (p < 0.55) return "50-55";
  if (p < 0.60) return "55-60";
  if (p < 0.65) return "60-65";
  if (p < 0.70) return "65-70";
  if (p < 0.72) return "70-72";
  return "72+";
}

function hasLowBookSupport(row) {
  const books = getBooks(row);
  const support = getSupport(row);
  return support.includes("LOW") || books === 1 || books === 0;
}

function hasNegativeSideBias(row, fullBoardByMarketSide) {
  const sideBias = getSideBias(row, fullBoardByMarketSide);
  return sideBias?.tier === "NEGATIVE" || sideBias?.tier === "STRONG_NEGATIVE";
}

function isWeakHistoricalBucket(row) {
  const market = lower(row.market);
  const side = upper(row.side);
  const p = getProb(row);
  const tier = getTier(row);

  if (p !== null && p >= 0.60 && p < 0.65) return true;
  if (market === "bases" && side === "MORE") return true;
  if (tier === "goblin" && p !== null && p < 0.72) return true;

  return false;
}

function coreThresholdsClear(row, fullBoardByMarketSide) {
  const prob = getProb(row);
  const edge = getEdge(row);
  const books = getBooks(row);
  const support = getSupport(row);
  const grade = getGrade(row);
  const tier = getTier(row);
  const market = lower(row.market);
  const side = upper(row.side);
  const sideBias = getSideBias(row, fullBoardByMarketSide);

  if (grade !== "GREEN") return { ok: false, reason: "core_requires_green_grade" };
  if (support !== "OK") return { ok: false, reason: "core_requires_ok_support" };
  if (books === null || books < 2) return { ok: false, reason: "core_requires_2plus_books" };
  if (edge === null || edge < 0.08) return { ok: false, reason: "core_requires_8pct_edge" };
  if (prob === null) return { ok: false, reason: "core_missing_probability" };
  if (hasNegativeSideBias(row, fullBoardByMarketSide)) return { ok: false, reason: "core_blocks_negative_side_bias" };
  if (sideBias?.tier === "WATCH") return { ok: false, reason: "core_blocks_watch_side_bias" };
  if (market === "hrr" && side === "MORE") return { ok: false, reason: "core_blocks_hrr_more" };
  if (isFantasy(row)) return { ok: false, reason: "core_blocks_fantasy" };
  if (isLiveMicro(row)) return { ok: false, reason: "core_blocks_live_micro" };

  if (tier === "goblin" && prob < 0.72) return { ok: false, reason: "core_goblin_requires_72pct" };
  if (tier !== "goblin" && prob < 0.66) return { ok: false, reason: "core_standard_requires_66pct" };

  if (market === "bases" && side === "MORE") {
    if (tier === "goblin") {
      if (prob < 0.74 || edge < 0.12 || sideBias?.tier !== "STRONG_POSITIVE") {
        return { ok: false, reason: "core_bases_more_goblin_requires_74pct_12edge_strong_bias" };
      }
    } else {
      if (prob < 0.70 || edge < 0.12 || sideBias?.tier !== "STRONG_POSITIVE") {
        return { ok: false, reason: "core_bases_more_standard_requires_70pct_12edge_strong_bias" };
      }
    }
  }

  return { ok: true, reason: "core_thresholds_clear" };
}

function leanThresholdsClear(row, fullBoardByMarketSide) {
  const prob = getProb(row);
  const edge = getEdge(row);
  const books = getBooks(row);
  const support = getSupport(row);
  const grade = getGrade(row);
  const tier = getTier(row);

  if (edge === null || edge <= 0) return { ok: false, reason: "lean_requires_positive_edge" };
  if (prob === null || prob < 0.60) return { ok: false, reason: "lean_requires_60pct_probability" };
  if (grade === "FADE") return { ok: false, reason: "lean_blocks_fade_grade" };
  if (hasNegativeSideBias(row, fullBoardByMarketSide)) return { ok: false, reason: "lean_blocks_negative_side_bias" };
  if (support !== "OK") return { ok: false, reason: "lean_requires_ok_support" };
  if (books === null || books < 2) return { ok: false, reason: "lean_requires_2plus_books" };
  if (tier === "goblin" && prob < 0.72) return { ok: false, reason: "lean_goblin_requires_72pct" };

  return { ok: true, reason: "lean_thresholds_clear" };
}

function edgeBucket(row) {
  const e = getEdge(row);
  if (e === null) return "unknown";
  if (e < 0) return "<0";
  if (e < 0.03) return "0-3";
  if (e < 0.06) return "3-6";
  if (e < 0.10) return "6-10";
  return "10+";
}

function summarize(rows, fieldFn) {
  const m = new Map();
  for (const r of rows) {
    const k = fieldFn(r) || "unknown";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count || String(a.bucket).localeCompare(String(b.bucket)));
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") {
    for (const k of ["candidates", "rows", "all"]) {
      if (Array.isArray(v[k])) return v[k];
    }
  }
  return [];
}
function isPhase8Importable(row) {
  if (!row || typeof row !== "object") return false;
  if (!row.player || !row.market || !row.side) return false;
  if (row.line === undefined || row.line === null) return false;
  if (row.comboProp === true || row.contextEligible === false) return false;
  if (isLiveMicro(row)) return false;

  const prob = getProb(row);
  const edge = getEdge(row);
  if (prob === null || edge === null) return false;
  if (prob < 0.50 || edge <= 0) return false;

  const market = lower(row.market);
  const side = upper(row.side);

  // Keep Phase 8 broad enough for discovery, but prevent unsupported/noisy markets
  // from flooding the production report.
  const allowedMarkets = new Set([
    "bases",
    "hits",
    "hrr",
    "runs",
    "rbis",
    "singles",
    "doubles",
    "walks",
    "stolen_bases",
    "hitter_fantasy_score",
    "strikeouts",
    "pitching_outs",
    "pitches_thrown",
    "hits_allowed",
    "earned_runs_allowed",
    "walks_allowed"
  ]);
  if (!allowedMarkets.has(market)) return false;

  // HRR MORE is research-only and should not dominate the production candidate report.
  // Keep only the very strongest HRR MORE rows for tracking.
  if (market === "hrr" && side === "MORE") {
    if (prob < 0.80 || edge < 0.70) return false;
  }

  // Low-line fantasy is still provisional; keep only strongest research rows.
  if (market === "hitter_fantasy_score") {
    if (prob < 0.70 || edge < 0.35) return false;
  }

  // Goblins/demons remain MORE-only by platform rule.
  const tier = getTier(row);
  if ((tier === "goblin" || tier === "demon") && side !== "MORE") return false;

  return true;
}
function normalizePhase8Row(row) {
  return {
    ...row,
    source: row.source || "PHASE8_CANDIDATE_AUDIT",
    phase8Imported: true,
    prob: getProb(row),
    edge: getEdge(row),
    support: row.support || row.marketSupportFlag || "PHASE8_UNPRICED",
    grade: row.grade || row.qualityGrade || row.savantReportGrade || "UNKNOWN",
    books: getBooks(row),
    reason: row.reason || row.phase8Status || null,
    phase8Status: row.phase8Status || null,
    phase8Problems: Array.isArray(row.phase8Problems) ? row.phase8Problems : [],
    preferredSignals: Array.isArray(row.preferredSignals) ? row.preferredSignals : [],
    avoidSignals: Array.isArray(row.avoidSignals) ? row.avoidSignals : []
  };
}

function cleanRow(row, classification, reasons, fullBoardByMarketSide) {
  const sideBias = getSideBias(row, fullBoardByMarketSide);
  const stakeGuidance =
    classification === "CORE" ? "official candidate / 1u max only after final slate review" :
    classification === "LEAN" ? "0.25u max / optional only" :
    classification === "WATCHLIST" ? "track only / wait for stronger confirmation" :
    classification === "HIGH_PROBABILITY_WATCH" ? "track only / conflicting signal" :
    classification === "RESEARCH" ? "research only / no bet" :
    "blocked / no bet";

  return {
    class: classification,
    stakeGuidance,
    reasons,
    player: row.player ?? null,
    team: row.team ?? row.resolvedTeam ?? null,
    game: row.game ?? row.resolvedGame ?? null,
    market: row.market ?? null,
    side: row.side ?? null,
    line: row.line ?? null,
    oddsTier: getTier(row),
    prob: getProb(row),
    edge: getEdge(row),
    books: getBooks(row),
    support: getSupport(row) || null,
    grade: getGrade(row) || null,
    sideBias,
    lineBucket: lineBucket(row),
    probBucket: probBucket(row),
    edgeBucket: edgeBucket(row),
    projection: row.projection ?? null,
    contextAdjustedProjection: row.contextAdjustedProjection ?? null,
    contextAdjustedReady: row.contextAdjustedReady ?? null,
    pitchTypeMatchupReady: row.pitchTypeMatchupReady ?? null,
    pitchTypeMatchupAvailable: row.pitchTypeMatchupAvailable ?? null,
    pitchTypeMatchupScored: row.pitchTypeMatchupScored ?? null,
    pitchTypeMatchupTier: row.pitchTypeMatchupTier ?? null,
    pitchTypeMatchupScore: row.pitchTypeMatchupScore ?? null,
    pitchTypeMatchupSource: row.pitchTypeMatchupSource ?? null,
    pitchTypeNeutralFallback: row.pitchTypeNeutralFallback ?? null,
    pitchTypeContextImpactApplied: row.pitchTypeContextImpactApplied ?? null,
    source: row.source ?? row.sourceFile ?? null,
    leanStatus: row.leanStatus ?? null,
    leanNotes: row.leanNotes ?? null,
    blockedReason: row.reason ?? row.disabledReason ?? null,
    phase8Imported: row.phase8Imported === true,
    phase8Status: row.phase8Status ?? null,
    phase8Problems: Array.isArray(row.phase8Problems) ? row.phase8Problems : [],
    preferredSignals: Array.isArray(row.preferredSignals) ? row.preferredSignals : [],
    avoidSignals: Array.isArray(row.avoidSignals) ? row.avoidSignals : []
  };
}


function isControlledHrrLess(row) {
  const market = lower(row.market);
  const side = upper(row.side);
  const tier = getTier(row);
  const prob = getProb(row);
  const edge = getEdge(row);
  const books = getBooks(row);
  const support = getSupport(row);
  const grade = getGrade(row);

  return (
    market === "hrr" &&
    side === "LESS" &&
    tier === "standard" &&
    prob !== null &&
    prob >= 0.60 &&
    edge !== null &&
    edge >= 0.05 &&
    books !== null &&
    books >= 2 &&
    support === "OK" &&
    grade !== "FADE"
  );
}

function classify(row, lookups) {
  const prob = getProb(row);
  const edge = getEdge(row);
  const books = getBooks(row);
  const support = getSupport(row);
  const grade = getGrade(row);
  const tier = getTier(row);
  const market = lower(row.market);
  const side = upper(row.side);
  const sideBias = getSideBias(row, lookups.fullBoardByMarketSide);
  const reasons = [];
  const lean = lookups.leanByKey.get(key(row));
  const blocked = lookups.blockedByKey.get(key(row));

  if (!row.player || !market || !side || row.line === undefined || row.line === null) {
    return { classification: "BLOCKED", reasons: ["missing_required_fields"] };
  }

  if (isLiveMicro(row)) {
    return { classification: "RESEARCH", reasons: ["live_micro_tracking_only"] };
  }

  if (market === "hrr" && side === "MORE") {
    return {
      classification: "RESEARCH",
      reasons: ["hrr_more_research_only_until_tighter_rules_clear"]
    };
  }

  if (isControlledHrrLess(row)) {
    return {
      classification: "WATCHLIST",
      reasons: [
        "HRR_CONTROLLED_WATCHLIST",
        "standard_hrr_less_only",
        "not_official_core",
        "track_3_to_5_slates_before_unlock"
      ]
    };
  }

  if (market === "hrr") {
    return {
      classification: "RESEARCH",
      reasons: ["hrr_tracking_only_until_controlled_thresholds_clear"]
    };
  }

  if (isFantasy(row)) {
    const isLowLineHitterMore =
      market === "hitter_fantasy_score" &&
      side === "MORE" &&
      num(row.line, 999) < 3 &&
      ["standard", "goblin"].includes(tier);

    if (isLowLineHitterMore) {
      return { classification: "RESEARCH", reasons: ["fantasy_provisional_low_line_hitter_more"] };
    }

    return {
      classification: "RESEARCH",
      reasons: ["fantasy_research_only_until_component_validation_clears"]
    };
  }

  if (edge !== null && edge < 0) {
    return { classification: "BLOCKED", reasons: ["negative_edge"] };
  }

  if (grade === "FADE") {
    reasons.push("grade_fade");
    if (prob !== null && prob >= 0.65) reasons.push("high_probability_conflict");
    if (sideBias?.tier === "NEGATIVE" || sideBias?.tier === "STRONG_NEGATIVE") reasons.push("negative_side_bias");
    if (blocked?.reason) reasons.push(`blocked:${blocked.reason}`);
    return { classification: "BLOCKED", reasons };
  }

  if (sideBias?.tier === "NEGATIVE" || sideBias?.tier === "STRONG_NEGATIVE") {
    reasons.push("negative_side_bias");
    if (prob !== null && prob >= 0.65) reasons.push("high_probability_conflict");
    if (blocked?.reason) reasons.push(`blocked:${blocked.reason}`);
    if (isPhase8Unpriced(row)) {
      reasons.push("phase8_unpriced_shadow_blocked");
      return { classification: "SHADOW_BLOCKED", reasons };
    }
    return { classification: "BLOCKED", reasons };
  }

  if (hasLowBookSupport(row)) {
    reasons.push("low_book_support");
    if (prob !== null && prob >= 0.70) reasons.push("high_probability_but_low_support");
    if (sideBias?.tier === "STRONG_POSITIVE" && edge !== null && edge >= 0.05) {
      reasons.push("strong_positive_side_bias");
      return { classification: "WATCHLIST", reasons };
    }
    return { classification: "BLOCKED", reasons };
  }

  if (blocked) {
    const reason = blocked.reason || blocked.disabledReason || "blocked_candidate";
    const leanGate = leanThresholdsClear(row, lookups.fullBoardByMarketSide);

    if (leanGate.ok) {
      return {
        classification: "LEAN",
        reasons: [
          `blocked_but_lean_review:${reason}`,
          leanGate.reason,
          "not_official_core"
        ]
      };
    }

    if (
      ["weak_confidence", "score_below_adaptive_minimum", "elite_score_below_adaptive_floor"].includes(reason) &&
      sideBias?.tier === "STRONG_POSITIVE" &&
      edge !== null &&
      edge >= 0.05
    ) {
      return {
        classification: "WATCHLIST",
        reasons: [
          `blocked_but_watch:${reason}`,
          "strong_positive_side_bias",
          leanGate.reason
        ]
      };
    }

    return { classification: "BLOCKED", reasons: [`blocked:${reason}`, leanGate.reason] };
  }

  const coreGate = coreThresholdsClear(row, lookups.fullBoardByMarketSide);
  if (coreGate.ok) {
    return { classification: "CORE", reasons: [coreGate.reason] };
  }

  const leanGate = leanThresholdsClear(row, lookups.fullBoardByMarketSide);
  if (lean || leanGate.ok) {
    reasons.push(lean ? "actionable_lean_source" : leanGate.reason);
    if (lean?.leanNotes?.length) reasons.push(...lean.leanNotes);
    reasons.push(coreGate.reason);
    return { classification: "LEAN", reasons };
  }

  if (isWeakHistoricalBucket(row)) {
    return {
      classification: "WATCHLIST",
      reasons: [
        "weak_historical_bucket",
        coreGate.reason,
        leanGate.reason
      ]
    };
  }

  if (edge !== null && edge > 0 && sideBias?.tier === "STRONG_POSITIVE") {
    return {
      classification: "WATCHLIST",
      reasons: [
        "positive_edge_strong_side_bias",
        coreGate.reason,
        leanGate.reason
      ]
    };
  }

  return {
    classification: "RESEARCH",
    reasons: [
      "needs_more_validation",
      coreGate.reason,
      leanGate.reason
    ]
  };
}
const enriched = readJson(SOURCES.enriched, []);
const leanReport = readJson(SOURCES.leans, {});
const blockedRaw = readJson(SOURCES.blocked, []);
const sportsbookBoard = readJson(SOURCES.sportsbookBoard, []);
const phase8Audit = readJson(SOURCES.phase8Audit, {});
const playable = readJson(SOURCES.playable, []);
const shadowPromotion = readJson(SOURCES.shadowPromotion, {});
const fantasyReadiness = readJson(SOURCES.fantasyReadiness, {});
const fullBoardLearning = readJson(SOURCES.fullBoardLearning, {});
const fullBoardByMarketSide = fullBoardLearning.byMarketSide || {};

const leans = Array.isArray(leanReport.leans) ? leanReport.leans : [];
const leanByKey = new Map(leans.map(r => [key(r), r]));
const blockedByKey = new Map(Array.isArray(blockedRaw) ? blockedRaw.map(r => [key(r), r]) : []);

const baseRows = [];
const seen = new Set();

for (const row of Array.isArray(enriched) ? enriched : []) {
  const k = key(row);
  seen.add(k);
  baseRows.push(row);
}

for (const row of leans) {
  const k = key(row);
  if (!seen.has(k)) {
    seen.add(k);
    baseRows.push(row);
  }
}

for (const row of Array.isArray(blockedRaw) ? blockedRaw : []) {
  const k = key(row);
  if (!seen.has(k)) {
    seen.add(k);
    baseRows.push(row);
  }
}
const phase8Rows = asArray(phase8Audit)
  .filter(isPhase8Importable)
  .sort((a, b) =>
    (getProb(b) ?? -999) - (getProb(a) ?? -999) ||
    (getEdge(b) ?? -999) - (getEdge(a) ?? -999)
  )
  .slice(0, 120);

for (const row of phase8Rows) {
  const normalized = normalizePhase8Row(row);
  const k = key(normalized);
  if (!seen.has(k)) {
    seen.add(k);
    baseRows.push(normalized);
  }
}

for (const row of Array.isArray(sportsbookBoard) ? sportsbookBoard : []) {
  const market = lower(row.market);
  const side = upper(row.side);
  const prob = getProb(row);
  const edge = getEdge(row);
  const books = getBooks(row);

  // Only import actionable/priced HRR rows from the sportsbook board.
  // Raw alternate HRR rows often have blank side/prob/books and should not flood
  // the production report as missing_required_fields.
  if (market !== "hrr") continue;

  // HRR MORE is globally blocked and should not flood the production report.
  // Only import priced HRR LESS candidates for controlled watchlist evaluation.
  if (side !== "LESS") continue;

  if (prob === null || edge === null || books === null) continue;

  const k = key(row);
  if (!seen.has(k)) {
    seen.add(k);
    baseRows.push(row);
  }
}

const lookups = {
  leanByKey,
  blockedByKey,
  fullBoardByMarketSide
};

const classified = baseRows.map(row => {
  const c = classify(row, lookups);
  return cleanRow(row, c.classification, c.reasons, fullBoardByMarketSide);
});

const classOrder = {
  CORE: 0,
  LEAN: 1,
  WATCHLIST: 2,
  HIGH_PROBABILITY_WATCH: 3,
  RESEARCH: 4,
  SHADOW_BLOCKED: 5,
  BLOCKED: 6
};

classified.sort((a, b) =>
  (classOrder[a.class] ?? 99) - (classOrder[b.class] ?? 99) ||
  (b.prob ?? -999) - (a.prob ?? -999) ||
  (b.edge ?? -999) - (a.edge ?? -999)
);

const byClass = {
  CORE: classified.filter(r => r.class === "CORE"),
  LEAN: classified.filter(r => r.class === "LEAN"),
  WATCHLIST: classified.filter(r => r.class === "WATCHLIST"),
  HIGH_PROBABILITY_WATCH: classified.filter(r => r.class === "HIGH_PROBABILITY_WATCH"),
  RESEARCH: classified.filter(r => r.class === "RESEARCH"),
  SHADOW_BLOCKED: classified.filter(r => r.class === "SHADOW_BLOCKED"),
  BLOCKED: classified.filter(r => r.class === "BLOCKED")
};

const report = {
  generatedAt: new Date().toISOString(),
  slateDate: SLATE_DATE,
  sources: SOURCES,
  counts: {
    total: classified.length,
    core: byClass.CORE.length,
    lean: byClass.LEAN.length,
    watchlist: byClass.WATCHLIST.length,
    highProbabilityWatch: byClass.HIGH_PROBABILITY_WATCH.length,
    research: byClass.RESEARCH.length,
    shadowBlocked: byClass.SHADOW_BLOCKED.length,
    blocked: byClass.BLOCKED.length,
    playableOfficialSlips: Array.isArray(playable) ? playable.length : 0
  },
  sourceCounts: {
    enriched: Array.isArray(enriched) ? enriched.length : 0,
    leans: leans.length,
    blocked: Array.isArray(blockedRaw) ? blockedRaw.length : 0,
    sportsbookBoard: Array.isArray(sportsbookBoard) ? sportsbookBoard.length : 0,
    phase8Raw: asArray(phase8Audit).length,
    phase8Imported: phase8Rows.length
  },
  summaries: {
    byClass: summarize(classified, r => r.class),
    byMarket: summarize(classified, r => r.market),
    byMarketSide: summarize(classified, r => `${r.market} ${r.side}`),
    byTier: summarize(classified, r => r.oddsTier),
    byLineBucket: summarize(classified, r => r.lineBucket),
    byProbBucket: summarize(classified, r => r.probBucket),
    byEdgeBucket: summarize(classified, r => r.edgeBucket),
    byReason: summarize(classified.flatMap(r => r.reasons.map(reason => ({ reason }))), r => r.reason)
  },
  productionTarget: {
    desiredCandidateRange: "50-120",
    currentNonBlocked: byClass.CORE.length + byClass.LEAN.length + byClass.WATCHLIST.length + byClass.HIGH_PROBABILITY_WATCH.length + byClass.RESEARCH.length,
    note: "Report-only. Do not enforce until 3-5 slates validate classes."
  },
  shadowPromotionSummary: {
    promoted: shadowPromotion.promoted || [],
    date: shadowPromotion.date || null
  },
  fantasyReadinessSummary: {
    officialReady: fantasyReadiness.promoted?.officialReady?.length || 0,
    actionableLeanReady: fantasyReadiness.promoted?.actionableLeanReady?.length || 0,
    provisionalLeanReady: fantasyReadiness.promoted?.provisionalLeanReady?.length || 0
  },
  classes: byClass,
  all: classified
};

writeJson(OUT, report);
writeJson(OUT_DATED, report);

const lines = [];
lines.push("PRODUCTION CANDIDATE REPORT v1");
lines.push("==============================");
lines.push(`generatedAt: ${report.generatedAt}`);
lines.push("");
lines.push(`TOTAL: ${report.counts.total}`);
lines.push(`CORE: ${report.counts.core}`);
lines.push(`LEAN: ${report.counts.lean}`);
lines.push(`WATCHLIST: ${report.counts.watchlist}`);
lines.push(`HIGH_PROBABILITY_WATCH: ${report.counts.highProbabilityWatch}`);
lines.push(`RESEARCH: ${report.counts.research}`);
lines.push(`BLOCKED: ${report.counts.blocked}`);
lines.push("");
for (const className of ["CORE", "LEAN", "WATCHLIST", "HIGH_PROBABILITY_WATCH", "RESEARCH", "SHADOW_BLOCKED", "BLOCKED"]) {
  lines.push(className);
  lines.push("-".repeat(className.length));
  const rows = byClass[className].slice(0, 25);
  if (!rows.length) {
    lines.push("none");
  } else {
    for (const r of rows) {
      lines.push(
        `- ${r.player} | ${r.team || "?"} | ${r.market} ${r.side} ${r.line} | ${r.oddsTier} | prob=${pct(r.prob)} | edge=${pct(r.edge)} | books=${r.books ?? "n/a"} | support=${r.support || "n/a"} | grade=${r.grade || "n/a"} | sideBias=${r.sideBias?.tier || "n/a"} | reasons=${r.reasons.join(", ")}`
      );
    }
  }
  lines.push("");
}
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");
fs.writeFileSync(OUT_TXT_DATED, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log("saved:", OUT);
console.log("saved:", OUT_TXT);
