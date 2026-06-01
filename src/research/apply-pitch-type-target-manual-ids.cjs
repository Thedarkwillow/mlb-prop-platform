const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const TARGETS = "outputs/context/real-pitch-type-target-list-latest.json";
const REPAIR_LATEST = "outputs/context/pitch-type-target-mlb-id-repair-latest.json";
const REPAIR_DATED = `outputs/context/pitch-type-target-mlb-id-repair-${date}.json`;
const MANUAL_IDS = "data/context/manual-mlbam-ids.json";

function readJson(file, fallback = {}) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const targets = readJson(TARGETS, {});
const manual = readJson(MANUAL_IDS, {});
const prior = readJson(REPAIR_LATEST, {});

const targetRows = targets.pitcherArsenalTargets || [];
const manualPlayers = manual.players || {};

const existingRepaired = Array.isArray(prior.repairedRows) ? prior.repairedRows : [];
const existingFailed = Array.isArray(prior.failedRows) ? prior.failedRows : [];

const repairedByKey = new Map();

for (const row of existingRepaired) {
  const key = norm(row.pitcher || row.player || row.name);
  if (!key) continue;
  repairedByKey.set(key, row);
}

const manualApplied = [];

for (const target of targetRows) {
  const key = norm(target.pitcher || target.player || target.name);
  const rec = manualPlayers[key];
  if (!rec || !rec.mlbamId) continue;

  const row = {
    ...target,
    mlbamId: rec.mlbamId,
    matchedName: rec.name || target.pitcher || target.player,
    matchType: "manual_map",
    idSource: MANUAL_IDS
  };

  repairedByKey.set(key, row);
  manualApplied.push(row);
}

const repairedRows = [...repairedByKey.values()]
  .filter(row => targetRows.some(t => norm(t.pitcher || t.player || t.name) === norm(row.pitcher || row.player || row.name)))
  .sort((a, b) => (b.rows || 0) - (a.rows || 0));

const repairedKeys = new Set(repairedRows.map(r => norm(r.pitcher || r.player || r.name)));

const failedRows = existingFailed
  .filter(row => !repairedKeys.has(norm(row.pitcher || row.player || row.name)));

const out = {
  ...prior,
  date,
  generatedAt: new Date().toISOString(),
  sourceTargets: TARGETS,
  manualIdMap: MANUAL_IDS,
  requested: targetRows.length,
  repaired: repairedRows.length,
  failed: failedRows.length,
  repairedRows,
  failedRows,
  manualApplied: manualApplied.length
};

writeJson(REPAIR_LATEST, out);
writeJson(REPAIR_DATED, out);

console.log("APPLY PITCH TYPE TARGET MANUAL IDS");
console.log("----------------------------------");
console.table([{
  targets: targetRows.length,
  priorRepaired: existingRepaired.length,
  manualApplied: manualApplied.length,
  repaired: repairedRows.length,
  failed: failedRows.length
}]);

console.log("\nRepaired rows:");
console.table(repairedRows.map(x => ({
  pitcher: x.pitcher,
  team: x.team,
  rows: x.rows,
  mlbamId: x.mlbamId,
  matchedName: x.matchedName,
  matchType: x.matchType
})));

if (failedRows.length) {
  console.log("\nStill failed:");
  console.table(failedRows.map(x => ({
    pitcher: x.pitcher,
    team: x.team,
    rows: x.rows,
    reason: String(x.reason || "").slice(0, 100)
  })));
}

console.log("saved:", REPAIR_LATEST);
console.log("saved:", REPAIR_DATED);
