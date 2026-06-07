function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function arr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return [v].filter(Boolean);
}

function normMarket(v) {
  return s(v)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function normSide(v) {
  const raw = s(v).toUpperCase();
  if (raw === "OVER") return "MORE";
  if (raw === "UNDER") return "LESS";
  if (raw === "MORE" || raw === "LESS") return raw;
  return "";
}

function inferSampleStatus(row) {
  const explicit = s(
    row.sampleStatus ||
    row.sample_status ||
    row.contextSampleStatus ||
    row.pitcherSampleStatus ||
    row.hitterSampleStatus
  );
  if (explicit) return explicit;

  const reasons = arr(row.reasonCodes || row.reasons || row.blockReasons || row.flags)
    .map(x => s(x).toLowerCase());

  if (reasons.some(x => x.includes("missing_mlb_pitcher_sample") || x.includes("zero_mlb_pitcher_sample"))) {
    return "MISSING_OR_ZERO_SAMPLE";
  }
  if (reasons.some(x => x.includes("low_mlb") || x.includes("small_sample"))) {
    return "LOW_SAMPLE";
  }
  if (row.sampleSize !== undefined && n(row.sampleSize) !== null) {
    const size = n(row.sampleSize);
    if (size === 0) return "ZERO_SAMPLE";
    if (size < 10) return "LOW_SAMPLE";
    return "OK_SAMPLE";
  }

  return "UNKNOWN_SAMPLE";
}

function inferLineupStatus(row) {
  const explicit = s(row.lineupStatus || row.lineup_status);
  if (explicit) return explicit;

  if (row.lineupConfirmed === true || row.confirmedLineup === true || row.isConfirmedLineup === true) {
    return "CONFIRMED";
  }

  const reasons = arr(row.reasonCodes || row.reasons || row.blockReasons || row.flags)
    .map(x => s(x).toLowerCase());

  if (reasons.some(x => x.includes("unconfirmed_lineup") || x.includes("lineup_not_confirmed"))) {
    return "UNCONFIRMED";
  }

  return "UNKNOWN_LINEUP";
}

function inferRiskStatus(row) {
  const explicit = s(row.riskStatus || row.risk_status || row.risk);
  if (explicit) return explicit;

  const reasons = arr(row.reasonCodes || row.reasons || row.blockReasons || row.flags)
    .map(x => s(x).toLowerCase());

  if (reasons.some(x =>
    x.includes("hard_block") ||
    x.includes("rookie") ||
    x.includes("debut") ||
    x.includes("missing_mlb_pitcher_sample") ||
    x.includes("zero_mlb_pitcher_sample")
  )) {
    return "HARD_BLOCK_RISK";
  }

  if (reasons.some(x =>
    x.includes("fallback") ||
    x.includes("low_mlb") ||
    x.includes("weak_context") ||
    x.includes("unconfirmed")
  )) {
    return "RESEARCH_OR_CAP_RISK";
  }

  if (row.blockedReason || row.reason) return "BLOCKED_OR_REVIEW";

  return "UNKNOWN_RISK";
}

function reasonCodes(row) {
  const out = [];
  for (const v of arr(row.reasonCodes)) out.push(s(v));
  for (const v of arr(row.reasons)) out.push(s(v));
  for (const v of arr(row.blockReasons)) out.push(s(v));
  if (row.reason) out.push(s(row.reason));
  if (row.blockedReason) out.push(s(row.blockedReason));
  if (row.matchType) out.push(`match:${s(row.matchType)}`);
  return [...new Set(out.filter(Boolean))];
}

function canonicalPropRow(row = {}, opts = {}) {
  const market = normMarket(row.market || row.statType || row.projectionType || row.type || row.stat);
  const side = normSide(row.side || row.pick || row.direction || row.recommendation);

  const projection = n(
    row.projection ??
    row.contextAdjustedProjection ??
    row.rawProjection ??
    row.projectedValue ??
    row.mean
  );

  const probability = n(
    row.probability ??
    row.prob ??
    row.calibratedDistributionProb ??
    row.distributionProb ??
    row.hitProbability
  );

  const overProb = n(row.overProb ?? row.moreProb ?? row.probOver);
  const underProb = n(row.underProb ?? row.lessProb ?? row.probUnder);

  return {
    player: s(row.player || row.playerName || row.name || row.athleteName),
    team: s(row.team || row.resolvedTeam || row.rawTeam || row.abbrev),
    game: s(row.game || row.matchup || row.gameLabel),
    market,
    side,
    line: n(row.line ?? row.target ?? row.value ?? row.statValue),
    projection,
    probability,
    overProb,
    underProb,
    sampleStatus: inferSampleStatus(row),
    lineupStatus: inferLineupStatus(row),
    riskStatus: inferRiskStatus(row),
    finalScore: n(row.finalScore ?? row.score ?? row.officialScore),
    reasonCodes: reasonCodes(row),
    source: s(opts.source || row.source || row.sourceFile || row.origin || "unknown"),
    modelVersion: s(opts.modelVersion || row.modelVersion || row.version || "canonical_v1"),
    original: opts.includeOriginal ? row : undefined
  };
}

function hasCanonicalRequiredFields(row) {
  const missing = [];
  for (const k of ["player", "market", "side", "line"]) {
    if (row[k] === null || row[k] === undefined || row[k] === "") missing.push(k);
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  canonicalPropRow,
  hasCanonicalRequiredFields,
  normMarket,
  normSide
};
