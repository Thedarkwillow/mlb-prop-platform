const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BOARD = "outputs/priced-board.json";
const UMP = "data/context/umpires.json";
const CATCHER = "data/context/catcher-framing.json";
const PITCH_ARSENAL = "data/savant/pitcher-arsenal-compact.json";
const PITCH_MATCHUPS = "data/savant/pitch-type-matchups.json";
const OUT = `outputs/context/context-source-key-audit-${date}.json`;
const LATEST = "outputs/context/context-source-key-audit-latest.json";

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
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normTeam(v) {
  return String(v || "").toUpperCase().trim();
}

function cleanGame(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .replace(/\bat\b/gi, "@")
    .trim();
}

function abbrGame(v) {
  const raw = cleanGame(v);
  if (!raw.includes("@")) return "";
  return raw.split("@").map(x => normTeam(x)).join(" @ ");
}

function inferOpponent(row) {
  const team = normTeam(row.resolvedTeam || row.team);
  const game = abbrGame(row.resolvedGame || row.game);
  if (!team || !game.includes("@")) return "";
  const [away, home] = game.split("@").map(normTeam);
  if (away === team) return home;
  if (home === team) return away;
  return "";
}

function isPitcherMarket(row) {
  const m = String(row.market || "").toLowerCase();
  return (
    m.includes("strikeout") ||
    m.includes("pitching") ||
    m.includes("outs") ||
    m.includes("earned_runs_allowed") ||
    m.includes("hits_allowed") ||
    m.includes("walks_allowed") ||
    m.includes("pitches_thrown") ||
    m.includes("pitcher_fantasy")
  );
}

function topCounts(rows, keyFn, limit = 20) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) || "unknown";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function sample(rows, limit = 20) {
  return rows.slice(0, limit).map(r => ({
    player: r.player || r.playerName || r.name,
    team: r.team || r.resolvedTeam,
    opponent: r.opponent || r.resolvedOpponent || inferOpponent(r),
    game: r.resolvedGame || r.game,
    market: r.market,
    side: r.side || r.recommendedSide,
    line: r.line,
    tier: r.oddsTier || r.tier,
    pitcher: r.opponentPitcher || r.probablePitcher || r.opposingPitcher || r.pitchTypeOpponentPitcher || null
  }));
}

const board = readJson(BOARD, []).filter(r => r && r.recordType === "merged_prop");
const ump = readJson(UMP, {});
const catcher = readJson(CATCHER, {});
const arsenal = readJson(PITCH_ARSENAL, {});
const pitchMatchups = readJson(PITCH_MATCHUPS, {});

const umpGames = Object.keys(ump.games || {});
const catcherTeams = Object.keys(catcher.teams || {});
const arsenalKeys = new Set(Object.keys(arsenal.pitchers || {}));
const matchupKeys = new Set(Object.keys(pitchMatchups.matchups || {}));

const boardGames = [...new Set(board.map(r => abbrGame(r.resolvedGame || r.game)).filter(Boolean))].sort();
const boardTeams = [...new Set(board.map(r => normTeam(r.resolvedTeam || r.team)).filter(Boolean))].sort();

const pitcherRows = board.filter(isPitcherMarket);
const hitterRows = board.filter(r => !isPitcherMarket(r));

const missingPitchType = board.filter(r => r.pitchTypeMatchupReady !== true);
const missingCatcher = board.filter(r => !(
  r.opponentCatcherFramingReady === true ||
  r.catcherFramingReady === true ||
  r.opponentCatcher ||
  r.opponentCatcherFramingTier ||
  r.opponentCatcherFramingRunValue !== undefined ||
  r.opponentCatcherFramingPct !== undefined
));
const missingUmpire = board.filter(r => !(
  r.umpireContextReady === true ||
  r.umpireFramingAdjusted === true ||
  r.umpire ||
  r.umpireName ||
  r.umpireKFactor !== undefined ||
  r.umpireFramingAdjustment !== undefined
));

const report = {
  date,
  generatedAt: new Date().toISOString(),
  counts: {
    boardRows: board.length,
    hitterRows: hitterRows.length,
    pitcherRows: pitcherRows.length,
    boardGames: boardGames.length,
    boardTeams: boardTeams.length,
    umpireGames: umpGames.length,
    catcherTeams: catcherTeams.length,
    arsenalPitchers: arsenalKeys.size,
    pitchMatchupKeys: matchupKeys.size,
    missingPitchType: missingPitchType.length,
    missingCatcher: missingCatcher.length,
    missingUmpire: missingUmpire.length
  },
  boardGames,
  sourceKeys: {
    umpireGames: umpGames.slice(0, 100),
    catcherTeams,
    arsenalPitcherSample: [...arsenalKeys].slice(0, 50),
    pitchMatchupSample: [...matchupKeys].slice(0, 50)
  },
  missing: {
    pitchType: {
      byMarket: topCounts(missingPitchType, r => r.market),
      byPitcherVsHitterMarket: topCounts(missingPitchType, r => isPitcherMarket(r) ? "pitcher_market" : "hitter_market"),
      byGame: topCounts(missingPitchType, r => abbrGame(r.resolvedGame || r.game)),
      sample: sample(missingPitchType, 30)
    },
    catcher: {
      byMarket: topCounts(missingCatcher, r => r.market),
      byGame: topCounts(missingCatcher, r => abbrGame(r.resolvedGame || r.game)),
      byTeam: topCounts(missingCatcher, r => normTeam(r.resolvedTeam || r.team)),
      sample: sample(missingCatcher, 30)
    },
    umpire: {
      byMarket: topCounts(missingUmpire, r => r.market),
      byGame: topCounts(missingUmpire, r => abbrGame(r.resolvedGame || r.game)),
      sample: sample(missingUmpire, 30)
    }
  }
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("CONTEXT SOURCE KEY AUDIT");
console.log("------------------------");
console.table([report.counts]);

console.log("\nBoard games:");
console.table(boardGames.map(game => ({ game })));

console.log("\nUmpire source games:");
console.table(umpGames.slice(0, 30).map(game => ({ game })));

console.log("\nCatcher source teams:");
console.table(catcherTeams.map(team => ({ team })));

console.log("\nMissing pitch type by market:");
console.table(report.missing.pitchType.byMarket.slice(0, 12));

console.log("\nMissing pitch type pitcher/hitter split:");
console.table(report.missing.pitchType.byPitcherVsHitterMarket);

console.log("\nMissing catcher by game:");
console.table(report.missing.catcher.byGame.slice(0, 12));

console.log("\nMissing umpire by game:");
console.table(report.missing.umpire.byGame.slice(0, 12));

console.log("\nPitch type sample missing:");
console.table(report.missing.pitchType.sample.slice(0, 15));

console.log("\nCatcher sample missing:");
console.table(report.missing.catcher.sample.slice(0, 15));

console.log("\nUmpire sample missing:");
console.table(report.missing.umpire.sample.slice(0, 15));

console.log("saved:", OUT);
console.log("saved:", LATEST);
