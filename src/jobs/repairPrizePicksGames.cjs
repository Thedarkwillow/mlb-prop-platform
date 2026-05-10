const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const RAW = "data/prizepicks-latest.json";

function read(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

const board = read(BOARD);
const raw = read(RAW);

const byProjection = new Map();
const byLoose = new Map();

for (const r of raw) {
  if (r.projection_id) byProjection.set(String(r.projection_id), r);
  const key = [
    String(r.player_name || "").toLowerCase(),
    String(r.stat || "").toLowerCase(),
    String(Number(r.line)),
    String(r.odds_tier || "").toLowerCase()
  ].join("|");
  byLoose.set(key, r);
}

let repaired = 0;

for (const row of board) {
  const badGame = !row.game || String(row.game).includes("null");
  if (!badGame) continue;

  const looseKey = [
    String(row.player || "").toLowerCase(),
    String(row.stat || "").toLowerCase(),
    String(Number(row.line)),
    String(row.oddsTier || row.odds_tier || "").toLowerCase()
  ].join("|");

  const src =
    byProjection.get(String(row.projection_id || row.projectionId || "")) ||
    byLoose.get(looseKey);

  if (!src) continue;

  const team = src.player_team || row.team;
  const opp =
    src.description ||
    (src.player_team === src.home_team ? src.away_team : null) ||
    (src.player_team === src.away_team ? src.home_team : null) ||
    row.opponent;

  if (!team || !opp) continue;

  row.team = team;
  row.opponent = opp;
  row.game = `${team} @ ${opp}`;
  row.gameRepairSource = "prizepicks_description";
  row.startTime = row.startTime || src.start_time || src.game_start || null;

  repaired++;
}

fs.writeFileSync(BOARD, JSON.stringify(board, null, 2));
console.log(`Repaired PrizePicks game rows: ${repaired}`);
