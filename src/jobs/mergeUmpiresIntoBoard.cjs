const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const boardPath = "outputs/priced-board.json";
const umpirePath = "data/context/umpires.json";

const board = readJson(boardPath, []);
const umpires = readJson(umpirePath, { games: {}, umpires: {} });

let matched = 0;

const out = board.map(row => {
  const game = row.resolvedGame || row.game || "";
  const gameKey = norm(game);
  const ump = umpires.games?.[gameKey];

  if (!ump) {
    return {
      ...row,
      umpireContextReady: false
    };
  }

  matched++;

  return {
    ...row,
    umpireContextReady: true,
    plateUmpire: ump.umpire,
    umpireKFactor: Number(ump.kFactor || 0),
    umpireKBoost: !!ump.kBoost,
    umpireKDowngrade: !!ump.kDowngrade,
    umpireAccuracyAboveX: ump.accuracyAboveX ?? null,
    umpireOverallAccuracy: ump.overallAccuracy ?? ump.accuracy ?? null,
    umpireConsistency: ump.consistency ?? null,
    umpireRunImpact: ump.runImpact ?? null,
    umpireSampleGames: ump.sampleGames ?? null,
    umpireAssignmentStatus: ump.assignmentStatus || null
  };
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

console.log("UMPIRE CONTEXT MERGE REPORT");
console.log("===========================");
console.log({
  boardRows: board.length,
  umpireGames: Object.keys(umpires.games || {}).length,
  matchedRows: matched,
  matchRate: board.length ? Number((matched / board.length).toFixed(4)) : 0
});
