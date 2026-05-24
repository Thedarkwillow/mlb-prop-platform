const fs = require("fs");
const path = require("path");

const date = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

const FINAL = "outputs/final-slips.json";
const BLOCKED = "outputs/blocked-final-candidates.json";
const OUT = "outputs/lean-final-slips.json";
const OUT_DATED = `outputs/lean-final-slips-${date}.json`;

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return str(v).toLowerCase();
}

function uniqueKey(row) {
  return [
    lower(row.player),
    lower(row.team),
    lower(row.game),
    lower(row.market),
    lower(row.side),
    num(row.line, "")
  ].join("|");
}

function hasHardBan(row) {
  const reasons = [
    ...(Array.isArray(row.finalExecutionGate?.reasons) ? row.finalExecutionGate.reasons : []),
    row.reason,
    row.disabledReason,
    row.blockReason,
    row.rejectionReason
  ].filter(Boolean).map(lower);

  return reasons.some(r =>
    r.includes("hard_ban") ||
    r.includes("suppressed") ||
    r.includes("bad_market") ||
    r.includes("fantasy_scale_not_verified") ||
    r.includes("off_slate") ||
    r.includes("unresolved") ||
    r.includes("invalid") ||
    r.includes("missing")
  );
}

function getProb(row) {
  return num(
    row.calibratedDistributionProb ??
    row.prob ??
    row.probability ??
    row.finalProb ??
    row.twoSidedPricing?.selectedProb,
    null
  );
}

function getEdge(row) {
  return num(
    row.adjustedEdge ??
    row.adjEdge ??
    row.edge ??
    row.finalEdge ??
    row.twoSidedPricing?.modelOnlyEdge,
    null
  );
}

function getScore(row) {
  return num(
    row.finalScore ??
    row.score ??
    row.finalExecutionGate?.score,
    null
  );
}

function getTier(row) {
  return lower(row.oddsTier || row.specialTier || row.tier || "standard");
}

function getBooks(row) {
  return num(row.books ?? row.bookCount, null);
}

function getSupport(row) {
  return lower(row.marketSupportFlag || row.support || row.priceCoverageTier || "");
}

function getGateReasons(row) {
  return [
    ...(Array.isArray(row.finalExecutionGate?.reasons) ? row.finalExecutionGate.reasons : []),
    row.reason,
    row.disabledReason
  ].filter(Boolean);
}

function officialThreshold(row) {
  const tier = getTier(row);
  if (tier === "goblin") return 0.72;
  if (tier === "demon") return 0.60;
  return 0.56;
}

function classifyLean(row) {
  const prob = getProb(row);
  const edge = getEdge(row);
  const score = getScore(row);
  const tier = getTier(row);
  const market = lower(row.market);
  const side = lower(row.side);
  const line = num(row.line, null);
  const books = getBooks(row);
  const support = getSupport(row);
  const reasons = getGateReasons(row);

  const notes = [];

  if (!row.player || !market || !side || line === null) {
    return { eligible: false, tier: "BLOCKED", notes: ["missing_required_fields"] };
  }

  if (hasHardBan(row)) {
    return { eligible: false, tier: "BLOCKED", notes: ["hard_ban_or_suppressed"] };
  }

  if (prob === null || edge === null) {
    return { eligible: false, tier: "TRACK_ONLY", notes: ["missing_prob_or_edge"] };
  }

  const lowBook = support.includes("low") || books === 1;
  const threshold = officialThreshold(row);
  const withinTinyMargin = prob >= threshold - 0.005;
  const lineHalf = line === 0.5;

  if (tier === "goblin") {
    if (prob >= 0.715 && lineHalf && !hasHardBan(row)) {
      if (lowBook) notes.push("low_book_support");
      if (withinTinyMargin) notes.push("within_0.5pct_of_goblin_threshold");
      if (prob < threshold) notes.push("below_official_goblin_threshold");
      return {
        eligible: true,
        tier: lowBook ? "LEAN_LOW_SUPPORT" : "LEAN",
        notes
      };
    }

    return {
      eligible: false,
      tier: "TRACK_ONLY",
      notes: ["goblin_prob_below_lean_threshold"]
    };
  }

  if (tier === "demon") {
    if (prob >= 0.60 && edge >= 0.05 && !hasHardBan(row)) {
      if (lowBook) notes.push("low_book_support");
      return {
        eligible: true,
        tier: lowBook ? "LEAN_LOW_SUPPORT" : "LEAN",
        notes
      };
    }

    return {
      eligible: false,
      tier: "TRACK_ONLY",
      notes: ["demon_below_lean_threshold"]
    };
  }

  // Standard props
  if (prob >= 0.56 && edge >= 0.035 && !hasHardBan(row)) {
    if (lowBook && prob < 0.60) {
      return {
        eligible: false,
        tier: "TRACK_ONLY",
        notes: ["standard_low_book_needs_60_prob"]
      };
    }

    if (lowBook) notes.push("low_book_support");
    if (score !== null && score < 0.13) notes.push("score_below_official_floor_but_lean_allowed");

    return {
      eligible: true,
      tier: lowBook ? "LEAN_LOW_SUPPORT" : "LEAN",
      notes
    };
  }

  return {
    eligible: false,
    tier: "TRACK_ONLY",
    notes: ["standard_below_lean_threshold"]
  };
}

