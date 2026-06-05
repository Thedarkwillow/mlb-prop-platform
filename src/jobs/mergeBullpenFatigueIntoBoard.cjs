const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

function aliasTeam(s) {
  const x = normTeam(s);
  const map = {
    "ATHLETICS": "ATH",
    "A'S": "ATH",
    "OAK": "ATH",
    "ARI": "AZ",
    "WSN": "WSH",
    "WAS": "WSH",
    "CHW": "CWS",
    "CHW": "CWS",
    "SDP": "SD",
    "SFG": "SF",
    "TBR": "TB",
    "KCR": "KC"
  };
  return map[x] || x;
}

function splitGameTeams(raw) {
  const s = String(raw || "");
  if (!s.includes("@")) return [];
  return s.split("@").map(x => aliasTeam(x.trim()));
}

function inferOpponent(row, team) {
  const t = aliasTeam(team);
  const explicit = aliasTeam(row.opponent || row.opponentTeam || row.resolvedOpponent);
  if (explicit) return explicit;

  const away = aliasTeam(row.awayTeam || row.away || row.awayAbbrev);
  const home = aliasTeam(row.homeTeam || row.home || row.homeAbbrev);
  if (away && home) {
    if (away === t) return home;
    if (home === t) return away;
  }

  for (const raw of [
    row.game,
    row.resolvedGame,
    row.gameName,
    row.matchup,
    row.event,
    row.eventName
  ]) {
    const parts = splitGameTeams(raw);
    if (parts.length !== 2) continue;
    if (parts[0] === t) return parts[1];
    if (parts[1] === t) return parts[0];
  }

  return "";
}

function firstDefined(...xs) {
  for (const x of xs) {
    if (x !== undefined && x !== null && x !== "") return x;
  }
  return null;
}

function teamOf(row, fallbackKey = "") {
  return aliasTeam(firstDefined(
    row.team,
    row.teamAbbrev,
    row.abbrev,
    row.abbreviation,
    row.code,
    row.teamCode,
    row.mlbTeam,
    row.resolvedTeam,
    row.name,
    fallbackKey
  ));
}

function normalizeTier(v) {
  const s = String(v || "").toUpperCase();
  if (!s) return "UNKNOWN";
  if (s.includes("HIGH")) return "HIGH";
  if (s.includes("MED")) return "MEDIUM";
  if (s.includes("LOW")) return "LOW";
  if (s.includes("NEUTRAL")) return "NEUTRAL";
  return s;
}

function normalizeBullpenRow(row, fallbackKey = "") {
  if (!row || typeof row !== "object") return null;

  const team = teamOf(row, fallbackKey);
  if (!team) return null;

  const score = Number(firstDefined(
    row.bullpenFatigueScore,
    row.fatigueScore,
    row.score,
    row.recentUsageScore,
    row.pitchCountLast2Days,
    row.last3DaysReliefPitches,
    row.reliefPitchCountLast3,
    0
  ));

  return {
    ...row,
    team,
    bullpenFatigueReady: true,
    bullpenFatigueTier: normalizeTier(firstDefined(
      row.bullpenFatigueTier,
      row.fatigueTier,
      row.fatigue,
      row.tier,
      "UNKNOWN"
    )),
    bullpenFatigueScore: Number.isFinite(score) ? score : 0,
    reliefInningsLast3: firstDefined(row.reliefInningsLast3, row.inningsLast3, null),
    reliefPitchCountLast3: firstDefined(
      row.reliefPitchCountLast3,
      row.last3DaysReliefPitches,
      row.pitchCountLast2Days,
      row.pitchCountLast3Days,
      null
    ),
    reliefAppearancesLast3: firstDefined(
      row.reliefAppearancesLast3,
      row.relieverAppearances,
      row.appearancesLast3,
      null
    )
  };
}

function bullpenRowsFrom(raw) {
  if (Array.isArray(raw)) {
    return raw.map(r => normalizeBullpenRow(r)).filter(Boolean);
  }

  if (!raw || typeof raw !== "object") return [];

  if (Array.isArray(raw.teams)) {
    return raw.teams.map(r => normalizeBullpenRow(r)).filter(Boolean);
  }

  if (raw.teams && typeof raw.teams === "object") {
    return Object.entries(raw.teams)
      .map(([team, row]) => normalizeBullpenRow(row, team))
      .filter(Boolean);
  }

  if (Array.isArray(raw.data)) {
    return raw.data.map(r => normalizeBullpenRow(r)).filter(Boolean);
  }

  return Object.entries(raw)
    .map(([team, row]) => normalizeBullpenRow(row, team))
    .filter(Boolean);
}

const boardPath = "outputs/priced-board.json";
const bullpenPath = "data/context/bullpen-fatigue.json";

const board = readJson(boardPath, []);
const rawBullpen = readJson(bullpenPath, []);
const bullpen = bullpenRowsFrom(rawBullpen);

if (!bullpen.length) {
  console.warn("WARN: no usable bullpen fatigue rows found; continuing with bullpen context unavailable.");
}

const byTeam = new Map();
for (const row of bullpen) {
  byTeam.set(aliasTeam(row.team), row);
}

let teamMatched = 0;
let opponentMatched = 0;

const out = board.map(row => {
  if (row.recordType && row.recordType !== "merged_prop") return row;

  const team = aliasTeam(row.team || row.playerTeam || row.teamAbbrev || row.resolvedTeam);
  const opponent = inferOpponent(row, team);
  const own = byTeam.get(team);
  const opp = byTeam.get(opponent);
  const next = { ...row };

  if (own) {
    teamMatched++;
    next.ownBullpenFatigueReady = true;
    next.ownBullpenFatigue = own;
    next.ownBullpenFatigueSource = bullpenPath;
    next.ownBullpenFatigueTier = own.bullpenFatigueTier;
    next.ownBullpenFatigueScore = own.bullpenFatigueScore;
    next.ownReliefInningsLast3 = own.reliefInningsLast3;
    next.ownReliefPitchCountLast3 = own.reliefPitchCountLast3;
    next.ownReliefAppearancesLast3 = own.reliefAppearancesLast3;
  } else {
    next.ownBullpenFatigueReady = false;
    next.ownBullpenFatigueTier = null;
    next.ownBullpenFatigueScore = null;
  }

  if (opp) {
    opponentMatched++;
    next.opponentBullpenFatigueReady = true;
    next.opponentBullpenFatigue = opp;
    next.opponentBullpenFatigueSource = bullpenPath;
    next.opponentBullpenFatigueTier = opp.bullpenFatigueTier;
    next.opponentBullpenFatigueScore = opp.bullpenFatigueScore;
    next.opponentReliefInningsLast3 = opp.reliefInningsLast3;
    next.opponentReliefPitchCountLast3 = opp.reliefPitchCountLast3;
    next.opponentReliefAppearancesLast3 = opp.reliefAppearancesLast3;
  } else {
    next.opponentBullpenFatigueReady = false;
    next.opponentBullpenFatigueTier = null;
    next.opponentBullpenFatigueScore = null;
  }

  return next;
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2) + "\n");

console.log("BULLPEN FATIGUE MERGE REPORT");
console.log("============================");
console.log({
  boardRows: board.length,
  bullpenTeams: bullpen.length,
  bullpenTeamKeys: Array.from(byTeam.keys()).slice(0, 30),
  ownMatchedRows: teamMatched,
  opponentMatchedRows: opponentMatched,
  ownMatchRate: board.length ? Number((teamMatched / board.length).toFixed(4)) : 0,
  opponentMatchRate: board.length ? Number((opponentMatched / board.length).toFixed(4)) : 0
});
