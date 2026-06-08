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

function normMarket(v) {
  return s(v).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function isPitcherMarket(market) {
  return [
    "strikeouts",
    "pitching_outs",
    "earned_runs_allowed",
    "hits_allowed",
    "walks_allowed",
    "pitcher_fantasy_score"
  ].includes(normMarket(market));
}

function isPropLike(v) {
  return v && typeof v === "object" &&
    (v.player || v.playerName || v.athleteName || v.name) &&
    (v.market || v.statType || v.projectionType || v.stat || v.side || v.pick || v.direction || v.line !== undefined || v.statValue !== undefined);
}

function inferSampleStatus(row) {
  const explicit = s(row.sampleStatus || row.sample_status || row.canonical?.sampleStatus);
  if (explicit && explicit !== "UNKNOWN_SAMPLE") return explicit;

  const sample =
    n(row.sample) ??
    n(row.sampleSize) ??
    n(row.sample_size) ??
    n(row.games) ??
    n(row.gamesPlayed) ??
    n(row.recentSample) ??
    n(row.lastSample) ??
    n(row.historySample);

  if (sample === null) {
    if (row.last5 || row.last10 || row.last15 || row.recentForm || row.rollingForm) {
      return "HAS_CONTEXT_SAMPLE";
    }
    return "MISSING_SAMPLE";
  }

  if (sample >= 25) return "STRONG_SAMPLE";
  if (sample >= 10) return "MEDIUM_SAMPLE";
  if (sample >= 5) return "LOW_SAMPLE";
  return "TINY_SAMPLE";
}

function inferLineupStatus(row) {
  const explicit = s(row.lineupStatus || row.lineup_status || row.canonical?.lineupStatus);
  if (explicit && explicit !== "UNKNOWN_LINEUP") return explicit;

  const market = row.market || row.statType || row.projectionType;
  if (isPitcherMarket(market)) return "LINEUP_NOT_REQUIRED_PITCHER_MARKET";

  const raw = s(row.lineupConfirmed ?? row.confirmedLineup ?? row.isConfirmedLineup ?? row.confirmed);
  if (/true|yes|confirmed/i.test(raw)) return "CONFIRMED";

  const battingOrder = n(row.battingOrder ?? row.lineupSlot ?? row.order);
  if (battingOrder !== null) return "LINEUP_ORDER_AVAILABLE";

  return "LINEUP_CONTEXT_PARTIAL";
}

function inferRiskStatus(row, canonical) {
  const explicit = s(row.riskStatus || row.risk_status || row.canonical?.riskStatus);
  if (explicit && explicit !== "UNKNOWN_RISK") return explicit;

  const prob = n(canonical.probability);
  const sample = canonical.sampleStatus;
  const lineup = canonical.lineupStatus;

  const reasons = [];

  if (/MISSING|TINY|LOW/.test(sample)) reasons.push("sample_not_strong");
  if (/UNKNOWN|PARTIAL/.test(lineup)) reasons.push("lineup_not_fully_confirmed");

  if (row.rookieRisk || row.debutRisk || row.rookiePitcherRisk) {
    reasons.push("rookie_or_debut_risk");
  }

  if (row.fallbackProjection || row.projectionSource === "fallback" || row.source === "fallback") {
    reasons.push("fallback_projection");
  }

  if (prob !== null && prob >= 0.75 && reasons.length) {
    return "HIGH_PROB_REQUIRES_REVIEW";
  }

  if (reasons.includes("rookie_or_debut_risk")) return "ROOKIE_DEBUT_REVIEW";
  if (reasons.includes("fallback_projection")) return "FALLBACK_PROJECTION_REVIEW";
  if (reasons.length) return "CONTEXT_REVIEW";

  return "CANONICAL_OK";
}

function enrichObject(v, source) {
  if (!v || typeof v !== "object") return 0;

  let count = 0;

  if (Array.isArray(v)) {
    for (const x of v) count += enrichObject(x, source);
    return count;
  }

  if (isPropLike(v)) {
    const canonical = canonicalPropRow(v, {
      source,
      modelVersion: "canonical_v1"
    });

    canonical.sampleStatus = inferSampleStatus(v);
    canonical.lineupStatus = inferLineupStatus(v);
    canonical.riskStatus = inferRiskStatus(v, canonical);

    const reasonCodes = new Set(Array.isArray(canonical.reasonCodes) ? canonical.reasonCodes : []);
    reasonCodes.add(`sample:${canonical.sampleStatus}`);
    reasonCodes.add(`lineup:${canonical.lineupStatus}`);
    reasonCodes.add(`risk:${canonical.riskStatus}`);
    canonical.reasonCodes = [...reasonCodes];

    v.canonical = canonical;
    v.sampleStatus = canonical.sampleStatus;
    v.lineupStatus = canonical.lineupStatus;
    v.riskStatus = canonical.riskStatus;

    count++;
    return count;
  }

  for (const [key, val] of Object.entries(v)) {
    if (key === "canonical") continue;
    if (val && typeof val === "object") count += enrichObject(val, source);
  }

  return count;
}

const report = {
  generatedAt: new Date().toISOString(),
  files: []
};

for (const file of FILES) {
  const data = readJson(file, null);
  if (!data) {
    report.files.push({ file, exists: false, updatedRows: 0 });
    continue;
  }

  const updatedRows = enrichObject(data, file);
  writeJson(file, data);
  report.files.push({ file, exists: true, updatedRows });
}

writeJson(OUT, report);

const lines = [];
lines.push("PRICED BOARD CANONICAL STATUS ENRICHMENT");
lines.push("========================================");
lines.push(`generatedAt=${report.generatedAt}`);
for (const f of report.files) {
  lines.push(`${f.file}: exists=${f.exists} updatedRows=${f.updatedRows}`);
}
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(report);