function normalizeCandidate(row, source) {
  const prob = getProb(row);
  const edge = getEdge(row);
  const score = getScore(row);
  const lean = classifyLean(row);

  return {
    source,
    player: row.player ?? null,
    team: row.team ?? row.resolvedTeam ?? null,
    game: row.game ?? row.resolvedGame ?? null,
    gamePk: row.gamePk ?? row.resolvedGamePk ?? null,
    market: row.market ?? null,
    side: row.side ?? null,
    line: row.line ?? null,
    oddsTier: getTier(row),
    prob,
    edge,
    adjustedEdge: num(row.adjustedEdge ?? row.adjEdge, null),
    score,
    books: getBooks(row),
    support: row.marketSupportFlag ?? row.support ?? row.priceCoverageTier ?? null,
    grade: row.grade ?? null,
    confidence: row.calibratedConfidence?.confidence ?? row.distributionConfidence ?? null,
    officialGatePassed: row.finalExecutionGate?.passed ?? null,
    officialGateReasons: getGateReasons(row),
    leanStatus: lean.tier,
    leanEligible: lean.eligible,
    leanNotes: lean.notes
  };
}

const final = readJson(FINAL, {});
const topLegs = Array.isArray(final.topLegs) ? final.topLegs : [];
const blocked = readJson(BLOCKED, []);

const candidates = [];
const seen = new Set();

for (const row of topLegs) {
  const normalized = normalizeCandidate(row, "final_top_leg");
  const key = uniqueKey(normalized);
  if (!seen.has(key)) {
    seen.add(key);
    candidates.push(normalized);
  }
}

for (const row of blocked) {
  const normalized = normalizeCandidate(row, "blocked_candidate");
  const key = uniqueKey(normalized);
  if (!seen.has(key)) {
    seen.add(key);
    candidates.push(normalized);
  }
}

const leans = candidates
  .filter(r => r.leanEligible)
  .sort((a, b) =>
    (b.prob ?? 0) - (a.prob ?? 0) ||
    (b.edge ?? 0) - (a.edge ?? 0) ||
    (b.score ?? 0) - (a.score ?? 0)
  );

const trackOnly = candidates
  .filter(r => !r.leanEligible && r.leanStatus === "TRACK_ONLY")
  .sort((a, b) =>
    (b.prob ?? 0) - (a.prob ?? 0) ||
    (b.edge ?? 0) - (a.edge ?? 0)
  );

const blockedOut = candidates
  .filter(r => r.leanStatus === "BLOCKED")
  .sort((a, b) =>
    (b.prob ?? 0) - (a.prob ?? 0) ||
    (b.edge ?? 0) - (a.edge ?? 0)
  );

const recommended2ManLean =
  leans.length >= 2
    ? {
        name: "2-MAN LEAN / MANUAL REVIEW",
        status: "LEAN_ONLY_NOT_OFFICIAL",
        legs: leans.slice(0, 2)
      }
    : null;

const recommended3ManLean =
  leans.length >= 3
    ? {
        name: "3-MAN LEAN / MANUAL REVIEW",
        status: "LEAN_ONLY_NOT_OFFICIAL",
        legs: leans.slice(0, 3)
      }
    : null;

const out = {
  date,
  generatedAt: new Date().toISOString(),
  mode: "LEAN_MANUAL_REVIEW_NOT_OFFICIAL",
  warning: "These are not official model plays. They are borderline/manual-review candidates kept separate from official ROI tracking.",
  counts: {
    totalCandidates: candidates.length,
    leans: leans.length,
    trackOnly: trackOnly.length,
    blocked: blockedOut.length
  },
  recommended: {
    twoMan: recommended2ManLean,
    threeMan: recommended3ManLean
  },
  leans,
  trackOnly,
  blocked: blockedOut
};

writeJson(OUT, out);
writeJson(OUT_DATED, out);

console.log("LEAN FINAL SLIPS");
console.log("----------------");
console.log("date:", date);
console.log("total candidates:", candidates.length);
console.log("leans:", leans.length);
console.log("track only:", trackOnly.length);
console.log("blocked:", blockedOut.length);

console.table(leans.slice(0, 20).map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  tier: r.oddsTier,
  prob: r.prob,
  edge: r.edge,
  score: r.score,
  support: r.support,
  leanStatus: r.leanStatus,
  notes: r.leanNotes.join(", ")
})));

console.log("saved:", OUT);
console.log("saved:", OUT_DATED);
