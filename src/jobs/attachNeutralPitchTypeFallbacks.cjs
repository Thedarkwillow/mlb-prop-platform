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

function isPricingSummary(row) {
  return row?.recordType === "pricing_summary";
}

function hasPitchType(row) {
  return row.pitchTypeMatchupReady === true ||
    row.pitchTypeMatchupScored === true ||
    row.pitchTypeNeutralFallback === true ||
    row.pitchTypeMatchupScore !== undefined ||
    row.pitchTypeMatchupTier ||
    row.pitchTypePrimaryPitches ||
    row.pitchTypePitcherArsenal;
}

function marketType(row) {
  const m = String(row.market || "").toLowerCase();
  if (
    m.includes("strikeout") ||
    m.includes("pitching") ||
    m.includes("outs") ||
    m.includes("earned_runs_allowed") ||
    m.includes("hits_allowed") ||
    m.includes("walks_allowed") ||
    m.includes("pitcher_fantasy_score")
  ) return "pitcher";
  return "hitter";
}

const board = readJson(BOARD, []);
let added = 0;

const out = board.map(row => {
  if (!row || typeof row !== "object" || isPricingSummary(row)) return row;
  if (hasPitchType(row)) return row;

  added++;

  const type = marketType(row);

  return {
    ...row,

    pitchTypeMatchupEligible: true,
    pitchTypeMatchupAvailable: false,
    pitchTypeMatchupReady: true,
    pitchTypeMatchupScored: false,
    pitchTypeNeutralFallback: true,
    pitchTypeMatchupSource: "NEUTRAL_FALLBACK",

    pitchTypeMatchupTier: "neutral",
    pitchTypeMatchupScore: 0,
    pitchTypeMatchupFlags: [
      ...(Array.isArray(row.pitchTypeMatchupFlags) ? row.pitchTypeMatchupFlags : []),
      type === "pitcher"
        ? "PITCH_TYPE_NEUTRAL_FALLBACK_MISSING_PITCHER_ARSENAL"
        : "PITCH_TYPE_NEUTRAL_FALLBACK_MISSING_HITTER_OR_MATCHUP"
    ],

    pitchTypePrimaryPitches: [],
    pitchTypeContextNote:
      "Neutral fallback only. No pitch-type edge or downgrade applied because true pitch-type matchup source was missing."
  };
});

writeJson(BOARD, out);

console.log("NEUTRAL PITCH TYPE FALLBACK ATTACHER");
console.log("------------------------------------");
console.table([{
  boardRows: board.filter(r => r && typeof r === "object" && !isPricingSummary(r)).length,
  pitchTypeFallbackAdded: added
}]);
console.log("saved:", BOARD);
