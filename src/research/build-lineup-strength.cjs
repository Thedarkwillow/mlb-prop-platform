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

// INPUTS (use what you already have)
const board = readJson("outputs/priced-board.json", []);
const gameLog = readJson("data/context/player-game-log-form.json", []);

// index player hitting strength
const hitterMap = new Map();
for (const p of gameLog) {
  const h = p.hitter?.last15;
  if (h?.games > 0) {
    hitterMap.set(norm(p.player), h);
  }
}

// group players by team
const teamMap = new Map();

for (const row of board) {
  const team = row.team || row.playerTeam || row.teamAbbrev;
  const player = row.player || row.playerName || row.name;

  if (!team || !player) continue;

  const key = norm(team);
  if (!teamMap.has(key)) {
    teamMap.set(key, new Map()); // player-level dedupe
  }

  const teamPlayers = teamMap.get(key);
  const playerKey = norm(player);
  const h = hitterMap.get(playerKey);

  if (h && !teamPlayers.has(playerKey)) {
    teamPlayers.set(playerKey, h);
  }
}

// compute lineup strength
const out = [];

for (const [team, playerMap] of teamMap.entries()) {
  const hitters = Array.from(playerMap.values());
  if (!hitters.length) continue;

  const avgHits = hitters.reduce((a, h) => a + (h.hitsPerGame || 0), 0) / hitters.length;
  const avgTB = hitters.reduce((a, h) => a + (h.totalBasesPerGame || 0), 0) / hitters.length;
  const avgHRR = hitters.reduce((a, h) => a + (h.hrrPerGame || 0), 0) / hitters.length;

  const strength =
    (avgHits * 0.4) +
    (avgTB * 0.4) +
    (avgHRR * 0.2);

  let tier = "AVG";
  if (strength >= 2.2) tier = "ELITE";
  else if (strength >= 1.6) tier = "STRONG";
  else if (strength <= 1.0) tier = "WEAK";

  out.push({
    team,
    hitters: hitters.length,
    avgHits: Number(avgHits.toFixed(4)),
    avgTB: Number(avgTB.toFixed(4)),
    avgHRR: Number(avgHRR.toFixed(4)),
    strength: Number(strength.toFixed(4)),
    tier
  });
}

console.log("LINEUP STRENGTH REPORT");
console.log("======================");
console.log({ teams: out.length });

console.table(out.slice(0, 20));

fs.mkdirSync("data/context", { recursive: true });
fs.writeFileSync("data/context/lineup-strength.json", JSON.stringify(out, null, 2));

console.log("Wrote data/context/lineup-strength.json");
