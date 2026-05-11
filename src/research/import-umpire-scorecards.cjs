const fs = require("fs");
const path = require("path");

const INPUT = process.argv[2] || "data/context/imports/umpire-scorecards.csv";
const OUTPUT = "data/context/umpires.json";

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowsFromInput(text) {
  const t = String(text || "").trim();
  if (!t) return [];

  if (t.startsWith("[") || t.startsWith("{")) {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (Array.isArray(parsed.data)) return parsed.data;
    if (Array.isArray(parsed.umpires)) return parsed.umpires;
    if (Array.isArray(parsed.results)) return parsed.results;
    return [];
  }

  const lines = t.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",");
  return lines.map(line => {
    const cols = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, cols[i]]));
  });
}

if (!fs.existsSync(INPUT)) {
  fs.mkdirSync(path.dirname(INPUT), { recursive: true });
  fs.writeFileSync(INPUT, "umpire,accuracy_above_x_wmean,overall_accuracy_wmean,consistency_wmean,total_run_impact_mean,favor_abs_mean,weighted_score\n");
}

const rows = rowsFromInput(fs.readFileSync(INPUT, "utf8"));
const umpires = {};

for (const r of rows) {
  const name = r.umpire || r.name || r.Umpire;
  if (!name) continue;

  const accuracyAboveX = num(r.accuracy_above_x_wmean);
  const weightedScore = num(r.weighted_score);
  const runImpact = num(r.total_run_impact_mean);

  let kFactor = 0;
  if (accuracyAboveX !== null) {
    if (accuracyAboveX >= 1.0) kFactor = 0.04;
    else if (accuracyAboveX >= 0.5) kFactor = 0.025;
    else if (accuracyAboveX <= -1.0) kFactor = -0.04;
    else if (accuracyAboveX <= -0.5) kFactor = -0.025;
  }

  umpires[norm(name)] = {
    umpire: name,
    kFactor,
    kBoost: kFactor > 0,
    kDowngrade: kFactor < 0,
    accuracyAboveX,
    overallAccuracy: num(r.overall_accuracy_wmean),
    consistency: num(r.consistency_wmean),
    runImpact,
    favorAbs: num(r.favor_abs_mean),
    weightedScore,
    sampleGames: num(r.n),
    calledPitches: num(r.called_pitches_sum)
  };
}

const out = {
  games: {},
  umpires,
  source: INPUT,
  updatedAt: new Date().toISOString()
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + "\n");

console.log("UMPIRE STRIKE-ZONE IMPORT");
console.log("=========================");
console.log(`Input: ${INPUT}`);
console.log(`Games mapped: ${Object.keys(out.games).length}`);
console.log(`Umpires mapped: ${Object.keys(out.umpires).length}`);
console.log(`Wrote ${OUTPUT}`);
