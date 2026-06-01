const fs = require("fs");
const path = require("path");

function getDateArg() {
  const flagDate = process.argv.find(a => /^--date=/.test(a));
  if (flagDate) return flagDate.split("=")[1];
  const positional = process.argv.slice(2).find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  return positional || process.env.npm_config_date || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);
}

const date = getDateArg();
const BOARD = "outputs/priced-board.json";
const OUT = `outputs/context/pitch-type-false-neutral-sanitize-${date}.json`;
const LATEST = "outputs/context/pitch-type-false-neutral-sanitize-latest.json";

function readJson(file, fallback) {
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

function player(row) {
  return row.player || row.playerName || row.name || row.description || null;
}

function market(row) {
  return String(row.market || row.stat || row.stat_short || "").toLowerCase();
}

function pitcher(row) {
  return (
    row.pitchTypeOpponentPitcher ||
    row.opposingPitcher ||
    row.opponentPitcher ||
    row.probablePitcher ||
    row.handednessContext?.opposingPitcher ||
    row.handednessAdjustment?.opposingPitcher ||
    player(row) ||
    null
  );
}

function isFalseNeutral(row) {
  if (row.pitchTypeNeutralFallback !== true) return false;
  if (row.pitchTypePitcherArsenalReady !== true) return false;
  if (!Array.isArray(row.pitchTypePrimaryPitches) || row.pitchTypePrimaryPitches.length === 0) return false;
  if (row.pitchTypeMatchupReady !== true) return false;
  if (row.pitchTypeMatchupAvailable !== true) return false;
  if (row.pitchTypeMatchupScored !== true) return false;
  return true;
}

function cleanFlags(flags) {
  if (!Array.isArray(flags)) return flags;
  return flags.filter(f => {
    const s = String(f || "");
    return (
      s !== "PITCH_TYPE_NEUTRAL_FALLBACK_MISSING_PITCHER_ARSENAL" &&
      s !== "PITCH_TYPE_NEUTRAL_FALLBACK" &&
      s !== "MISSING_PITCHER_PROP_ARSENAL"
    );
  });
}

const board = readJson(BOARD, []);
if (!Array.isArray(board)) {
  throw new Error("outputs/priced-board.json must be an array");
}

const changed = [];
let scanned = 0;

for (const row of board) {
  if (row.recordType && row.recordType !== "merged_prop") continue;
  scanned++;

  if (!isFalseNeutral(row)) continue;

  const before = {
    pitchTypeNeutralFallback: row.pitchTypeNeutralFallback,
    pitchTypeMatchupSource: row.pitchTypeMatchupSource,
    pitchTypeMatchupTier: row.pitchTypeMatchupTier,
    pitchTypeMatchupScore: row.pitchTypeMatchupScore,
    flags: row.pitchTypeMatchupFlags
  };

  row.pitchTypeNeutralFallback = false;
  row.pitchTypeMatchupSource = "REAL_PITCHER_ARSENAL";
  row.pitchTypeSource = "REAL_PITCHER_ARSENAL";
  row.pitchTypeContextNote = "Real pitcher arsenal attached; false neutral fallback label cleared.";
  row.pitchTypeMatchupFlags = cleanFlags(row.pitchTypeMatchupFlags);

  if (!row.pitchTypeMatchupTier || row.pitchTypeMatchupTier === "unknown") {
    row.pitchTypeMatchupTier = "neutral";
  }

  changed.push({
    player: player(row),
    team: row.team || row.resolvedTeam || null,
    game: row.game || row.resolvedGame || null,
    market: market(row),
    side: row.side || null,
    line: row.line ?? row.projection ?? row.value ?? null,
    tier: row.oddsTier || row.tier || row.projectionType || null,
    pitcher: pitcher(row),
    primaryPitches: row.pitchTypePrimaryPitches,
    before,
    after: {
      pitchTypeNeutralFallback: row.pitchTypeNeutralFallback,
      pitchTypeMatchupSource: row.pitchTypeMatchupSource,
      pitchTypeMatchupTier: row.pitchTypeMatchupTier,
      pitchTypeMatchupScore: row.pitchTypeMatchupScore,
      flags: row.pitchTypeMatchupFlags
    }
  });
}

fs.writeFileSync(BOARD, JSON.stringify(board, null, 2) + "\n");

const report = {
  date,
  generatedAt: new Date().toISOString(),
  board: BOARD,
  scanned,
  fixed: changed.length,
  fixedByMarket: changed.reduce((acc, r) => {
    acc[r.market] = (acc[r.market] || 0) + 1;
    return acc;
  }, {}),
  sample: changed.slice(0, 30)
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("PITCH TYPE FALSE-NEUTRAL SANITIZER");
console.log("----------------------------------");
console.table([{
  scanned,
  fixed: changed.length
}]);
console.log("Fixed by market:");
console.table(Object.entries(report.fixedByMarket).map(([market, count]) => ({ market, count })));
console.log("Sample fixed:");
console.table(report.sample.slice(0, 12).map(r => ({
  player: r.player,
  team: r.team,
  market: r.market,
  side: r.side,
  line: r.line,
  pitcher: r.pitcher
})));
console.log(`saved: ${OUT}`);
console.log(`saved: ${LATEST}`);
