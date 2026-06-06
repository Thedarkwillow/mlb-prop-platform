const fs = require("fs");
const path = require("path");
const { prizePicksSlipValidation } = require("./lib/prizepicks-slip-rules.cjs");

const OUT_JSON = "outputs/prizepicks-slip-validity-audit.json";
const OUT_TXT = "outputs/prizepicks-slip-validity-audit.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

const FILES = [
  "outputs/slips.json",
  "outputs/slips-priced.json",
  "outputs/slips-distribution-enriched.json",
  "outputs/final-slips.json",
  "outputs/playable-final-slips.json",
  "outputs/official-slip.json",
  "outputs/goblin-highprob-slips.json"
];

function collectSlips(file, data) {
  const out = [];

  function addSlip(obj, sourcePath) {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj.legs)) {
      out.push({
        sourceFile: file,
        sourcePath,
        name: obj.name || obj.type || obj.id || `${path.basename(file)}#${out.length + 1}`,
        size: obj.size || obj.legs.length,
        status: obj.status || obj.recommendation || obj.class || "",
        legs: obj.legs,
        raw: obj
      });
    }
  }

  if (Array.isArray(data)) {
    data.forEach((x, i) => {
      addSlip(x, `[${i}]`);
      if (Array.isArray(x?.slips)) x.slips.forEach((s, j) => addSlip(s, `[${i}].slips[${j}]`));
    });
  } else if (data && typeof data === "object") {
    addSlip(data, "$");
    if (Array.isArray(data.slips)) data.slips.forEach((s, i) => addSlip(s, `$.slips[${i}]`));
    if (Array.isArray(data.finalSlips)) data.finalSlips.forEach((s, i) => addSlip(s, `$.finalSlips[${i}]`));
    if (Array.isArray(data.playableSlips)) data.playableSlips.forEach((s, i) => addSlip(s, `$.playableSlips[${i}]`));
    if (Array.isArray(data.watchlistSlips)) data.watchlistSlips.forEach((s, i) => addSlip(s, `$.watchlistSlips[${i}]`));
  }

  return out;
}

const slips = [];
for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  const data = readJson(file, null);
  slips.push(...collectSlips(file, data));
}

const rows = slips.map(s => {
  const validation = prizePicksSlipValidation(s.legs || []);
  return {
    sourceFile: s.sourceFile,
    sourcePath: s.sourcePath,
    name: s.name,
    size: s.size,
    status: s.status,
    valid: validation.valid,
    errors: validation.errors,
    projectionCount: validation.projectionCount,
    teamCount: validation.teamCount,
    teams: validation.teams,
    maxSamePlayerCount: validation.maxSamePlayerCount
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  filesChecked: FILES.filter(f => fs.existsSync(f)).length,
  slipsChecked: rows.length,
  valid: rows.filter(r => r.valid).length,
  invalid: rows.filter(r => !r.valid).length,
  byError: rows.flatMap(r => r.errors).reduce((acc, e) => {
    acc[e] = (acc[e] || 0) + 1;
    return acc;
  }, {})
};

fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, rows }, null, 2) + "\n");

const lines = [];
lines.push("PRIZEPICKS SLIP VALIDITY AUDIT");
lines.push("===============================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");

for (const r of rows) {
  lines.push(`${r.valid ? "VALID" : "INVALID"} | ${r.sourceFile} | ${r.name} | projections=${r.projectionCount} | teams=${r.teamCount} ${r.teams.join(",")}`);
  if (!r.valid) lines.push(`  errors=${r.errors.join(",")}`);
}
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT_JSON);
console.log("saved:", OUT_TXT);
