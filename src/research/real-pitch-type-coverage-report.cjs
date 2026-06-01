const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BOARD = "outputs/priced-board.json";
const OUT = `outputs/context/real-pitch-type-coverage-${date}.json`;
const LATEST = "outputs/context/real-pitch-type-coverage-latest.json";

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

function pct(n, d) {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function market(row) {
  return String(row.market || row.stat || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function isPitcherMarket(row) {
  const m = market(row);
  const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();
  const rawStat = String(row.stat || row.stat_short || row.market || "").toLowerCase();

  if (sourceType === "pitcher") return true;
  if (sourceType === "batter" || sourceType === "hitter") return false;

  if (
    m.includes("pitching_outs") ||
    m.includes("hits_allowed") ||
    m.includes("earned_runs_allowed") ||
    m.includes("walks_allowed") ||
    m.includes("pitches_thrown") ||
    m.includes("pitcher_fantasy")
  ) {
    return true;
  }

  if (m === "strikeouts" || m === "pitcher_strikeouts") {
    if (
      rawStat.includes("hitter") ||
      rawStat.includes("batter") ||
      String(row.projectionSource || "").toLowerCase().includes("hitter")
    ) {
      return false;
    }
    return true;
  }

  return false;
}

function isComboRow(row) {
  const player = String(row.player || row.playerName || "");
  const team = String(row.team || row.resolvedTeam || "");
  return player.includes("+") || team.includes("/") || market(row).startsWith("1st_inning");
}

function reason(row) {
  const flags = Array.isArray(row.pitchTypeMatchupFlags)
    ? row.pitchTypeMatchupFlags.join(",")
    : String(row.pitchTypeMatchupFlags || "");

  if (row.pitchTypeMatchupScored === true && row.pitchTypeNeutralFallback !== true) {
    return "REAL_SCORED";
  }

  if (isComboRow(row)) return "COMBO_OR_TEAM_ROW";
  if (isPitcherMarket(row) && flags.includes("MISSING_PITCHER_PROP_ARSENAL")) {
    return "MISSING_PITCHER_PROP_ARSENAL";
  }
  if (!isPitcherMarket(row) && flags.includes("MISSING_HITTER_OR_PITCHER_ARSENAL")) {
    return "MISSING_HITTER_OR_MATCHUP";
  }
  if (!row.pitchTypeOpponentPitcher && !isPitcherMarket(row)) {
    return "MISSING_OPPOSING_PITCHER";
  }
  if (row.pitchTypeNeutralFallback === true) return "NEUTRAL_FALLBACK_OTHER";
  return "UNKNOWN_NOT_REAL_SCORED";
}

function topCounts(rows, fn, limit = 30) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r) || "UNKNOWN";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function sample(rows, limit = 30) {
  return rows.slice(0, limit).map(r => ({
    player: r.player || r.playerName || null,
    playerKey: norm(r.player || r.playerName),
    team: r.team || r.resolvedTeam || null,
    opponent: r.opponent || r.resolvedOpponent || null,
    game: r.resolvedGame || r.game || null,
    market: market(r),
    side: r.side || r.recommendedSide || null,
    line: r.line ?? null,
    tier: r.oddsTier || r.tier || null,
    pitcher: r.pitchTypeOpponentPitcher || r.opponentPitcher || null,
    source: r.pitchTypeMatchupSource || null,
    score: r.pitchTypeMatchupScore ?? null,
    scored: r.pitchTypeMatchupScored === true,
    neutralFallback: r.pitchTypeNeutralFallback === true,
    reason: reason(r),
    flags: Array.isArray(r.pitchTypeMatchupFlags)
      ? r.pitchTypeMatchupFlags
      : []
  }));
}

const raw = readJson(BOARD, []);
const rows = raw.filter(r => r && typeof r === "object" && r.recordType !== "pricing_summary");

const realScored = rows.filter(r => r.pitchTypeMatchupScored === true && r.pitchTypeNeutralFallback !== true);
const neutralFallback = rows.filter(r => r.pitchTypeNeutralFallback === true);
const pitcherRows = rows.filter(isPitcherMarket);
const hitterRows = rows.filter(r => !isPitcherMarket(r));
const notReal = rows.filter(r => !(r.pitchTypeMatchupScored === true && r.pitchTypeNeutralFallback !== true));

const byReason = topCounts(notReal, reason, 50);

const report = {
  date,
  generatedAt: new Date().toISOString(),
  boardFile: BOARD,
  counts: {
    rows: rows.length,
    realScored: realScored.length,
    neutralFallback: neutralFallback.length,
    pitcherRows: pitcherRows.length,
    hitterRows: hitterRows.length,
    notRealScored: notReal.length
  },
  percentages: {
    realScoredPct: pct(realScored.length, rows.length),
    neutralFallbackPct: pct(neutralFallback.length, rows.length),
    notRealScoredPct: pct(notReal.length, rows.length)
  },
  byReason,
  missing: {
    byMarket: topCounts(notReal, r => market(r)),
    byPlayer: topCounts(notReal, r => r.player || r.playerName),
    byGame: topCounts(notReal, r => r.resolvedGame || r.game),
    pitcherMarketByPlayer: topCounts(notReal.filter(isPitcherMarket), r => r.player || r.playerName),
    hitterMarketByPlayer: topCounts(notReal.filter(r => !isPitcherMarket(r)), r => r.player || r.playerName),
    sample: sample(notReal, 40)
  }
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("REAL PITCH TYPE COVERAGE REPORT");
console.log("-------------------------------");
console.table([{
  rows: report.counts.rows,
  realScored: report.counts.realScored,
  neutralFallback: report.counts.neutralFallback,
  notRealScored: report.counts.notRealScored,
  realScoredPct: report.percentages.realScoredPct,
  neutralFallbackPct: report.percentages.neutralFallbackPct
}]);

console.log("By reason:");
console.table(report.byReason);

console.log("Missing by market:");
console.table(report.missing.byMarket.slice(0, 15));

console.log("Missing pitcher-market players:");
console.table(report.missing.pitcherMarketByPlayer.slice(0, 20));

console.log("Missing hitter-market players:");
console.table(report.missing.hitterMarketByPlayer.slice(0, 20));

console.log("Sample:");
console.table(report.missing.sample.slice(0, 20));

console.log("saved:", OUT);
console.log("saved:", LATEST);
