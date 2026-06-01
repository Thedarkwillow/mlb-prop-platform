const fs = require("fs");
const path = require("path");

function getDateArg() {
  const argvDate = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const flagDate = process.argv.find(a => /^--date=/.test(a));
  if (flagDate) return flagDate.split("=")[1];
  return (
    argvDate ||
    process.env.npm_config_date ||
    process.env.SLATE_DATE ||
    new Date().toISOString().slice(0, 10)
  );
}

const date = getDateArg();
const BOARD = "outputs/priced-board.json";
const OUT = `outputs/context/real-context-quality-audit-${date}.json`;
const LATEST = "outputs/context/real-context-quality-audit-latest.json";

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

function pct(n, d) {
  if (!d) return "0.0%";
  return `${((Number(n || 0) / Number(d || 0)) * 100).toFixed(1)}%`;
}

function clean(v) {
  return String(v || "").trim();
}

function upper(v) {
  return clean(v).toUpperCase();
}

function hasNumber(v) {
  return Number.isFinite(Number(v));
}

function player(row) {
  return row.player || row.playerName || row.name || null;
}

function market(row) {
  return String(row.market || row.stat || row.stat_short || "").toLowerCase();
}

function tier(row) {
  return row.oddsTier || row.tier || row.lineTier || null;
}

function game(row) {
  return row.game || row.resolvedGame || row.matchup || null;
}

function sampleRow(row, state, reason) {
  return {
    state,
    reason,
    player: player(row),
    team: row.team || row.resolvedTeam || null,
    game: game(row),
    market: market(row),
    side: row.side || null,
    line: row.line ?? row.ppLine ?? null,
    tier: tier(row),
    pitcher:
      row.pitchTypeOpponentPitcher ||
      row.opposingPitcher ||
      row.opponentPitcher ||
      row.probablePitcher ||
      row.handednessContext?.opposingPitcher ||
      null
  };
}

function classifyLineup(row) {
  if (
    row.lineupStrengthReady === true &&
    clean(row.lineupTier) &&
    hasNumber(row.lineupStrength) &&
    Number(row.lineupHitters || 0) > 0
  ) {
    return { state: "REAL", reason: "lineup_strength_ready" };
  }

  if (
    upper(row.lineupTier) === "NEUTRAL" ||
    row.lineupStrengthSource === "NEUTRAL_FALLBACK" ||
    row.lineupStrengthFallback === true
  ) {
    return { state: "NEUTRAL_FALLBACK", reason: "lineup_neutral_fallback" };
  }

  return { state: "MISSING", reason: "missing_lineup_strength" };
}

function classifyBullpen(row) {
  const ownReady =
    row.ownBullpenFatigueReady === true &&
    clean(row.ownBullpenFatigueTier) &&
    row.ownBullpenFatigue &&
    typeof row.ownBullpenFatigue === "object";

  const oppReady =
    row.opponentBullpenFatigueReady === true &&
    clean(row.opponentBullpenFatigueTier) &&
    row.opponentBullpenFatigue &&
    typeof row.opponentBullpenFatigue === "object";

  if (ownReady && oppReady) {
    return { state: "REAL", reason: "own_and_opponent_bullpen_fatigue_ready" };
  }

  if (
    row.bullpenFatigueSource === "NEUTRAL_FALLBACK" ||
    row.ownBullpenFatigueSource === "NEUTRAL_FALLBACK" ||
    row.opponentBullpenFatigueSource === "NEUTRAL_FALLBACK" ||
    upper(row.ownBullpenFatigueTier) === "NEUTRAL" ||
    upper(row.opponentBullpenFatigueTier) === "NEUTRAL"
  ) {
    return { state: "NEUTRAL_FALLBACK", reason: "bullpen_neutral_fallback" };
  }

  return { state: "MISSING", reason: "missing_bullpen_fatigue" };
}

function classifyCatcherFraming(row) {
  if (
    row.opponentCatcherFramingSource === "NEUTRAL_FALLBACK" ||
    upper(row.opponentCatcher) === "UNKNOWN" ||
    upper(row.opponentCatcherFramingTier) === "UNKNOWN"
  ) {
    return { state: "NEUTRAL_FALLBACK", reason: "catcher_framing_neutral_fallback" };
  }

  if (
    row.opponentCatcherFramingReady === true &&
    clean(row.opponentCatcher) &&
    clean(row.opponentCatcherFramingTier) &&
    hasNumber(row.opponentCatcherFramingRunValue) &&
    hasNumber(row.opponentCatcherFramingPct)
  ) {
    return { state: "REAL", reason: "opponent_catcher_framing_ready" };
  }

  return { state: "MISSING", reason: "missing_catcher_framing" };
}

function classifyUmpire(row) {
  if (
    row.umpireContextSource === "NEUTRAL_FALLBACK" ||
    upper(row.umpire) === "UNKNOWN" ||
    upper(row.plateUmpire) === "UNKNOWN" ||
    row.umpireContext?.source === "NEUTRAL_FALLBACK"
  ) {
    return { state: "NEUTRAL_FALLBACK", reason: "umpire_neutral_fallback" };
  }

  if (
    row.umpireContextReady === true &&
    (clean(row.umpire) || clean(row.plateUmpire)) &&
    (hasNumber(row.umpireKFactor) || row.umpireContext)
  ) {
    return { state: "REAL", reason: "umpire_context_ready" };
  }

  return { state: "MISSING", reason: "missing_umpire_context" };
}

