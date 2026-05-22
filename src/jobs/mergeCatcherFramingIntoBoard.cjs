const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
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

const out = board.map(row => {
  const team = normTeam(row.team || row.playerTeam || row.teamAbbrev);
  const opponent = normTeam(
    row.opponent ||
    row.opponentTeam ||
    (row.game && row.game.includes("@")
      ? (row.game.split("@").map(x => normTeam(x)).find(t => t !== team))
      : "")
  );

  const opp = byTeam.get(opponent);

  const next = { ...row };

  if (opp) {
    matched++;
    next.opponentCatcher = opp.primaryCatcher;
    next.opponentCatcherFramingTier = opp.catcherFramingTier;
    next.opponentCatcherFramingRunValue = opp.catcherFramingRunValue;
    next.opponentCatcherFramingPct = opp.catcherFramingPct;
    next.opponentCatcherFramingReady = true;
  } else {
    next.opponentCatcherFramingReady = false;
  }

  return next;
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

console.log("CATCHER FRAMING MERGE REPORT");
console.log("============================");
console.log({
  boardRows: board.length,
  teams: framing.length,
  matchedRows: matched,
  matchRate: +(matched / board.length).toFixed(4)
});
