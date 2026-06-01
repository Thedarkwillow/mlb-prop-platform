const fs = require("fs");

const BOARD = "outputs/priced-board.json";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasAny(row, keys) {
  return keys.some(k => row[k] !== undefined && row[k] !== null && row[k] !== "");
}

function hasCatcher(row) {
  return row.opponentCatcherFramingReady === true ||
    row.catcherFramingReady === true ||
    hasAny(row, [
      "opponentCatcher",
      "opponentCatcherFramingTier",
      "opponentCatcherFramingRunValue",
      "opponentCatcherFramingPct"
    ]);
}

function hasUmpire(row) {
  return row.umpireContextReady === true ||
    row.umpireFramingAdjusted === true ||
    hasAny(row, [
      "umpire",
      "plateUmpire",
      "umpireContext",
      "umpireFramingAdjustment",
      "umpireKFactor"
    ]);
}

function hasContextAdjusted(row) {
  return hasAny(row, [
    "contextAdjustedProjection",
    "contextAdjustment",
    "handednessAdjustment",
    "umpireFramingAdjustment"
  ]);
}

function projectionValue(row) {
  const vals = [
    row.contextAdjustedProjection,
    row.adjustedProjection,
    row.projection,
    row.rawProjection
  ];
  for (const v of vals) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
}

const raw = readJson(BOARD, []);
if (!Array.isArray(raw)) {
  console.error(`Expected ${BOARD} to be an array`);
  process.exit(1);
}

let boardRows = 0;
let catcherAdded = 0;
let umpireAdded = 0;
let contextAdjustedAdded = 0;

const out = raw.map(row => {
  if (!row || typeof row !== "object" || row.recordType === "pricing_summary") return row;

  boardRows++;
  let next = { ...row };

  if (!hasCatcher(next)) {
    catcherAdded++;
    next = {
      ...next,
      opponentCatcherFramingReady: true,
      opponentCatcherFramingSource: "NEUTRAL_FALLBACK",
      opponentCatcher: next.opponentCatcher || "Unknown",
      opponentCatcherFramingTier: "NEUTRAL",
      opponentCatcherFramingRunValue: 0,
      opponentCatcherFramingPct: null,
      opponentCatcherFramingAdjustment: 0
    };
  }

  if (!hasUmpire(next)) {
    umpireAdded++;
    next = {
      ...next,
      umpireContextReady: true,
      umpireContextSource: "NEUTRAL_FALLBACK",
      umpire: next.umpire || next.plateUmpire || "Unknown",
      plateUmpire: next.plateUmpire || next.umpire || "Unknown",
      umpireKFactor: 0,
      umpireFramingAdjustment: 0,
      umpireFramingAdjusted: false,
      umpireContext: {
        source: "NEUTRAL_FALLBACK",
        note: "No confirmed plate umpire context attached; neutral zero adjustment used.",
        kFactor: 0,
        kBoost: false,
        kDowngrade: false
      }
    };
  }

  if (!hasContextAdjusted(next)) {
    const proj = projectionValue(next);
    contextAdjustedAdded++;
    next = {
      ...next,
      contextAdjustedProjection: proj,
      contextAdjustment: {
        source: "NEUTRAL_FALLBACK",
        projectionDeltaPct: 0,
        probDelta: 0,
        flags: ["NEUTRAL_CONTEXT_FALLBACK"]
      },
      contextAdjustedReady: true
    };
  } else if (next.contextAdjustedReady === undefined) {
    next.contextAdjustedReady = true;
  }

  return next;
});

writeJson(BOARD, out);

console.log("NEUTRAL CONTEXT FALLBACK ATTACHER");
console.log("---------------------------------");
console.table([{
  boardRows,
  catcherAdded,
  umpireAdded,
  contextAdjustedAdded
}]);
console.log("saved:", BOARD);
