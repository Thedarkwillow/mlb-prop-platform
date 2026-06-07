const fs = require("fs");
const { canonicalPropRow, hasCanonicalRequiredFields } = require("../../src/shared/canonical-prop-row.cjs");

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

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function isPropLike(v) {
  if (!v || typeof v !== "object") return false;

  const hasPlayer = !!(v.player || v.playerName || v.athleteName);
  const hasMarket = !!(v.market || v.statType || v.projectionType || v.stat);
  const hasSide = !!(v.side || v.pick || v.direction || v.recommendation);
  const hasLine = v.line !== undefined || v.statValue !== undefined || v.target !== undefined || v.value !== undefined;

  // Require enough prop identity to avoid counting wrappers like {name, legs:[...]} as rows.
  return hasPlayer && (hasMarket || hasSide || hasLine);
}

function flattenProps(v, out = [], path = "") {
  if (!v) return out;

  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) flattenProps(v[i], out, `${path}[${i}]`);
    return out;
  }

  if (typeof v !== "object") return out;

  if (isPropLike(v)) {
    out.push({ row: v, path });
  }

  // Prefer explicit prop containers first.
  for (const key of ["legs", "picks", "topLegs", "candidates", "graded", "rows", "plays", "watchlist"]) {
    if (Array.isArray(v[key])) flattenProps(v[key], out, path ? `${path}.${key}` : key);
  }

  // Then recurse through remaining object values, but do not double-count explicit containers.
  for (const [key, val] of Object.entries(v)) {
    if (["legs", "picks", "topLegs", "candidates", "graded", "rows", "plays", "watchlist"].includes(key)) continue;
    if (val && typeof val === "object") flattenProps(val, out, path ? `${path}.${key}` : key);
  }

  return out;
}

const report = {
  generatedAt: new Date().toISOString(),
  contract: [
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
  ],
  files: []
};

for (const file of FILES) {
  const data = readJson(file, null);
  if (!data) {
    report.files.push({ file, exists: false });
    continue;
  }

  const propEntries = flattenProps(data);
  const rows = propEntries.map(x => x.row);
  const canonical = propEntries.map(x => ({
    ...canonicalPropRow(x.row, { source: file }),
    canonicalPath: x.path
  }));
  const missingRequired = canonical
    .map((r, i) => ({ i, path: r.canonicalPath, row: r, check: hasCanonicalRequiredFields(r) }))
    .filter(x => !x.check.ok);

  const unknownSample = canonical.filter(r => r.sampleStatus === "UNKNOWN_SAMPLE").length;
  const unknownLineup = canonical.filter(r => r.lineupStatus === "UNKNOWN_LINEUP").length;
  const unknownRisk = canonical.filter(r => r.riskStatus === "UNKNOWN_RISK").length;

  report.files.push({
    file,
    exists: true,
    rawRows: rows.length,
    canonicalRows: canonical.length,
    missingRequiredCount: missingRequired.length,
    unknownSample,
    unknownLineup,
    unknownRisk,
    sampleCanonicalRows: canonical.slice(0, 5),
    missingRequiredSample: missingRequired.slice(0, 10).map(x => ({
      index: x.i,
      path: x.path,
      missing: x.check.missing,
      row: x.row
    }))
  });
}

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

const lines = [];
lines.push("CANONICAL FIELD AUDIT");
lines.push("=====================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push("");
for (const f of report.files) {
  if (!f.exists) {
    lines.push(`${f.file}: MISSING`);
    continue;
  }
  lines.push(`${f.file}: rows=${f.canonicalRows} missingRequired=${f.missingRequiredCount} unknownSample=${f.unknownSample} unknownLineup=${f.unknownLineup} unknownRisk=${f.unknownRisk}`);
}
lines.push("");
lines.push("CONTRACT");
lines.push("--------");
for (const k of report.contract) lines.push(`- ${k}`);

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: report.generatedAt,
  files: report.files.map(f => ({
    file: f.file,
    exists: f.exists,
    rows: f.canonicalRows || 0,
    missingRequired: f.missingRequiredCount || 0,
    unknownSample: f.unknownSample || 0,
    unknownLineup: f.unknownLineup || 0,
    unknownRisk: f.unknownRisk || 0
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
