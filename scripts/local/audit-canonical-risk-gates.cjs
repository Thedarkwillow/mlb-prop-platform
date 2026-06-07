const fs = require("fs");
const { canonicalPropRow } = require("../../src/shared/canonical-prop-row.cjs");

const FILES = [
  "outputs/final-slips.json",
  "outputs/playable-final-slips.json",
  "outputs/official-slip.json",
  "outputs/goblin-recommended-card.json",
  "outputs/less-batter-watchlist.json",
  "outputs/standard-hitter-bridge-watchlist.json",
  "outputs/manual/auto-reverse-hitter-signal.json"
];

const OUT = "outputs/canonical-risk-gate-audit.json";
const TXT = "outputs/canonical-risk-gate-audit.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function isPropLike(v) {
  return v && typeof v === "object" &&
    (v.player || v.playerName || v.athleteName) &&
    (v.market || v.statType || v.projectionType || v.stat || v.side || v.pick || v.direction || v.line !== undefined || v.statValue !== undefined);
}

function flatten(v, source, out = [], path = "") {
  if (!v) return out;

  if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, source, out, `${path}[${i}]`));
    return out;
  }

  if (typeof v !== "object") return out;

  const containers = ["legs", "picks", "topLegs", "candidates", "graded", "rows", "plays", "watchlist", "primary", "alternates"];
  for (const key of containers) {
    if (Array.isArray(v[key])) flatten(v[key], source, out, path ? `${path}.${key}` : key);
  }

  if (isPropLike(v)) {
    const c = v.canonical && typeof v.canonical === "object"
      ? v.canonical
      : canonicalPropRow(v, { source, modelVersion: "canonical_v1" });

    out.push({ source, path, row: v, canonical: c });
  }

  for (const [key, val] of Object.entries(v)) {
    if ([...containers, "canonical", "original"].includes(key)) continue;
    if (val && typeof val === "object") flatten(val, source, out, path ? `${path}.${key}` : key);
  }

  return out;
}

function gate(c) {
  const reasons = [];
  const risk = s(c.riskStatus);
  const sample = s(c.sampleStatus);
  const lineup = s(c.lineupStatus);
  const prob = n(c.probability);

  if (/RESEARCH_ONLY|WATCHLIST|PENDING|REVIEW|UNKNOWN|BLOCKED/.test(risk)) {
    reasons.push(`riskStatus:${risk}`);
  }

  if (/PENDING|UNKNOWN|LOW_SAMPLE/.test(sample)) {
    reasons.push(`sampleStatus:${sample}`);
  }

  if (/UNKNOWN|PARTIAL/.test(lineup)) {
    reasons.push(`lineupStatus:${lineup}`);
  }

  if (prob !== null && prob >= 0.75 && reasons.length) {
    reasons.push("high_probability_requires_clean_context");
  }

  return {
    allowedOfficial: reasons.length === 0,
    reasons
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  files: [],
  blockedRows: []
};

for (const file of FILES) {
  const data = readJson(file);
  if (!data) {
    report.files.push({ file, exists: false, rows: 0, blocked: 0, allowed: 0 });
    continue;
  }

  const rows = flatten(data, file);
  let blocked = 0;
  let allowed = 0;

  for (const item of rows) {
    const g = gate(item.canonical);
    if (g.allowedOfficial) {
      allowed++;
    } else {
      blocked++;
      report.blockedRows.push({
        source: item.source,
        path: item.path,
        player: item.canonical.player,
        team: item.canonical.team,
        market: item.canonical.market,
        side: item.canonical.side,
        line: item.canonical.line,
        probability: item.canonical.probability,
        riskStatus: item.canonical.riskStatus,
        sampleStatus: item.canonical.sampleStatus,
        lineupStatus: item.canonical.lineupStatus,
        reasons: g.reasons
      });
    }
  }

  report.files.push({ file, exists: true, rows: rows.length, blocked, allowed });
}

const lines = [];
lines.push("CANONICAL RISK GATE AUDIT");
lines.push("=========================");
lines.push(`generatedAt=${report.generatedAt}`);
for (const f of report.files) {
  lines.push(`${f.file}: rows=${f.rows} allowed=${f.allowed} blocked=${f.blocked}`);
}
lines.push("");
lines.push("TOP BLOCKED");
lines.push("-----------");
for (const r of report.blockedRows.slice(0, 40)) {
  lines.push(`${r.player} | ${r.market} ${r.side} ${r.line} | prob=${r.probability ?? "?"} | ${r.reasons.join(", ")}`);
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: report.generatedAt,
  files: report.files,
  blockedRows: report.blockedRows.length
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
