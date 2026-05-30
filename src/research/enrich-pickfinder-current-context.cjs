const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const PITCHERS = "data/context/probable-pitcher-hands.json";
const PITCHER_HAND_SOURCES = [
  "data/context/pitcher-stat-table.json",
  "data/context/pitcher-context-advanced.json",
  "data/context/pitching-staffs.json"
];
const OUT_JSON = "outputs/manual/pickfinder-current-context-enriched.json";
const OUT_TXT = "outputs/manual/pickfinder-current-context-enriched.txt";

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

function upper(v) {
  return String(v || "").toUpperCase();
}

function marketOf(r) {
  return lower(r.market || r.statType || r.type || r.projectionType || "");
}

function playerOf(r) {
  return r.player || r.playerName || r.name || "";
}

function teamOf(r) {
  return upper(r.team || r.resolvedTeam || r.playerTeam || "");
}

function has(v) {
  return v !== undefined && v !== null && String(v).trim() !== "";
}


function normName(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function flattenObjects(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flattenObjects(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    v.player ||
    v.playerName ||
    v.name ||
    v.pitcher ||
    v.pitcherName ||
    v.fullName
  ) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flattenObjects(val, out);
  }

  return out;
}

function buildPitcherHandLookup() {
  const byName = new Map();
  const byNameTeam = new Map();

  for (const file of PITCHER_HAND_SOURCES) {
    const raw = readJson(file, null);
    if (!raw) continue;

    const rows = flattenObjects(raw);
    for (const r of rows) {
      const name = r.name || r.pitcher || r.pitcherName || r.player || r.playerName || r.fullName;
      const hand = r.hand || r.throws || r.pitcherHand || r.throwingHand || r.p_throws || r.pitch_hand;
      const team = upper(r.team || r.playerTeam || "");

      if (!name || !hand) continue;

      const n = normName(name);
      const h = String(hand).toUpperCase().startsWith("L") ? "L" :
        String(hand).toUpperCase().startsWith("R") ? "R" :
        String(hand).toUpperCase();

      byName.set(n, h);
      if (team) byNameTeam.set(`${n}|${team}`, h);
    }
  }

  return { byName, byNameTeam };
}


function pitcherGames(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.games)) return raw.games;
  if (raw.games && typeof raw.games === "object") return Object.values(raw.games);
  return [];
}

function parseFromGameText(row) {
  const team = teamOf(row);
  const game = String(row.game || row.resolvedGame || row.matchup || "");

  const m = game.match(/^(.+?)\s+@\s+(.+)$/);
  if (!team || !m) return { opponent: null, homeAway: null };

  const away = m[1].trim();
  const home = m[2].trim();

  if (upper(away).includes(team) || team.includes(upper(away))) {
    return { opponent: home, homeAway: "away" };
  }
  if (upper(home).includes(team) || team.includes(upper(home))) {
    return { opponent: away, homeAway: "home" };
  }

  return { opponent: null, homeAway: null };
}

const board = readJson(BOARD, []);
const pitcherRaw = readJson(PITCHERS, {});
const games = pitcherGames(pitcherRaw);
const pitcherHands = buildPitcherHandLookup();

const gameByPk = new Map();
const gameByTeam = new Map();

for (const g of games) {
  if (!g || typeof g !== "object") continue;

  if (g.gamePk) gameByPk.set(String(g.gamePk), g);

  const away = upper(g.awayTeam);
  const home = upper(g.homeTeam);

  if (away) gameByTeam.set(away, g);
  if (home) gameByTeam.set(home, g);
}

