const fs = require("fs");

const BOARD = "outputs/priced-board.json";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function market(row) {
  return String(row.market || row.stat || "").toLowerCase().trim();
}

function sourceType(row) {
  return String(row.sourceType || row.playerType || row.recordSourceType || "")
    .toLowerCase()
    .trim();
}

function isPitcherMarket(row) {
  const m = market(row);
  const st = sourceType(row);
  const position = String(row.position || row.playerPosition || "").toUpperCase().trim();

  if (st === "pitcher" || position === "P") return true;

  return [
    "strikeouts",
    "pitcher_strikeouts",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score",
    "walks_allowed",
    "hits_allowed",
    "earned_runs_allowed",
    "runs_allowed",
    "1st_inning_runs_allowed",
    "1st_inning_walks_allowed",
    "1st_inning_pitches_thrown"
  ].includes(m);
}

function isHitterPitchEligible(row) {
  if (!row || row.recordType !== "merged_prop") return false;
  if (row.comboProp === true) return false;
  if (row.contextEligible === false) return false;
  if (isPitcherMarket(row)) return false;

  return [
    "hits",
    "bases",
    "hrr",
    "runs",
    "rbis",
    "singles",
    "doubles",
    "triples",
    "hr",
    "home_runs",
    "walks",
    "stolen_bases",
    "hitter_fantasy_score",
    "hitter_strikeouts"
  ].includes(market(row));
}

function hasOpponentPitcher(row) {
  return Boolean(
    row.pitchTypeOpponentPitcher ||
    row.opposingPitcher ||
    row.opponentPitcher ||
    row.probableOpponentPitcher ||
    row.pitcher
  );
}

function hasOpponentPitcherHand(row) {
  return Boolean(
    row.pitchTypeOpponentPitcherHand ||
    row.opposingPitcherHand ||
    row.opponentPitcherHand ||
    row.pitcherHand
  );
}

function flags(row) {
  return Array.isArray(row.pitchTypeMatchupFlags) ? row.pitchTypeMatchupFlags : [];
}

function isMissingHitterProfileOrMatchup(row) {
  const f = flags(row);
  return (
    f.includes("MISSING_HITTER_PROFILE") ||
    f.includes("MISSING_HITTER_PITCH_TYPE_MATCHUP") ||
    row.pitchTypeMatchupScored !== true
  );
}

const board = readJson(BOARD, []);
let eligible = 0;
let alreadyScored = 0;
let patched = 0;
let skippedNoPitcher = 0;
let skippedNoHand = 0;
let skippedOther = 0;

const nextBoard = board.map(row => {
  if (!isHitterPitchEligible(row)) return row;

  eligible++;

  if (row.pitchTypeMatchupScored === true) {
    alreadyScored++;
    return row;
  }

  if (!hasOpponentPitcher(row)) {
    skippedNoPitcher++;
    return row;
  }

  if (!hasOpponentPitcherHand(row)) {
    skippedNoHand++;
    return row;
  }

  if (!isMissingHitterProfileOrMatchup(row)) {
    skippedOther++;
    return row;
  }

  patched++;

  const existingFlags = flags(row);
  const fallbackReason = existingFlags.includes("MISSING_HITTER_PROFILE")
    ? "NEUTRAL_HITTER_PROFILE_FALLBACK"
    : "NEUTRAL_HITTER_MATCHUP_FALLBACK";

  return {
    ...row,
    pitchTypeMatchupAvailable: true,
    pitchTypeMatchupScored: true,
    pitchTypeMatchupTier: "neutral",
    pitchTypeMatchupScore: 0,
    pitchTypeMatchupSource: "NEUTRAL_HITTER_PROFILE_FALLBACK",
    pitchTypeSource: "NEUTRAL_HITTER_PROFILE_FALLBACK",
    pitchTypeNeutralFallback: true,
    pitchTypeFallbackApplied: true,
    pitchTypeMatchupFlags: [...new Set([
      ...existingFlags,
      fallbackReason,
      "NO_EDGE_ADDED"
    ])]
  };
});

writeJson(BOARD, nextBoard);

console.log("NEUTRAL PITCH TYPE FALLBACK SCORER");
console.log("==================================");
console.log({
  boardRows: board.length,
  eligible,
  alreadyScored,
  patched,
  skippedNoPitcher,
  skippedNoHand,
  skippedOther,
  note: "Patched rows are neutral score=0 fallback only. No boost/downgrade edge added."
});
