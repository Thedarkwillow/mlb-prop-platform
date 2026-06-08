const fs = require("fs");
const { canonicalPropRow } = require("../../src/shared/canonical-prop-row.cjs");

const FILES = [
  "outputs/priced-board.json",
  "outputs/final-slips.json",
  "outputs/playable-final-slips.json",
  "outputs/official-slip.json",
  "outputs/goblin-recommended-card.json",
  "outputs/less-batter-watchlist.json",
  "outputs/standard-hitter-bridge-watchlist.json",
  "outputs/manual/auto-reverse-hitter-signal.json",
  "outputs/rolling-lane-promotion-review.json"
];

const OUT = "outputs/canonical-field-audit.json";
const TXT = "outputs/canonical-field-audit.txt";

const REQUIRED = [
  "player",
  "team",
  "game",
  "market",
  "side",
  "line",
  "projection",
  "probability",
  "overProb",
  "underProb",
  "sampleStatus",
  "lineupStatus",
  "riskStatus",
  "finalScore",
  "reasonCodes",
  "source",
  "modelVersion"
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function isPropLike(v) {
  if (!v || typeof v !== "object") return false;
  const hasPlayer = !!(v.player || v.playerName || v.athleteName || v.name);
  const hasPropShape = !!(
    v.market || v.statType || v.projectionType || v.stat ||
    v.side || v.pick || v.direction ||
    v.line !== undefined || v.statValue !== undefined || v.projectionLine !== undefined
  );
  return hasPlayer && hasPropShape;
}

function flattenProps(v, out = [], path = "") {
  if (!v) return out;

  if (Array.isArray(v)) {
    v.forEach((x, i) => flattenProps(x, out, `${path}[${i}]`));
    return out;
  }

  if (typeof v !== "object") return out;

  if (isPropLike(v)) {
    Object.defineProperty(v, "__canonicalPath", {
      value: path || "root",
      enumerable: false,
      configurable: true
    });
    out.push(v);
    return out;
  }

  for (const [key, val] of Object.entries(v)) {
    if ([
      "canonical",
      "original",
      "metadata",
      "summary",
      "byMarket",
      "byStatus",
      "bySignal",
      "byType",
      "thresholds",
      "sourceFiles"
    ].includes(key)) continue;

    if (val && typeof val === "object") {
      flattenProps(val, out, path ? `${path}.${key}` : key);
    }
  }

  return out;
}

function missingFields(c) {
  const missing = [];
  for (const k of REQUIRED) {
    if (k === "projection" || k === "probability" || k === "overProb" || k === "underProb" || k === "finalScore") {
      if (!(k in c)) missing.push(k);
      continue;
    }
    if (k === "reasonCodes") {
      if (!Array.isArray(c.reasonCodes)) missing.push(k);
      continue;
    }
    if (c[k] === undefined || c[k] === null || String(c[k]).trim() === "") missing.push(k);
  }
  return missing;
}

function summarizeFile(file) {
  const data = readJson(file, null);
  if (!data) {
    return {
      file,
      exists: false,
      rows: 0,
      excludedRows: 0,
      exclusionReasons: {},
      missingRequired: 0,
      unknownSample: 0,
      unknownLineup: 0,
      unknownRisk: 0,
      examples: {}
    };
  }

  const allRows = flattenProps(data);
  const excludedRows = allRows.filter(r => r.canonicalAuditStatus === "EXCLUDED_NON_CANONICAL_BOARD_ROW");
  const rows = allRows.filter(r => r.canonicalAuditStatus !== "EXCLUDED_NON_CANONICAL_BOARD_ROW");

  const normalized = rows.map((r, i) => {
    if (r.canonical && typeof r.canonical === "object") {
      return { ...r.canonical, canonicalPath: r.__canonicalPath || `row_${i}` };
    }
    return canonicalPropRow(r, {
      source: file,
      modelVersion: "canonical_v1",
      path: r.__canonicalPath || `row_${i}`
    });
  });

  const missingRequired = [];
  const unknownSample = [];
  const unknownLineup = [];
  const unknownRisk = [];

  normalized.forEach((c, i) => {
    const missing = missingFields(c);
    if (missing.length) missingRequired.push({ index: i, path: c.canonicalPath, missing, row: c });
    if (/UNKNOWN_SAMPLE/i.test(String(c.sampleStatus || ""))) unknownSample.push({ index: i, path: c.canonicalPath, row: c });
    if (/UNKNOWN_LINEUP/i.test(String(c.lineupStatus || ""))) unknownLineup.push({ index: i, path: c.canonicalPath, row: c });
    if (/UNKNOWN_RISK/i.test(String(c.riskStatus || ""))) unknownRisk.push({ index: i, path: c.canonicalPath, row: c });
  });

  const exclusionReasons = {};
  for (const r of excludedRows) {
    const k = String(r.canonicalAuditExclusionReason || "excluded");
    exclusionReasons[k] = (exclusionReasons[k] || 0) + 1;
  }

  return {
    file,
    exists: true,
    rawRows: allRows.length,
    rows: rows.length,
    excludedRows: excludedRows.length,
    exclusionReasons,
    missingRequired: missingRequired.length,
    unknownSample: unknownSample.length,
    unknownLineup: unknownLineup.length,
    unknownRisk: unknownRisk.length,
    examples: {
      missingRequired: missingRequired.slice(0, 10),
      unknownSample: unknownSample.slice(0, 5),
      unknownLineup: unknownLineup.slice(0, 5),
      unknownRisk: unknownRisk.slice(0, 5),
      excludedRows: excludedRows.slice(0, 10).map(r => ({
        player: r.player || r.playerName || r.name || r.athleteName,
        market: r.market || r.statType || r.projectionType || r.stat,
        side: r.side || r.pick || r.direction || r.selection,
        line: r.line ?? r.statValue ?? r.projectionLine,
        reason: r.canonicalAuditExclusionReason
      }))
    }
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  files: FILES.map(summarizeFile),
  contract: REQUIRED
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");

const lines = [];
lines.push("CANONICAL FIELD AUDIT");
lines.push("=====================");
lines.push(`generatedAt=${report.generatedAt}`);
for (const r of report.files) {
  lines.push(`${r.file}: rows=${r.rows} excluded=${r.excludedRows || 0} missingRequired=${r.missingRequired} unknownSample=${r.unknownSample} unknownLineup=${r.unknownLineup} unknownRisk=${r.unknownRisk}`);
  if (r.exclusionReasons && Object.keys(r.exclusionReasons).length) {
    lines.push(`  exclusions=${JSON.stringify(r.exclusionReasons)}`);
  }
}
lines.push("CONTRACT");
lines.push("--------");
for (const k of REQUIRED) lines.push(`- ${k}`);

fs.writeFileSync(TXT, lines.join("\n") + "\n");
console.log({
  generatedAt: report.generatedAt,
  files: report.files.map(r => ({
    file: r.file,
    rows: r.rows,
    excludedRows: r.excludedRows,
    missingRequired: r.missingRequired,
    unknownSample: r.unknownSample,
    unknownLineup: r.unknownLineup,
    unknownRisk: r.unknownRisk
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
