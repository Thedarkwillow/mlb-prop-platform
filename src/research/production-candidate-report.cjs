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
  fullBoardLearning: "data/learning/full-board-market-learning.json"
};

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
  return "70+";
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

function cleanRow(row, classification, reasons, fullBoardByMarketSide) {
  const sideBias = getSideBias(row, fullBoardByMarketSide);
  return {
    class: classification,
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
    source: row.source ?? row.sourceFile ?? null,
    leanStatus: row.leanStatus ?? null,
    leanNotes: row.leanNotes ?? null,
    blockedReason: row.reason ?? row.disabledReason ?? null
  };
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

  if (isFantasy(row)) {
    const isLowLineHitterMore =
      market === "hitter_fantasy_score" &&
      side === "MORE" &&
      num(row.line, 999) < 3 &&
      ["standard", "goblin"].includes(tier);

    if (isLowLineHitterMore) {
      return { classification: "RESEARCH", reasons: ["fantasy_provisional_low_line_hitter_more"] };
    }

    return { classification: "BLOCKED", reasons: ["fantasy_not_ready_or_suppressed"] };
  }

  if (grade === "FADE") {
    if (prob !== null && prob >= 0.65) {
      reasons.push("high_probability_but_grade_fade");
      if (sideBias?.tier === "NEGATIVE" || sideBias?.tier === "STRONG_NEGATIVE") {
        reasons.push("negative_side_bias");
      }
      if (blocked?.reason) reasons.push(`blocked:${blocked.reason}`);
      return { classification: "HIGH_PROBABILITY_WATCH", reasons };
    }

    return { classification: "BLOCKED", reasons: ["grade_fade"] };
  }

  if (edge !== null && edge < 0) {
    return { classification: "BLOCKED", reasons: ["negative_edge"] };
  }

  if (sideBias?.tier === "NEGATIVE" || sideBias?.tier === "STRONG_NEGATIVE") {
    if (prob !== null && prob >= 0.65) {
      reasons.push("high_probability_but_negative_side_bias");
      if (blocked?.reason) reasons.push(`blocked:${blocked.reason}`);
      return { classification: "HIGH_PROBABILITY_WATCH", reasons };
    }

    return { classification: "BLOCKED", reasons: ["negative_side_bias"] };
  }

  if (lean) {
    reasons.push("actionable_lean");
    if (lean.leanNotes?.length) reasons.push(...lean.leanNotes);
    return { classification: "WATCHLIST", reasons };
  }

  if (blocked) {
    const reason = blocked.reason || blocked.disabledReason || "blocked_candidate";
    if (
      ["weak_confidence", "score_below_adaptive_minimum", "elite_score_below_adaptive_floor"].includes(reason) &&
      sideBias?.tier === "STRONG_POSITIVE" &&
      edge !== null &&
      edge >= 0.05
    ) {
      return { classification: "WATCHLIST", reasons: [`blocked_but_watch:${reason}`, "strong_positive_side_bias"] };
    }

    return { classification: "BLOCKED", reasons: [`blocked:${reason}`] };
  }

  if (
    grade === "GREEN" &&
    support === "OK" &&
    edge !== null &&
    edge > 0 &&
    prob !== null &&
    prob >= 0.56 &&
    !(sideBias?.tier === "NEGATIVE" || sideBias?.tier === "STRONG_NEGATIVE")
  ) {
    return { classification: "CORE", reasons: ["green_ok_positive_edge"] };
  }

  if (
    edge !== null &&
    edge > 0 &&
    sideBias?.tier === "STRONG_POSITIVE"
  ) {
    return { classification: "WATCHLIST", reasons: ["positive_edge_strong_side_bias"] };
  }

  if (support.includes("LOW") || books === 1) {
    return { classification: "WATCHLIST", reasons: ["low_book_support"] };
  }

  return { classification: "RESEARCH", reasons: ["needs_more_validation"] };
}

const enriched = readJson(SOURCES.enriched, []);
const leanReport = readJson(SOURCES.leans, {});
const blockedRaw = readJson(SOURCES.blocked, []);
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
  WATCHLIST: 1,
  HIGH_PROBABILITY_WATCH: 2,
  RESEARCH: 3,
  BLOCKED: 4
};

classified.sort((a, b) =>
  (classOrder[a.class] ?? 99) - (classOrder[b.class] ?? 99) ||
  (b.prob ?? -999) - (a.prob ?? -999) ||
  (b.edge ?? -999) - (a.edge ?? -999)
);

const byClass = {
  CORE: classified.filter(r => r.class === "CORE"),
  WATCHLIST: classified.filter(r => r.class === "WATCHLIST"),
  HIGH_PROBABILITY_WATCH: classified.filter(r => r.class === "HIGH_PROBABILITY_WATCH"),
  RESEARCH: classified.filter(r => r.class === "RESEARCH"),
  BLOCKED: classified.filter(r => r.class === "BLOCKED")
};

const report = {
  generatedAt: new Date().toISOString(),
  sources: SOURCES,
  counts: {
    total: classified.length,
    core: byClass.CORE.length,
    watchlist: byClass.WATCHLIST.length,
    highProbabilityWatch: byClass.HIGH_PROBABILITY_WATCH.length,
    research: byClass.RESEARCH.length,
    blocked: byClass.BLOCKED.length,
    playableOfficialSlips: Array.isArray(playable) ? playable.length : 0
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
    currentNonBlocked: byClass.CORE.length + byClass.WATCHLIST.length + byClass.HIGH_PROBABILITY_WATCH.length + byClass.RESEARCH.length,
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

const lines = [];
lines.push("PRODUCTION CANDIDATE REPORT v1");
lines.push("==============================");
lines.push(`generatedAt: ${report.generatedAt}`);
lines.push("");
lines.push(`TOTAL: ${report.counts.total}`);
lines.push(`CORE: ${report.counts.core}`);
lines.push(`WATCHLIST: ${report.counts.watchlist}`);
lines.push(`HIGH_PROBABILITY_WATCH: ${report.counts.highProbabilityWatch}`);
lines.push(`RESEARCH: ${report.counts.research}`);
lines.push(`BLOCKED: ${report.counts.blocked}`);
lines.push("");
for (const className of ["CORE", "WATCHLIST", "HIGH_PROBABILITY_WATCH", "RESEARCH", "BLOCKED"]) {
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

console.log(lines.join("\n"));
console.log("saved:", OUT);
console.log("saved:", OUT_TXT);
