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

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const looksLikeProp =
    v.player || v.playerName || v.name || v.athleteName ||
    v.market || v.statType || v.projectionType ||
    v.side || v.pick || v.direction ||
    v.line !== undefined || v.statValue !== undefined;

  if (looksLikeProp) out.push(v);

  for (const val of Object.values(v)) flatten(val, out);
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

  const rows = flatten(data);
  const canonical = rows.map(r => canonicalPropRow(r, { source: file }));
  const missingRequired = canonical
    .map((r, i) => ({ i, row: r, check: hasCanonicalRequiredFields(r) }))
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