function classifyHandedness(row) {
  const ctx = row.handednessContext || row.handednessAdjustment || null;

  if (
    row.handednessSource === "NEUTRAL_FALLBACK" ||
    row.handednessFallback === true ||
    ctx?.source === "NEUTRAL_FALLBACK"
  ) {
    return { state: "NEUTRAL_FALLBACK", reason: "handedness_neutral_fallback" };
  }

  if (
    row.handednessMatched === true &&
    ctx &&
    typeof ctx === "object" &&
    (ctx.active || ctx.vsLHB || ctx.vsRHB || ctx.selectedSplit || ctx.batterStand || ctx.pitcherHand)
  ) {
    return { state: "REAL", reason: "handedness_context_matched" };
  }

  if (
    row.handednessReady === true &&
    ctx &&
    typeof ctx === "object"
  ) {
    return { state: "REAL", reason: "handedness_ready" };
  }

  return { state: "MISSING", reason: "missing_handedness_context" };
}

function classifyPitchType(row) {
  const source = upper(row.pitchTypeMatchupSource || row.pitchTypeSource);
  const tier = upper(row.pitchTypeMatchupTier);
  const score = Number(row.pitchTypeMatchupScore);

  if (
    row.pitchTypeNeutralFallback === true ||
    source === "NEUTRAL_FALLBACK"
  ) {
    return { state: "NEUTRAL_FALLBACK", reason: "pitch_type_neutral_fallback" };
  }

  if (
    row.pitchTypeMatchupScored === true &&
    tier &&
    tier !== "UNKNOWN" &&
    tier !== "NEUTRAL" &&
    Number.isFinite(score)
  ) {
    return { state: "REAL", reason: "pitch_type_matchup_scored" };
  }

  if (
    row.pitchTypeMatchupReady === true &&
    source &&
    source !== "NEUTRAL_FALLBACK"
  ) {
    return { state: "REAL", reason: "pitch_type_matchup_ready" };
  }

  if (
    row.pitchTypePitcherArsenalReady === true ||
    (row.pitchTypePitcherArsenal && typeof row.pitchTypePitcherArsenal === "object")
  ) {
    return { state: "REAL", reason: "pitcher_arsenal_ready" };
  }

  return { state: "MISSING", reason: "missing_pitch_type_context" };
}

const layers = {
  lineup: classifyLineup,
  bullpen: classifyBullpen,
  catcher_framing: classifyCatcherFraming,
  umpire: classifyUmpire,
  handedness: classifyHandedness,
  pitch_type: classifyPitchType
};

const board = readJson(BOARD, []);
const rows = (Array.isArray(board) ? board : []).filter(r => !r.recordType || r.recordType === "merged_prop");

const audit = {
  date,
  generatedAt: new Date().toISOString(),
  boardRows: rows.length,
  note: "Counts REAL vs NEUTRAL_FALLBACK vs MISSING using actual priced-board field names.",
  layers: {},
  summary: []
};

for (const [layer, fn] of Object.entries(layers)) {
  const counts = {
    REAL: 0,
    NEUTRAL_FALLBACK: 0,
    MISSING: 0
  };
  const byReason = {};
  const samples = {
    NEUTRAL_FALLBACK: [],
    MISSING: []
  };

  for (const row of rows) {
    const result = fn(row);
    const state = result.state || "MISSING";
    const reason = result.reason || "unknown";

    counts[state] = (counts[state] || 0) + 1;
    byReason[reason] = (byReason[reason] || 0) + 1;

    if (state !== "REAL" && samples[state] && samples[state].length < 20) {
      samples[state].push(sampleRow(row, state, reason));
    }
  }

  const entry = {
    layer,
    rows: rows.length,
    real: counts.REAL || 0,
    neutralFallback: counts.NEUTRAL_FALLBACK || 0,
    missing: counts.MISSING || 0,
    realPct: pct(counts.REAL, rows.length),
    fallbackPct: pct(counts.NEUTRAL_FALLBACK, rows.length),
    missingPct: pct(counts.MISSING, rows.length),
    byReason: Object.entries(byReason)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    samples
  };

  audit.layers[layer] = entry;
  audit.summary.push({
    layer,
    rows: entry.rows,
    real: entry.real,
    fallback: entry.neutralFallback,
    missing: entry.missing,
    realPct: entry.realPct,
    fallbackPct: entry.fallbackPct,
    missingPct: entry.missingPct
  });
}

writeJson(OUT, audit);
writeJson(LATEST, audit);

console.log("REAL CONTEXT QUALITY AUDIT");
console.log("--------------------------");
console.table(audit.summary);

for (const [layer, entry] of Object.entries(audit.layers)) {
  console.log(`\n${layer} reasons:`);
  console.table(entry.byReason.slice(0, 12));

  if (entry.samples.NEUTRAL_FALLBACK.length) {
    console.log(`${layer} neutral fallback sample:`);
    console.table(entry.samples.NEUTRAL_FALLBACK.slice(0, 8));
  }

  if (entry.samples.MISSING.length) {
    console.log(`${layer} missing sample:`);
    console.table(entry.samples.MISSING.slice(0, 8));
  }
}

console.log(`saved: ${OUT}`);
console.log(`saved: ${LATEST}`);