function enrich(row) {
  const team = teamOf(row);
  const gamePk = row.gamePk || row.mlbGamePk || row.gameId || null;
  const parsed = parseFromGameText(row);

  const game =
    (gamePk && gameByPk.get(String(gamePk))) ||
    gameByTeam.get(team) ||
    null;

  let homeAway = row.homeAway || row.home_away || parsed.homeAway || null;
  let opponent = row.opponent || row.opp || row.opposingTeam || parsed.opponent || null;
  let opposingPitcher = row.opposingPitcher || row.probablePitcher || row.opponentPitcher || null;
  let opposingPitcherHand = row.opposingPitcherHand || row.pitcherHand || row.opponentPitcherHand || null;

  if (game && team) {
    const away = upper(game.awayTeam);
    const home = upper(game.homeTeam);

    if (team === away) {
      homeAway = "away";
      opponent = game.homeTeam;
      opposingPitcher = opposingPitcher || game.homeProbablePitcher || null;
      opposingPitcherHand = opposingPitcherHand || game.homePitcherHand || null;
    } else if (team === home) {
      homeAway = "home";
      opponent = game.awayTeam;
      opposingPitcher = opposingPitcher || game.awayProbablePitcher || null;
      opposingPitcherHand = opposingPitcherHand || game.awayPitcherHand || null;
    }
  }

  if (!opposingPitcherHand && opposingPitcher) {
    const pitcherKey = normName(opposingPitcher);
    const oppTeam = upper(opponent);
    opposingPitcherHand =
      pitcherHands.byNameTeam.get(`${pitcherKey}|${oppTeam}`) ||
      pitcherHands.byName.get(pitcherKey) ||
      null;
  }

  return {
    player: playerOf(row),
    team,
    market: marketOf(row),
    side: row.side || row.pickSide || row.direction || null,
    line: row.line ?? row.ppLine ?? row.projectionLine ?? null,
    actual: row.actual ?? row.actualValue ?? null,
    result: row.result || row.outcome || row.grade || null,
    gamePk,
    game: row.game || row.resolvedGame || row.matchup || null,
    opponent,
    homeAway,
    opposingPitcher,
    opposingPitcherHand,
    battingOrder: row.battingOrder || row.lineupSpot || row.battingPosition || null,
    sourceProjection: row.projection ?? row.projected ?? row.mean ?? null,
    probability: row.probability ?? row.prob ?? row.calibratedProbability ?? null,
    edge: row.edge ?? row.ev ?? row.adjEdge ?? null,
    tier: row.tier || row.oddsTier || "standard"
  };
}

const rows = (Array.isArray(board) ? board : [])
  .filter(r => playerOf(r) && HITTER_MARKETS.has(marketOf(r)))
  .map(enrich)
  .filter(r => {
    if (!r.team || !r.game) return true;
    const game = String(r.game);
    const m = game.match(/^(.+?)\s+@\s+(.+)$/);
    if (!m) return true;
    const away = upper(m[1]);
    const home = upper(m[2]);
    const team = upper(r.team);
    return away.includes(team) || home.includes(team) || team.includes(away) || team.includes(home);
  });

function coverage(field) {
  const count = rows.filter(r => has(r[field])).length;
  return {
    count,
    pct: rows.length ? Math.round((count / rows.length) * 10000) / 100 : null
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: "CURRENT_PICKFINDER_CONTEXT_ENRICHMENT_NO_API",
  rows: rows.length,
  coverage: {
    opponent: coverage("opponent"),
    homeAway: coverage("homeAway"),
    opposingPitcher: coverage("opposingPitcher"),
    opposingPitcherHand: coverage("opposingPitcherHand"),
    battingOrder: coverage("battingOrder"),
    gamePk: coverage("gamePk")
  },
  rows,
  missingPitcherHandSample: rows.filter(r => !has(r.opposingPitcherHand)).slice(0, 40)
};

const lines = [];
lines.push("PICK FINDER CURRENT CONTEXT ENRICHMENT");
lines.push("======================================");
lines.push(`mode: ${report.mode}`);
lines.push(`hitter rows: ${rows.length}`);
lines.push("");
lines.push("COVERAGE");
lines.push("--------");
for (const [field, c] of Object.entries(report.coverage)) {
  lines.push(`- ${field}: ${c.count}/${rows.length} (${c.pct ?? "n/a"}%)`);
}
lines.push("");
lines.push("INTERPRETATION");
lines.push("--------------");
lines.push("- opponent/homeAway should now be usable for current-board Pick Finder logic.");
lines.push("- opposingPitcher is usable if coverage is high.");
lines.push("- opposingPitcherHand still needs a handedness lookup if coverage is low.");
lines.push("- battingOrder needs confirmed lineup data and may remain unavailable.");
lines.push("");
lines.push("NEXT");
lines.push("----");
lines.push("After this, build auto-pickfinder-hitter-signal using enriched current rows.");

fs.mkdirSync("outputs/manual", { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
