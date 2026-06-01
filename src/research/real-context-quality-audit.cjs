const fs = require("fs");
const path = require("path");

const date =
  process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

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

function hasAny(row, keys) {
  return keys.some(k => row[k] !== undefined && row[k] !== null && row[k] !== "");
}

function flagIncludes(row, text) {
  const needle = String(text).toLowerCase();
  const flags = [
    ...(Array.isArray(row.contextFlags) ? row.contextFlags : []),
    ...(Array.isArray(row.pitchTypeMatchupFlags) ? row.pitchTypeMatchupFlags : []),
    ...(Array.isArray(row.flags) ? row.flags : []),
    ...(Array.isArray(row.warnings) ? row.warnings : [])
  ].map(x => String(x).toLowerCase());
  return flags.some(f => f.includes(needle));
}

function isFallback(row, layer) {
  const l = layer.toLowerCase();
  return (
    row[`${l}NeutralFallback`] === true ||
    row[`${l}Fallback`] === true ||
    row[`${l}Source`] === "NEUTRAL_FALLBACK" ||
    row[`${l}Source`] === "FALLBACK" ||
    flagIncludes(row, `${l}_neutral_fallback`) ||
    flagIncludes(row, `${l}_fallback`)
  );
}

function pitchTypeState(row) {
  const fallback =
    row.pitchTypeNeutralFallback === true ||
    String(row.pitchTypeSource || "").toUpperCase() === "NEUTRAL_FALLBACK" ||
    flagIncludes(row, "pitch_type_neutral_fallback");

  const tier = String(row.pitchTypeMatchupTier || "").toLowerCase();
  const score = Number(row.pitchTypeMatchupScore);

  const real =
    !fallback &&
    (
      row.pitchTypeMatchupScored === true ||
      row.pitchTypeMatchupReady === true ||
      (tier && tier !== "neutral" && tier !== "unknown") ||
      (Number.isFinite(score) && score !== 0) ||
      (row.pitchTypePitcherArsenal && typeof row.pitchTypePitcherArsenal === "object") ||
      (row.pitchTypePrimaryPitches && typeof row.pitchTypePrimaryPitches === "object")
    );

  if (real) return "REAL_SOURCE";
  if (fallback) return "NEUTRAL_FALLBACK";
  return "MISSING";
}

function lineupState(row) {
  const fallback = isFallback(row, "lineup") || flagIncludes(row, "lineup_neutral");
  const real = !fallback && (
    row.lineupReady === true ||
    row.lineupConfirmed === true ||
    row.confirmedLineup === true ||
    hasAny(row, ["battingOrder", "lineupSpot", "lineupSource", "lineupStatus"])
  );
  if (real) return "REAL_SOURCE";
  if (fallback) return "NEUTRAL_FALLBACK";
  return "MISSING";
}

function bullpenState(row) {
  const fallback = isFallback(row, "bullpen") || flagIncludes(row, "bullpen_neutral");
  const real = !fallback && (
    row.bullpenReady === true ||
    hasAny(row, ["bullpenFatigueTier", "bullpenTier", "opponentBullpenTier", "bullpenSource"])
  );
  if (real) return "REAL_SOURCE";
  if (fallback) return "NEUTRAL_FALLBACK";
  return "MISSING";
}

function catcherState(row) {
  const fallback = isFallback(row, "catcher") || flagIncludes(row, "catcher_neutral");
  const real = !fallback && (
    row.catcherFramingReady === true ||
    hasAny(row, ["catcherFramingTier", "catcherFramingScore", "catcher", "catcherSource"])
  );
  if (real) return "REAL_SOURCE";
  if (fallback) return "NEUTRAL_FALLBACK";
  return "MISSING";
}

