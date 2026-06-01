const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamKey(s) {
  return String(s || "").trim().toUpperCase();
}

const boardPath = "outputs/priced-board.json";
const lineupStrengthPath = "data/context/lineup-strength.json";
const confirmedLineupsPath = "data/context/lineups.json";

const board = readJson(boardPath, []);
const lineupStrength = readJson(lineupStrengthPath, []);
const confirmedLineups = readJson(confirmedLineupsPath, { teams: {}, players: {} });

const strengthByTeam = new Map();
for (const t of lineupStrength) {
  strengthByTeam.set(norm(t.team), t);
}

const confirmedTeamByTeam = new Map();
for (const t of Object.values(confirmedLineups.teams || {})) {
  confirmedTeamByTeam.set(teamKey(t.team), t);
}

const confirmedPlayerByName = new Map();
for (const p of Object.values(confirmedLineups.players || {})) {
  confirmedPlayerByName.set(norm(p.player), p);
}

let strengthMatched = 0;
let confirmedTeamMatched = 0;
let confirmedPlayerMatched = 0;

const out = board.map(row => {
  const team = row.team || row.playerTeam || row.teamAbbrev || row.resolvedTeam;
  const player = row.player || row.playerName || row.name;

  const strength = strengthByTeam.get(norm(team));
  const teamLineup = confirmedTeamByTeam.get(teamKey(team));
  const playerLineup = confirmedPlayerByName.get(norm(player));

  const lineupConfirmed = playerLineup?.status === "confirmed";
  const lineupStatus = teamLineup?.status || "unknown";

  if (strength) strengthMatched++;
  if (teamLineup) confirmedTeamMatched++;
  if (lineupConfirmed) confirmedPlayerMatched++;

  return {
    ...row,

    lineupStrengthReady: Boolean(strength),
    lineupTier: strength?.tier ?? row.lineupTier ?? null,
    lineupStrength: strength?.strength ?? row.lineupStrength ?? null,
    lineupHitters: strength?.hitters ?? row.lineupHitters ?? null,
    lineupAvgHits: strength?.avgHits ?? row.lineupAvgHits ?? null,
    lineupAvgTB: strength?.avgTB ?? row.lineupAvgTB ?? null,
    lineupAvgHRR: strength?.avgHRR ?? row.lineupAvgHRR ?? null,

    lineupStatus,
    lineupConfirmed,
    confirmedLineup: lineupConfirmed,
    isConfirmedLineup: lineupConfirmed,
    lineupPlayerStatus: playerLineup?.status || (
      lineupStatus === "confirmed" ? "not_in_confirmed_lineup" : lineupStatus
    ),
    battingOrder: playerLineup?.battingOrder ?? null,
    lineupPosition: playerLineup?.position ?? null,
    lineupSource: playerLineup || teamLineup ? confirmedLineups.source || confirmedLineupsPath : null,
    lineupGamePk: playerLineup?.gamePk || teamLineup?.gamePk || null,
    lineupGame: playerLineup?.game || teamLineup?.game || null,
    confirmedBatters: teamLineup?.confirmedBatters ?? 0
  };
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2) + "\n");

console.log("LINEUP MERGE REPORT");
console.log("===================");
console.log({
  boardRows: board.length,
  lineupStrengthTeams: lineupStrength.length,
  confirmedLineupTeams: Object.keys(confirmedLineups.teams || {}).length,
  confirmedLineupPlayers: Object.keys(confirmedLineups.players || {}).length,
  strengthMatchedRows: strengthMatched,
  confirmedTeamMatchedRows: confirmedTeamMatched,
  confirmedPlayerMatchedRows: confirmedPlayerMatched,
  strengthMatchRate: board.length ? Number((strengthMatched / board.length).toFixed(4)) : 0,
  confirmedTeamMatchRate: board.length ? Number((confirmedTeamMatched / board.length).toFixed(4)) : 0,
  confirmedPlayerMatchRate: board.length ? Number((confirmedPlayerMatched / board.length).toFixed(4)) : 0
});
