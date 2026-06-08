const fs = require("fs");
const { canonicalPropRow } = require("../../src/shared/canonical-prop-row.cjs");

const FILES = [
  "outputs/less-batter-watchlist.json",
  "outputs/standard-hitter-bridge-watchlist.json",
  "outputs/manual/auto-reverse-hitter-signal.json",
  "outputs/goblin-recommended-card.json",
  "outputs/final-slips.json",
  "outputs/playable-final-slips.json",
  "outputs/official-slip.json"
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function isPropLike(v) {
  return v && typeof v === "object" && (
    v.player || v.playerName || v.athleteName
  ) && (
    v.market || v.statType || v.projectionType || v.stat ||
    v.side || v.pick || v.direction ||
    v.line !== undefined || v.statValue !== undefined
  );
}

function applyToObject(v, source, seen = new WeakSet()) {
  if (!v || typeof v !== "object") return 0;
  if (seen.has(v)) return 0;
  seen.add(v);

  let count = 0;

  if (Array.isArray(v)) {
    for (const x of v) count += applyToObject(x, source, seen);
    return count;
  }

  if (isPropLike(v)) {
    v.canonical = canonicalPropRow(v, {
      source,
      modelVersion: "canonical_v1"
    });
    count++;
  }

  for (const [key, val] of Object.entries(v)) {
    if (key === "canonical") continue;
    if (key === "original") continue;
    if (key === "sampleCanonicalRows") continue;
    if (key === "missingRequiredSample") continue;
    if (val && typeof val === "object") count += applyToObject(val, source, seen);
  }

  return count;
}

const report = {
  generatedAt: new Date().toISOString(),
  files: []
};

for (const file of FILES) {
  const data = readJson(file);
  if (!data) {
    report.files.push({ file, exists: false, updatedRows: 0 });
    continue;
  }

  const updatedRows = applyToObject(data, file);
  data.canonicalAppliedAt = new Date().toISOString();
  data.canonicalVersion = "canonical_v1";

  writeJson(file, data);
  report.files.push({ file, exists: true, updatedRows });
}

fs.writeFileSync("outputs/canonical-derived-apply-report.json", JSON.stringify(report, null, 2) + "\n");

console.log(report);
