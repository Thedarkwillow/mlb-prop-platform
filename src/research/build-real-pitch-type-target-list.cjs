const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BOARD = "outputs/priced-board.json";
const OUT = `outputs/context/real-pitch-type-target-list-${date}.json`;
const LATEST = "outputs/context/real-pitch-type-target-list-latest.json";

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

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function clean(v) {
  return String(v || "").trim();
}

function market(row) {
  return String(row.market || row.stat || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function isPricingSummary(row) {
  return row?.recordType === "pricing_summary";
}

function isRealPitchTypeScored(row) {
  if (row.pitchTypeNeutralFallback === true) return false;

  const tier = String(row.pitchTypeMatchupTier || "").toLowerCase();
  const source = String(row.pitchTypeSource || "").toUpperCase();
  const score = Number(row.pitchTypeMatchupScore);

  if (row.pitchTypeMatchupScored === true && tier !== "neutral" && tier !== "unknown") {
    return true;
  }

  if (row.pitchTypeMatchupReady === true && source !== "NEUTRAL_FALLBACK") {
    return true;
  }

  if (row.pitchTypePitcherArsenal && typeof row.pitchTypePitcherArsenal === "object") {
    return true;
  }

  if (Number.isFinite(score) && score !== 0 && tier !== "neutral" && tier !== "unknown") {
    return true;
  }

  return false;
}


function isLikelyHitterStrikeoutRow(row) {
  const m = market(row);
  const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();

  if (sourceType === "pitcher") return false;
  if (!(m.includes("strikeout") || String(row.stat || row.stat_short || "").toLowerCase().includes("strikeout"))) {
    return false;
  }

  // Hitter K rows usually have an opposing pitcher context.
  if (
    row.opponentPitcher ||
    row.opposingPitcher ||
    row.probablePitcher ||
    row.handednessContext?.opposingPitcher ||
    row.handednessAdjustment?.opposingPitcher
  ) {
    return true;
  }

  // If the row is not explicitly a pitcher and has no pitcher identifiers,
  // do not let strikeouts become pitcher arsenal targets.
  const hasPitcherId =
    row.pitcherId ||
    row.playerPitcherId ||
    row.mlbamId ||
    row.playerMlbamId ||
    row.pitcherMlbamId ||
    row.opposingPitcherId ||
    row.opponentPitcherId;

  return !hasPitcherId;
}

function isPitcherMarket(row) {
  const m = String(row.market || row.stat || row.stat_short || "").toLowerCase();
  const stat = String(row.stat || row.stat_short || "").toLowerCase();
  const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();
  const player = clean(row.player || row.playerName || row.name);

  const pitcherMarkets = [
    "pitching_outs",
    "hits_allowed",
    "earned_runs_allowed",
    "walks_allowed",
    "pitcher_fantasy",
    "pitches_thrown"
  ];

  if (pitcherMarkets.some(x => m.includes(x) || stat.includes(x))) return true;

  // Plain strikeouts can be hitter Ks or pitcher Ks.
  // Do not trust dirty sourceType alone for this market.
  if (m === "strikeouts" || stat === "strikeouts" || m.includes("strikeout") || stat.includes("strikeout")) {
    const hasPitcherId =
      row.pitcherId ||
      row.playerPitcherId ||
      row.pitcherMlbamId ||
      row.playerMlbamId ||
      row.mlbamId;

    const hasOpposingPitcher =
      row.pitchTypeOpponentPitcher ||
      row.opponentPitcher ||
      row.opposingPitcher ||
      row.probablePitcher ||
      row.handednessContext?.opposingPitcher ||
      row.handednessAdjustment?.opposingPitcher;

    // If the row has an opposing pitcher, it is a batter strikeout matchup.
    if (hasOpposingPitcher) return false;

    // SourceType can be dirty, so require either pitcher ID or no hitter-style context.
    return Boolean(hasPitcherId && sourceType === "pitcher");
  }

  if (sourceType === "batter" || sourceType === "hitter") return false;
  if (sourceType === "pitcher") return true;

  return false;
}

function reason(row) {
  const flags = Array.isArray(row.pitchTypeMatchupFlags) ? row.pitchTypeMatchupFlags : [];
  const joined = flags.join(" | ");
  if (joined.includes("COMBO_OR_TEAM_ROW")) return "COMBO_OR_TEAM_ROW";
  if (joined.includes("MISSING_OPPOSING_PITCHER")) return "MISSING_OPPOSING_PITCHER";

  // Do not trust stale/dirty pitcher-arsenal flags on hitter rows.
  // Some PrizePicks batter strikeout rows arrive with sourceType="pitcher".
  // Reclassify those as hitter matchup targets unless isPitcherMarket(row) confirms true.
  if (joined.includes("MISSING_PITCHER_PROP_ARSENAL")) {
    return isPitcherMarket(row)
      ? "MISSING_PITCHER_PROP_ARSENAL"
      : "MISSING_HITTER_OR_MATCHUP";
  }

  if (joined.includes("MISSING_HITTER_OR_MATCHUP")) return "MISSING_HITTER_OR_MATCHUP";
  if (isPitcherMarket(row)) return "MISSING_PITCHER_PROP_ARSENAL";
  if (!clean(row.pitchTypeOpponentPitcher || row.opponentPitcher || row.probablePitcher || row.opposingPitcher)) {
    return "MISSING_OPPOSING_PITCHER";
  }
  return "MISSING_HITTER_OR_MATCHUP";
}

function addTarget(map, key, payload) {
  if (!key) return;
  if (!map.has(key)) {
    map.set(key, {
      key,
      type: payload.type,
      player: payload.player || null,
      pitcher: payload.pitcher || null,
      team: payload.team || null,
      opponent: payload.opponent || null,
      game: payload.game || null,
      reason: payload.reason,
      rows: 0,
      markets: {},
      tiers: {},
      examples: []
    });
  }

  const t = map.get(key);
  t.rows += 1;
  t.markets[payload.market] = (t.markets[payload.market] || 0) + 1;
  t.tiers[payload.tier || "unknown"] = (t.tiers[payload.tier || "unknown"] || 0) + 1;

  if (t.examples.length < 10) {
    t.examples.push({
      player: payload.player || null,
      pitcher: payload.pitcher || null,
      team: payload.team || null,
      opponent: payload.opponent || null,
      game: payload.game || null,
      market: payload.market || null,
      side: payload.side || null,
      line: payload.line ?? null,
      tier: payload.tier || null
    });
  }
}

const raw = readJson(BOARD, []);
const rows = raw.filter(r => r && typeof r === "object" && !isPricingSummary(r));
const missing = rows.filter(r => !isRealPitchTypeScored(r));

const pitcherTargets = new Map();
const hitterMatchupTargets = new Map();
const missingOpponentTargets = new Map();
const comboRows = [];

for (const row of missing) {
  const r = reason(row);
  const m = market(row);
  const player = clean(row.player || row.playerName || row.name);
  const playerKey = norm(player);
  const team = clean(row.team || row.resolvedTeam);
  const opponent = clean(row.opponent || row.resolvedOpponent);
  const game = clean(row.resolvedGame || row.game);
  const tier = clean(row.oddsTier || row.odds_tier || row.tier);
  const side = clean(row.recommendedSide || row.side);
  const pitcher = clean(row.pitchTypeOpponentPitcher || row.opponentPitcher || row.probablePitcher || row.opposingPitcher);
  const pitcherKey = norm(pitcher);

  const payload = {
    player,
    pitcher,
    team,
    opponent,
    game,
    market: m,
    side,
    line: row.line,
    tier,
    reason: r
  };

  if (r === "MISSING_PITCHER_PROP_ARSENAL") {
    addTarget(pitcherTargets, playerKey, {
      ...payload,
      type: "pitcher_arsenal",
      pitcher: player
    });
  } else if (r === "MISSING_HITTER_OR_MATCHUP") {
    addTarget(hitterMatchupTargets, `${playerKey}__${pitcherKey || norm(opponent)}`, {
      ...payload,
      type: "hitter_vs_pitcher_matchup"
    });
  } else if (r === "MISSING_OPPOSING_PITCHER") {
    addTarget(missingOpponentTargets, `${team}__${game}`, {
      ...payload,
      type: "missing_opposing_pitcher"
    });
  } else {
    comboRows.push(payload);
  }
}

function finalize(map) {
  return [...map.values()]
    .map(t => ({
      ...t,
      marketList: Object.entries(t.markets).sort((a, b) => b[1] - a[1]).map(([market, count]) => ({ market, count })),
      tierList: Object.entries(t.tiers).sort((a, b) => b[1] - a[1]).map(([tier, count]) => ({ tier, count }))
    }))
    .sort((a, b) => b.rows - a.rows);
}

const report = {
  date,
  generatedAt: new Date().toISOString(),
  sourceBoard: BOARD,
  counts: {
    boardRows: rows.length,
    realScoredRows: rows.filter(isRealPitchTypeScored).length,
    missingRows: missing.length,
    pitcherArsenalTargets: pitcherTargets.size,
    hitterMatchupTargets: hitterMatchupTargets.size,
    missingOpponentTargets: missingOpponentTargets.size,
    comboRows: comboRows.length
  },
  pitcherArsenalTargets: finalize(pitcherTargets),
  hitterMatchupTargets: finalize(hitterMatchupTargets),
  missingOpponentTargets: finalize(missingOpponentTargets),
  comboRows: comboRows.slice(0, 100)
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("REAL PITCH TYPE TARGET LIST");
console.log("---------------------------");
console.log(report.counts);

console.log("\\nTop pitcher arsenal targets:");
console.table(report.pitcherArsenalTargets.slice(0, 20).map(r => ({
  pitcher: r.pitcher || r.player,
  team: r.team,
  rows: r.rows,
  topMarket: r.marketList[0]?.market,
  reason: r.reason
})));

console.log("\\nTop hitter matchup targets:");
console.table(report.hitterMatchupTargets.slice(0, 20).map(r => ({
  player: r.player,
  pitcher: r.pitcher,
  team: r.team,
  game: r.game,
  rows: r.rows,
  topMarket: r.marketList[0]?.market,
  reason: r.reason
})));

console.log("\\nTop missing opposing pitcher targets:");
console.table(report.missingOpponentTargets.slice(0, 20).map(r => ({
  team: r.team,
  game: r.game,
  rows: r.rows,
  topMarket: r.marketList[0]?.market,
  reason: r.reason
})));

console.log("saved:", OUT);
console.log("saved:", LATEST);