function umpireState(row) {
  const fallback = isFallback(row, "umpire") || flagIncludes(row, "umpire_neutral");
  const real = !fallback && (
    row.umpireReady === true ||
    hasAny(row, ["umpireTier", "umpireScore", "umpire", "umpireSource"])
  );
  if (real) return "REAL_SOURCE";
  if (fallback) return "NEUTRAL_FALLBACK";
  return "MISSING";
}

function handednessState(row) {
  const fallback = isFallback(row, "handedness") || flagIncludes(row, "handedness_neutral");
  const real = !fallback && (
    row.handednessReady === true ||
    hasAny(row, ["pitcherHand", "opposingPitcherHand", "batterHand", "handednessContext", "handednessAdjustment"])
  );
  if (real) return "REAL_SOURCE";
  if (fallback) return "NEUTRAL_FALLBACK";
  return "MISSING";
}

function summarizeLayer(rows, name, fn) {
  const states = { REAL_SOURCE: 0, NEUTRAL_FALLBACK: 0, MISSING: 0, DERIVED_ONLY: 0 };
  const examples = { NEUTRAL_FALLBACK: [], MISSING: [], DERIVED_ONLY: [] };

  for (const row of rows) {
    const state = fn(row);
    states[state] = (states[state] || 0) + 1;

    if (state !== "REAL_SOURCE" && examples[state] && examples[state].length < 20) {
      examples[state].push({
        player: row.player || row.playerName || row.name || null,
        team: row.team || row.resolvedTeam || null,
        game: row.game || row.resolvedGame || null,
        market: row.market || row.stat || row.stat_short || null,
        side: row.side || null,
        line: row.line ?? row.value ?? null,
        tier: row.oddsTier || row.tier || null,
        pitcher: row.opposingPitcher || row.opponentPitcher || row.pitcher || null
      });
    }
  }

  return {
    layer: name,
    rows: rows.length,
    real: states.REAL_SOURCE,
    fallback: states.NEUTRAL_FALLBACK,
    missing: states.MISSING,
    derivedOnly: states.DERIVED_ONLY,
    realPct: pct(states.REAL_SOURCE, rows.length),
    fallbackPct: pct(states.NEUTRAL_FALLBACK, rows.length),
    missingPct: pct(states.MISSING, rows.length),
    examples
  };
}

const boardRaw = readJson(BOARD, []);
const rows = (Array.isArray(boardRaw) ? boardRaw : [])
  .filter(r => !r.recordType || r.recordType === "merged_prop");

const report = {
  date,
  generatedAt: new Date().toISOString(),
  boardRows: rows.length,
  layers: [
    summarizeLayer(rows, "lineup", lineupState),
    summarizeLayer(rows, "bullpen", bullpenState),
    summarizeLayer(rows, "catcher_framing", catcherState),
    summarizeLayer(rows, "umpire", umpireState),
    summarizeLayer(rows, "handedness", handednessState),
    summarizeLayer(rows, "pitch_type", pitchTypeState)
  ]
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("REAL CONTEXT QUALITY AUDIT");
console.log("--------------------------");
console.table(report.layers.map(l => ({
  layer: l.layer,
  rows: l.rows,
  real: l.real,
  fallback: l.fallback,
  missing: l.missing,
  realPct: l.realPct,
  fallbackPct: l.fallbackPct,
  missingPct: l.missingPct
})));

for (const layer of report.layers) {
  if (layer.fallback || layer.missing || layer.derivedOnly) {
    console.log(`\n${layer.layer} gaps:`);
    console.table([
      { state: "NEUTRAL_FALLBACK", count: layer.fallback },
      { state: "MISSING", count: layer.missing },
      { state: "DERIVED_ONLY", count: layer.derivedOnly }
    ]);
    const sample = [
      ...(layer.examples.NEUTRAL_FALLBACK || []),
      ...(layer.examples.MISSING || []),
      ...(layer.examples.DERIVED_ONLY || [])
    ].slice(0, 10);
    if (sample.length) console.table(sample);
  }
}

console.log(`saved: ${OUT}`);
console.log(`saved: ${LATEST}`);
