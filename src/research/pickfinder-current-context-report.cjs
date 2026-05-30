const fs = require("fs");

const IN = "outputs/priced-board.json";
const OUT_JSON = "outputs/manual/pickfinder-current-context-report.json";
const OUT_TXT = "outputs/manual/pickfinder-current-context-report.txt";

const HITTER_MARKETS = new Set([
  "hrr",
  "bases",
  "hits",
  "runs",
  "rbis",
  "walks",
  "singles",
  "doubles",
  "triples",
  "home_runs",
  "hitter_fantasy_score",
  "hitter_strikeouts"
]);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function lower(v) {
  return String(v || "").toLowerCase();
}

function marketOf(r) {
  return lower(r.market || r.statType || r.type || r.projectionType || "");
}

function playerOf(r) {
  return r.player || r.playerName || r.name || "";
}

function teamOf(r) {
  return String(r.team || r.resolvedTeam || r.playerTeam || "").toUpperCase();
}

function gameText(r) {
  return String(r.game || r.resolvedGame || r.matchup || "");
}

function parseOpponentAndHomeAway(row) {
  const team = teamOf(row);
  const game = gameText(row);

  const m = game.match(/^(.+?)\s+@\s+(.+)$/);
  if (!team || !m) return { opponent: null, homeAway: null };

  const away = m[1].trim();
  const home = m[2].trim();

  const awayTeam = away.toUpperCase();
  const homeTeam = home.toUpperCase();

  if (awayTeam.includes(team) || team.includes(awayTeam)) {
    return { opponent: home, homeAway: "away" };
  }
  if (homeTeam.includes(team) || team.includes(homeTeam)) {
    return { opponent: away, homeAway: "home" };
  }

  return { opponent: null, homeAway: null };
}

function has(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}

const raw = readJson(IN, []);
const rows = Array.isArray(raw) ? raw : [];

const hitterRows = rows.filter(r => playerOf(r) && HITTER_MARKETS.has(marketOf(r)));

const enriched = hitterRows.map(r => {
  const parsed = parseOpponentAndHomeAway(r);

  return {
    player: playerOf(r),
    team: teamOf(r),
    market: marketOf(r),
    side: r.side || r.pickSide || r.direction || null,
    line: r.line ?? r.ppLine ?? r.projectionLine ?? null,
    game: gameText(r),
    gamePk: r.gamePk || r.mlbGamePk || r.gameId || null,
    opponent: r.opponent || r.opp || r.opposingTeam || parsed.opponent,
    homeAway: r.homeAway || r.home_away || parsed.homeAway,
    opposingPitcher: r.opposingPitcher || r.probablePitcher || r.opponentPitcher || null,
    opposingPitcherHand: r.opposingPitcherHand || r.pitcherHand || r.opponentPitcherHand || null,
    battingOrder: r.battingOrder || r.lineupSpot || r.battingPosition || null
  };
});

function coverage(field) {
  const count = enriched.filter(r => has(r[field])).length;
  return {
    count,
    pct: enriched.length ? Math.round((count / enriched.length) * 10000) / 100 : null
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: "CURRENT_BOARD_CONTEXT_COVERAGE_NO_API",
  source: IN,
  rows: enriched.length,
  coverage: {
    game: coverage("game"),
    gamePk: coverage("gamePk"),
    opponent: coverage("opponent"),
    homeAway: coverage("homeAway"),
    opposingPitcher: coverage("opposingPitcher"),
    opposingPitcherHand: coverage("opposingPitcherHand"),
    battingOrder: coverage("battingOrder")
  },
  sample: enriched.slice(0, 50),
  missingPitcherSample: enriched.filter(r => !has(r.opposingPitcher) || !has(r.opposingPitcherHand)).slice(0, 50)
};

const lines = [];
lines.push("PICK FINDER CURRENT CONTEXT REPORT");
lines.push("==================================");
lines.push(`mode: ${report.mode}`);
lines.push(`current hitter rows: ${report.rows}`);
lines.push("");
lines.push("COVERAGE");
lines.push("--------");
for (const [field, c] of Object.entries(report.coverage)) {
  lines.push(`- ${field}: ${c.count}/${report.rows} (${c.pct ?? "n/a"}%)`);
}
lines.push("");
lines.push("INTERPRETATION");
lines.push("--------------");
if (report.coverage.homeAway.pct >= 80 && report.coverage.opponent.pct >= 80) {
  lines.push("- current board can support home/away and opponent logic");
} else {
  lines.push("- current board still needs home/away/opponent enrichment");
}
if (report.coverage.opposingPitcher.pct >= 80 && report.coverage.opposingPitcherHand.pct >= 80) {
  lines.push("- current board can support vs-pitcher and handedness logic");
} else {
  lines.push("- current board still needs opposing pitcher and pitcher hand enrichment");
}
lines.push("");
lines.push("NEXT");
lines.push("----");
lines.push("Use this result to decide whether to enrich current board first or backfill history.");

fs.mkdirSync("outputs/manual", { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
