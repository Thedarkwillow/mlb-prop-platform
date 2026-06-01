const fs = require("fs");

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

function inferOpponentFromGame(row) {
  const team = normTeam(row.team || row.playerTeam || row.teamAbbrev || row.resolvedTeam);
  const raw = String(row.resolvedGame || row.game || "")
    .replace(/\s+at\s+/gi, " @ ")
    .trim();

  if (!raw.includes("@")) return "";

  const parts = raw.split("@").map(x => normTeam(x));
  if (parts.length !== 2) return "";

  if (parts[0] === team) return parts[1];
  if (parts[1] === team) return parts[0];

  return "";
}

function opponentCandidates(row) {
  const vals = [
    row.opponent,
    row.opponentTeam,
    row.resolvedOpponent,
    row.awayTeam && row.homeTeam && normTeam(row.team) === normTeam(row.awayTeam) ? row.homeTeam : null,
    row.awayTeam && row.homeTeam && normTeam(row.team) === normTeam(row.homeTeam) ? row.awayTeam : null,
    inferOpponentFromGame(row)
  ]
    .map(normTeam)
    .filter(Boolean);

  return [...new Set(vals)];
}

const boardPath = "outputs/priced-board.json";
const framingPath = "data/context/team-catcher-framing.json";

const board = readJson(boardPath, []);
const framing = readJson(framingPath, []);

const byTeam = new Map();
for (const t of framing) {
  byTeam.set(normTeam(t.team), t);
}

let matched = 0;
let fallback = 0;
const unmatchedOpponents = {};

const out = board.map(row => {
  if (!row || typeof row !== "object") return row;

  const next = { ...row };
  const candidates = opponentCandidates(row);

  let opp = null;
  let matchedOpponent = null;

  for (const candidate of candidates) {
    if (byTeam.has(candidate)) {
      opp = byTeam.get(candidate);
      matchedOpponent = candidate;
      break;
    }
  }

  if (opp) {
    matched++;
    next.opponentCatcher = opp.primaryCatcher;
    next.opponentCatcherFramingTier = opp.catcherFramingTier;
    next.opponentCatcherFramingRunValue = opp.catcherFramingRunValue;
    next.opponentCatcherFramingPct = opp.catcherFramingPct;
    next.opponentCatcherFramingReady = true;
    next.opponentCatcherFramingSource = "TEAM_CATCHER_FRAMING";
    next.opponentCatcherFramingOpponent = matchedOpponent;
  } else {
    fallback++;
    const key = candidates[0] || "UNKNOWN_OPP";
    unmatchedOpponents[key] = (unmatchedOpponents[key] || 0) + 1;
    next.opponentCatcherFramingReady = false;
  }

  return next;
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2) + "\n");

console.log("CATCHER FRAMING MERGE REPORT");
console.log("============================");
console.log({
  boardRows: board.length,
  teams: framing.length,
  matchedRows: matched,
  fallbackRows: fallback,
  matchRate: board.length ? +(matched / board.length).toFixed(4) : 0
});

console.log("Unmatched opponents:");
console.table(
  Object.entries(unmatchedOpponents)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([opponent, rows]) => ({ opponent, rows }))
);
