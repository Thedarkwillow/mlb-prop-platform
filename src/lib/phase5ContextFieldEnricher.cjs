const fs = require("fs");

function readJson(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function keyName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/* ---------------------------
   GAME PARSING (FIXED)
--------------------------- */

function parseTeamsFromGame(game) {
  if (!game) return [];

  const clean = String(game).trim();

  // Preferred: abbreviation format like "NYY @ NYM"
  const abbr = clean.match(/\b[A-Z]{2,3}\b\s*@\s*\b[A-Z]{2,3}\b/);
  if (abbr) {
    return abbr[0].split("@").map(x => x.trim().toUpperCase());
  }

  // Do not infer abbreviations from full team names.
  // "New York Yankees @ New York Mets" is ambiguous without a team-name map.
  return [];
}

function teamFromRow(row) {
  if (row.team) return String(row.team).toUpperCase();

  const teams = parseTeamsFromGame(row.game || row.resolvedGame);
  return teams[0] || null;
}

function opponentFromRow(row) {
  if (row.opponent) return String(row.opponent).toUpperCase();

  const team = teamFromRow(row);
  const teams = parseTeamsFromGame(row.game || row.resolvedGame);

  if (team && teams.length === 2) {
    return teams.find(t => t !== team) || null;
  }

  return null;
}

/* ---------------------------
   LOAD CONTEXT
--------------------------- */

const gameOdds = readJson("data/context/game-odds-context.json");
const bullpenFatigue = readJson("data/context/bullpen-fatigue.json");
const teamForm = readJson("data/context/team-form-context.json");

const teamsOdds = gameOdds.teams || {};
const bullpenTeams = bullpenFatigue.teams || {};
const formTeams = teamForm.teams || {};

/* ---------------------------
   IMPLIED TEAM TOTAL (FIX)
--------------------------- */

function getImpliedTeamTotal(team, opponent) {
  const t = teamsOdds[team];
  const o = teamsOdds[opponent];

  if (!t || !o) return null;

  const total = Number(t.total);
  const teamML = Number(t.moneyline);
  const oppML = Number(o.moneyline);

  if (!Number.isFinite(total)) return null;

  // Convert moneyline → implied probability
  function prob(ml) {
    return ml < 0 ? (-ml) / ((-ml) + 100) : 100 / (ml + 100);
  }

  const pTeam = prob(teamML);
  const pOpp = prob(oppML);
  const sum = pTeam + pOpp;

  if (sum === 0) return null;

  const teamShare = pTeam / sum;

  return Number((total * teamShare).toFixed(2));
}

/* ---------------------------
   MAIN ENRICH
--------------------------- */

function applyPhase5ContextFields(row) {
  const market = String(row.market || "").toLowerCase();

  const team = teamFromRow(row);
  const opponent = opponentFromRow(row);

  const oppBullpen = bullpenTeams[opponent] || null;

  const opponentBullpenWeak =
    oppBullpen?.fatigue === "HIGH" ||
    Number(oppBullpen?.last3DaysReliefPitches) >= 130;

  const opponentBullpenElite =
    oppBullpen?.fatigue === "LOW" &&
    Number(oppBullpen?.last3DaysReliefPitches || 0) <= 60;

  const impliedTeamTotal = getImpliedTeamTotal(team, opponent);

  return {
    ...row,
    team,
    opponent,
    teamTotal: impliedTeamTotal,
    opponentBullpenWeak,
    opponentBullpenElite
  };
}

module.exports = { applyPhase5ContextFields };
