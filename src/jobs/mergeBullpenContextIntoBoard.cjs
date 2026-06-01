const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const FATIGUE = "data/context/bullpen-fatigue.json";
const ARSENAL = "data/savant/bullpen-arsenal-compact.json";

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

function normTeam(v) {
  return String(v || "").toUpperCase().trim();
}

function cleanGame(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .replace(/\bat\b/gi, "@")
    .trim();
}

function teamOf(row) {
  return normTeam(row.resolvedTeam || row.team || row.playerTeam);
}

function inferOpponent(row) {
  const explicit = normTeam(row.resolvedOpponent || row.opponent || row.opponentTeam);
  if (explicit) return explicit;

  const team = teamOf(row);
  const game = cleanGame(row.resolvedGame || row.game || row.matchup);
  if (!team || !game.includes("@")) return "";

  const [awayRaw, homeRaw] = game.split("@").map(x => normTeam(x));
  if (!awayRaw || !homeRaw) return "";

  if (awayRaw === team) return homeRaw;
  if (homeRaw === team) return awayRaw;

  return "";
}

function fatigueScore(rec) {
  if (!rec) return null;

  const tier = String(rec.fatigue || "").toUpperCase();
  let score = 0;

  if (tier === "HIGH") score += 3;
  else if (tier === "MEDIUM") score += 2;
  else if (tier === "LOW") score += 1;

  const pitches = Number(rec.pitchCountLast2Days ?? rec.last3DaysReliefPitches ?? 0);
  const b2b = Number(rec.backToBackRelievers ?? 0);
  const apps = Number(rec.relieverAppearances ?? 0);

  if (pitches >= 180) score += 2;
  else if (pitches >= 120) score += 1;

  if (b2b >= 4) score += 2;
  else if (b2b >= 2) score += 1;

  if (apps >= 10) score += 1;

  return score;
}

function bullpenArsenalFor(team, arsenal) {
  const rows = Array.isArray(arsenal.byTeam?.[team]) ? arsenal.byTeam[team] : [];
  return {
    count: rows.length,
    available: rows.length > 0,
    highVeloCount: rows.filter(r => Number(r.currentFastballVelo) >= 96).length,
    leftyCount: rows.filter(r => String(r.hand || "").toUpperCase().startsWith("L")).length,
    rightyCount: rows.filter(r => String(r.hand || "").toUpperCase().startsWith("R")).length,
    names: rows.slice(0, 8).map(r => r.pitcher || r.player).filter(Boolean)
  };
}

const board = readJson(BOARD, []);
const fatigue = readJson(FATIGUE, { teams: {} });
const arsenal = readJson(ARSENAL, { byTeam: {} });

if (!Array.isArray(board)) {
  console.error(`Invalid board: ${BOARD}`);
  process.exit(1);
}

let mergedRows = 0;
let ownReady = 0;
let opponentReady = 0;
let ownArsenalReady = 0;
let opponentArsenalReady = 0;
let inferredOpponent = 0;

const out = board.map(row => {
  if (!row || row.recordType !== "merged_prop") return row;

  const team = teamOf(row);
  const opponent = inferOpponent(row);
  if (!row.opponent && !row.resolvedOpponent && opponent) inferredOpponent++;

  const ownPen = fatigue.teams?.[team] || null;
  const oppPen = fatigue.teams?.[opponent] || null;

  const ownArsenal = bullpenArsenalFor(team, arsenal);
  const oppArsenal = bullpenArsenalFor(opponent, arsenal);

  if (ownPen) ownReady++;
  if (oppPen) opponentReady++;
  if (ownArsenal.available) ownArsenalReady++;
  if (oppArsenal.available) opponentArsenalReady++;

  mergedRows++;

  return {
    ...row,

    resolvedOpponent: row.resolvedOpponent || opponent || null,
    opponent: row.opponent || opponent || null,

    ownBullpenFatigueReady: Boolean(ownPen),
    opponentBullpenFatigueReady: Boolean(oppPen),

    ownBullpenFatigueTier: ownPen?.fatigue || null,
    opponentBullpenFatigueTier: oppPen?.fatigue || null,

    ownBullpenFatigueScore: fatigueScore(ownPen),
    opponentBullpenFatigueScore: fatigueScore(oppPen),

    ownBullpenFatigue: ownPen || null,
    opponentBullpenFatigue: oppPen || null,

    ownBullpenArsenalReady: ownArsenal.available,
    opponentBullpenArsenalReady: oppArsenal.available,

    ownBullpenArsenalCount: ownArsenal.count,
    opponentBullpenArsenalCount: oppArsenal.count,

    ownBullpenHighVeloCount: ownArsenal.highVeloCount,
    opponentBullpenHighVeloCount: oppArsenal.highVeloCount,

    ownBullpenLeftyCount: ownArsenal.leftyCount,
    opponentBullpenLeftyCount: oppArsenal.leftyCount,

    ownBullpenRightyCount: ownArsenal.rightyCount,
    opponentBullpenRightyCount: oppArsenal.rightyCount,

    ownBullpenArsenalNames: ownArsenal.names,
    opponentBullpenArsenalNames: oppArsenal.names
  };
});

writeJson(BOARD, out);

console.log("BULLPEN CONTEXT MERGE REPORT");
console.log("----------------------------");
console.table([{
  boardRows: board.length,
  mergedRows,
  inferredOpponent,
  ownReady,
  opponentReady,
  eitherFatigueReady: out.filter(r =>
    r?.recordType === "merged_prop" &&
    (r.ownBullpenFatigueReady === true || r.opponentBullpenFatigueReady === true)
  ).length,
  ownArsenalReady,
  opponentArsenalReady,
  eitherArsenalReady: out.filter(r =>
    r?.recordType === "merged_prop" &&
    (r.ownBullpenArsenalReady === true || r.opponentBullpenArsenalReady === true)
  ).length
}]);
console.log("saved:", BOARD);
