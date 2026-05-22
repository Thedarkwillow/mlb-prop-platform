const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function validTeam(s) {
  const x = String(s || "").toUpperCase().trim();
  return /^[A-Z]{2,3}$/.test(x) ? x : "";
}

const boardPath = "outputs/priced-board.json";
const pp = readJson("data/prizepicks-latest.json", []);
const board = readJson(boardPath, []);

const ppByPlayerTeam = new Map();

for (const r of pp) {
  const player = norm(r.player_name || r.player || r.name);
  const team = validTeam(r.player_team || r.team);
  const opp = validTeam(r.description || r.opponent || r.opponent_team);
  const start = r.game_start || r.start_time || null;

  if (!player || !team || !opp || team === opp) continue;

  ppByPlayerTeam.set(`${player}__${team}`, {
    game: `${team} @ ${opp}`,
    team,
    opp,
    start
  });
}

let fixed = 0;

const repaired = board.map(row => {
  if (!row || typeof row !== "object") return row;

  const player = norm(row.player);
  const team = validTeam(row.team || row.resolvedTeam);

  if (!player || !team) return row;

  const badGame =
    !row.resolvedGame ||
    !row.game ||
    row.game === " @ " ||
    row.game === "null @ null";

  if (!badGame) return row;

  const hit = ppByPlayerTeam.get(`${player}__${team}`);
  if (!hit) return row;

  fixed++;

  return {
    ...row,
    game: hit.game,
    resolvedGame: hit.game,
    resolvedTeam: hit.team,
    teamResolved: hit.team,
    teamValid: true,
    teamResolverStatus: "PRIZEPICKS_DESCRIPTION_REPAIR",
    startTime: row.startTime || hit.start
  };
});

fs.writeFileSync(boardPath, JSON.stringify(repaired, null, 2));

console.log("PRIZEPICKS GAME REPAIR");
console.log("======================");
console.log({
  boardRows: board.length,
  prizePicksRows: pp.length,
  lookupKeys: ppByPlayerTeam.size,
  fixed
});
