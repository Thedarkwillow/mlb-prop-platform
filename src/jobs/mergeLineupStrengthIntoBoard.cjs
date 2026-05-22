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
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const boardPath = "outputs/priced-board.json";
const lineupPath = "data/context/lineup-strength.json";

const board = readJson(boardPath, []);
const lineup = readJson(lineupPath, []);

const byTeam = new Map();
for (const t of lineup) byTeam.set(norm(t.team), t);

let matched = 0;

const out = board.map(row => {
  const team = row.team || row.playerTeam || row.teamAbbrev;
  const l = byTeam.get(norm(team));

  if (!l) {
    return {
      ...row,
      lineupStrengthReady: false
    };
  }

  matched++;

  return {
    ...row,
    lineupStrengthReady: true,
    lineupTier: l.tier,
    lineupStrength: l.strength,
    lineupHitters: l.hitters,
    lineupAvgHits: l.avgHits,
    lineupAvgTB: l.avgTB,
    lineupAvgHRR: l.avgHRR
  };
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

console.log("LINEUP STRENGTH MERGE REPORT");
console.log("============================");
console.log({
  boardRows: board.length,
  lineupTeams: lineup.length,
  matchedRows: matched,
  matchRate: board.length ? Number((matched / board.length).toFixed(4)) : 0
});
