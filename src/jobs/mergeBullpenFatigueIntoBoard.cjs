const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

function inferOpponent(row, team) {
  const raw = String(row.game || row.resolvedGame || "");
  if (!raw.includes("@")) return "";
  const parts = raw.split("@").map(x => normTeam(x));
  if (parts.length !== 2) return "";
  if (parts[0] === team) return parts[1];
  if (parts[1] === team) return parts[0];
  return "";
}

const boardPath = "outputs/priced-board.json";
const bullpenPath = "data/context/bullpen-fatigue.json";

const board = readJson(boardPath, []);
const bullpen = readJson(bullpenPath, []);

const byTeam = new Map();
for (const t of bullpen) byTeam.set(normTeam(t.team), t);

let teamMatched = 0;
let opponentMatched = 0;

const out = board.map(row => {
  const team = normTeam(row.team || row.playerTeam || row.teamAbbrev);
  const opponent = normTeam(row.opponent || row.opponentTeam || inferOpponent(row, team));

  const own = byTeam.get(team);
  const opp = byTeam.get(opponent);

  const next = { ...row };

  if (own) {
    teamMatched++;
    next.ownBullpenFatigueReady = true;
    next.ownBullpenFatigueTier = own.bullpenFatigueTier;
    next.ownBullpenFatigueScore = own.bullpenFatigueScore;
    next.ownReliefInningsLast3 = own.reliefInningsLast3;
    next.ownReliefPitchCountLast3 = own.reliefPitchCountLast3;
    next.ownReliefAppearancesLast3 = own.reliefAppearancesLast3;
  } else {
    next.ownBullpenFatigueReady = false;
  }

  if (opp) {
    opponentMatched++;
    next.opponentBullpenFatigueReady = true;
    next.opponentBullpenFatigueTier = opp.bullpenFatigueTier;
    next.opponentBullpenFatigueScore = opp.bullpenFatigueScore;
    next.opponentReliefInningsLast3 = opp.reliefInningsLast3;
    next.opponentReliefPitchCountLast3 = opp.reliefPitchCountLast3;
    next.opponentReliefAppearancesLast3 = opp.reliefAppearancesLast3;
  } else {
    next.opponentBullpenFatigueReady = false;
  }

  return next;
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

console.log("BULLPEN FATIGUE MERGE REPORT");
console.log("============================");
console.log({
  boardRows: board.length,
  bullpenTeams: bullpen.length,
  ownMatchedRows: teamMatched,
  opponentMatchedRows: opponentMatched,
  ownMatchRate: board.length ? Number((teamMatched / board.length).toFixed(4)) : 0,
  opponentMatchRate: board.length ? Number((opponentMatched / board.length).toFixed(4)) : 0
});
