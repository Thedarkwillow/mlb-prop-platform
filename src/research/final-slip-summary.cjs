const fs = require("fs");

const data = JSON.parse(fs.readFileSync("outputs/final-slips.json", "utf8"));
const topLegs = data.topLegs || [];
const slips = data.slips || [];

function val(x, ...keys) {
  for (const k of keys) {
    if (x && x[k] !== undefined && x[k] !== null) return x[k];
  }
  return undefined;
}

function normGame(g) {
  return String(g || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function correlationWarning(legs) {
  const byGame = new Map();
  const byTeam = new Map();

  for (const leg of legs || []) {
    const game = normGame(leg.game);
    const team = String(leg.team || "").toUpperCase();

    if (game) byGame.set(game, (byGame.get(game) || 0) + 1);
    if (team) byTeam.set(team, (byTeam.get(team) || 0) + 1);
  }

  const gameStacks = [...byGame.entries()].filter(([, count]) => count >= 2);
  const teamStacks = [...byTeam.entries()].filter(([, count]) => count >= 2);

  if (gameStacks.length >= 2) return "HIGH_CORRELATION";
  if (gameStacks.some(([, count]) => count >= 3)) return "HIGH_CORRELATION";
  if (teamStacks.some(([, count]) => count >= 3)) return "TEAM_STACK";
  if (gameStacks.some(([, count]) => count >= 2)) return "GAME_STACK";
  if (teamStacks.some(([, count]) => count >= 2)) return "TEAM_PAIR";

  return "OK";
}

function stackDetails(legs) {
  const byGame = new Map();
  const byTeam = new Map();

  for (const leg of legs || []) {
    const game = normGame(leg.game);
    const team = String(leg.team || "").toUpperCase();

    if (game) {
      if (!byGame.has(game)) byGame.set(game, []);
      byGame.get(game).push(leg.player);
    }

    if (team) {
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team).push(leg.player);
    }
  }

  const games = [...byGame.entries()]
    .filter(([, players]) => players.length >= 2)
    .map(([game, players]) => `${game}: ${players.join(", ")}`);

  const teams = [...byTeam.entries()]
    .filter(([, players]) => players.length >= 2)
    .map(([team, players]) => `${team}: ${players.join(", ")}`);

  return {
    games: games.join(" | ") || "",
    teams: teams.join(" | ") || ""
  };
}

console.log("\nFINAL TOP LEGS");
console.table(topLegs.map((x, i) => ({
  rank: i + 1,
  player: x.player,
  team: x.team,
  game: x.game,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: val(x, "edge", "sportsbookEdge"),
  grade: val(x, "grade", "qualityGrade"),
  books: val(x, "books", "sportsbookBookCount")
})));

console.log("\nFINAL SLIPS");

for (const s of slips) {
  const legs = s.legs || [];
  const title = s.type || s.name || `${s.size || legs.length}-MAN`;
  const warning = correlationWarning(legs);
  const details = stackDetails(legs);

  const status = s.complete === false ? "INCOMPLETE / DO NOT PLAY" : "PLAYABLE";
  console.log(`\n${String(title).toUpperCase()} | ${status} | green=${s.green ?? ""} neutral=${s.neutral ?? ""} correlation=${warning}`);

  if (warning !== "OK") {
    if (details.games) console.log(`\nGame stack: ${details.games}`);
    if (details.teams) console.log(`Team stack: ${details.teams}`);
  }

  console.table(legs.map((x, i) => ({
    leg: i + 1,
    player: x.player,
    team: x.team,
    game: x.game,
    pick: `${x.market} ${x.side} ${x.line}`,
    edge: val(x, "edge", "sportsbookEdge"),
    grade: val(x, "grade", "qualityGrade")
  })));
}
