const fs = require("fs");
const { canonicalPropRow } = require("../../src/shared/canonical-prop-row.cjs");

const FILES = [
  "outputs/priced-board.json",
  "outputs/sportsbook-enriched-board.json"
];

const OUT = "outputs/priced-board-canonical-status-report.json";
const TXT = "outputs/priced-board-canonical-status-report.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function normSide(v) {
  const raw = s(v).toUpperCase();
  if (raw === "OVER") return "MORE";
  if (raw === "UNDER") return "LESS";
  return raw;
}

function isComboPlayerName(name) {
  return /\s\+\s/.test(s(name)) || / combo/i.test(s(name));
}

function isPropLike(v) {
  if (!v || typeof v !== "object") return false;

  const hasPlayer = !!(v.player || v.playerName || v.name || v.athleteName);
  const hasPropShape = !!(
    v.market || v.statType || v.projectionType || v.stat ||
    v.side || v.pick || v.direction || v.selection ||
    v.line !== undefined || v.statValue !== undefined || v.projectionLine !== undefined
  );

  return hasPlayer && hasPropShape;
}

function canonicalAuditExclusionReason(row) {
  const player = s(row.player || row.playerName || row.name || row.athleteName);
  const market = s(row.market || row.statType || row.projectionType || row.stat);
  const side = normSide(row.side || row.pick || row.direction || row.selection);
  const line = n(row.line ?? row.statValue ?? row.value ?? row.projectionLine);

  if (!player) return "missing_player";
  if (isComboPlayerName(player)) return "combo_player_row";
  if (!market) return "missing_market";
  if (line === null) return "missing_line";

  // These are raw board/context rows, not playable prop selections.
  if (!["MORE", "LESS"].includes(side)) return "missing_or_non_playable_side";

  return "";
}

function inferSampleStatus(row) {
  const existing = s(row.sampleStatus || row.sample_status || row.contextSampleStatus);
  if (existing && !/unknown/i.test(existing)) return existing;

  const sample =
    n(row.sample) ??
    n(row.sampleSize) ??
    n(row.historicalSample) ??
    n(row.n) ??
    n(row.gamesSample);

  if (sample !== null && sample >= 25) return "SAMPLE_OK";
  if (sample !== null && sample > 0) return "LOW_SAMPLE";
  return "MISSING_SAMPLE";
}

function inferLineupStatus(row) {
  const existing = s(row.lineupStatus || row.lineup_status || row.confirmedLineupStatus);
  if (existing && !/unknown/i.test(existing)) return existing;

  const confirmed = row.confirmedLineup ?? row.lineupConfirmed ?? row.isConfirmedLineup;
  if (confirmed === true) return "CONFIRMED";
  if (confirmed === false) return "UNCONFIRMED";

  const market = s(row.market || row.statType || row.projectionType || row.stat).toLowerCase();
  if (/strikeout|pitching|pitcher|earned_runs_allowed|hits_allowed|walks_allowed|outs|pitches/.test(market)) {
    return "LINEUP_NOT_REQUIRED_PITCHER_MARKET";
  }

  return "LINEUP_CONTEXT_UNKNOWN";
}

function inferRiskStatus(row, canonical, exclusionReason) {
  if (exclusionReason) return "NON_CANONICAL_BOARD_ROW";

  const existing = s(row.riskStatus || row.risk_status || row.canonicalRiskStatus);
  if (existing && !/unknown/i.test(existing)) return existing;

  const sampleStatus = s(canonical.sampleStatus || "");
  const lineupStatus = s(canonical.lineupStatus || "");
  const prob = n(canonical.probability);

  if (/MISSING|LOW|PENDING|UNKNOWN/i.test(sampleStatus)) return "CONTEXT_REVIEW";
  if (/UNKNOWN|UNCONFIRMED|PARTIAL/i.test(lineupStatus)) return "CONTEXT_REVIEW";
  if (prob !== null && prob >= 0.75) return "HIGH_PROB_REQUIRES_CONTEXT_REVIEW";

  return "CANONICAL_BOARD_ROW";
}

function addReasons(c, row) {
  const reasons = Array.isArray(c.reasonCodes) ? [...c.reasonCodes] : [];

  for (const tag of [
    `sample:${c.sampleStatus}`,
    `lineup:${c.lineupStatus}`,
    `risk:${c.riskStatus}`
  ]) {
    if (!reasons.includes(tag)) reasons.push(tag);
  }

  if (row.canonicalAuditExclusionReason) {
    const tag = `canonical_exclusion:${row.canonicalAuditExclusionReason}`;
    if (!reasons.includes(tag)) reasons.push(tag);
  }

  c.reasonCodes = reasons;
  return c;
}

function enrichObject(v, source, stats) {
  if (!v || typeof v !== "object") return;

  if (Array.isArray(v)) {
    for (const x of v) enrichObject(x, source, stats);
    return;
  }

  if (isPropLike(v)) {
    const exclusionReason = canonicalAuditExclusionReason(v);

    let c = canonicalPropRow(v, {
      source,
      modelVersion: "canonical_v1"
    });

    c.sampleStatus = inferSampleStatus(v);
    c.lineupStatus = inferLineupStatus(v);
    c.riskStatus = inferRiskStatus(v, c, exclusionReason);

    c = addReasons(c, v);

    v.canonical = c;
    v.sampleStatus = c.sampleStatus;
    v.lineupStatus = c.lineupStatus;
    v.riskStatus = c.riskStatus;
    v.canonicalAuditStatus = exclusionReason
      ? "EXCLUDED_NON_CANONICAL_BOARD_ROW"
      : "INCLUDED_CANONICAL_PROP_ROW";
    v.canonicalAuditExclusionReason = exclusionReason || "";

    stats.updatedRows++;
    if (exclusionReason) {
      stats.excludedRows++;
      stats.exclusionReasons[exclusionReason] = (stats.exclusionReasons[exclusionReason] || 0) + 1;
    } else {
      stats.includedRows++;
    }

    return;
  }

  for (const [key, val] of Object.entries(v)) {
    if (["canonical", "metadata", "summary"].includes(key)) continue;
    if (val && typeof val === "object") enrichObject(val, source, stats);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  files: []
};

for (const file of FILES) {
  const data = readJson(file, null);
  if (!data) {
    report.files.push({
      file,
      exists: false,
      updatedRows: 0,
      includedRows: 0,
      excludedRows: 0,
      exclusionReasons: {}
    });
    continue;
  }

  const stats = {
    file,
    exists: true,
    updatedRows: 0,
    includedRows: 0,
    excludedRows: 0,
    exclusionReasons: {}
  };

  enrichObject(data, file, stats);
  writeJson(file, data);
  report.files.push(stats);
}

writeJson(OUT, report);

const lines = [];
lines.push("PRICED BOARD CANONICAL STATUS ENRICHMENT");
lines.push("========================================");
lines.push(`generatedAt=${report.generatedAt}`);
for (const f of report.files) {
  lines.push(`${f.file}: exists=${f.exists} updatedRows=${f.updatedRows} includedRows=${f.includedRows} excludedRows=${f.excludedRows}`);
  if (f.exclusionReasons && Object.keys(f.exclusionReasons).length) {
    lines.push(`  exclusions=${JSON.stringify(f.exclusionReasons)}`);
  }
}
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(report);
