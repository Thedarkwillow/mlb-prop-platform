// src/jobs/lockedSlateHealthCheck.js

const fs = require('fs');
const path = require('path');

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

const FILE = path.join(
  __dirname,
  `../../outputs/history/${DATE}-locked-slips.json`
);

if (!fs.existsSync(FILE)) {
  console.error("❌ Locked slate not found:", FILE);
  process.exit(1);
}

const slips = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const legs = slips.flatMap(s => s.legs || []);

console.log("LOCKED SLATE HEALTH CHECK");
console.log("Date:", DATE);
console.log("Slips:", slips.length);
console.log("Legs:", legs.length);
console.log("");

/* =========================
   DUPLICATE PROP CHECK
========================= */

const propKey = l =>
  `${l.player}|${l.market}|${l.line}|${l.side}`;

const propCounts = {};
for (const l of legs) {
  const k = propKey(l);
  propCounts[k] = (propCounts[k] || 0) + 1;
}

const dupProps = Object.entries(propCounts).filter(([k, v]) => v > 2);

console.log("DUPLICATE PROPS:", dupProps.length);
dupProps.slice(0, 10).forEach(([k, v]) => {
  console.log("  ", v, "x", k);
});

/* =========================
   PLAYER EXPOSURE
========================= */

const playerCounts = {};
for (const l of legs) {
  playerCounts[l.player] = (playerCounts[l.player] || 0) + 1;
}

const maxPlayer = Math.max(...Object.values(playerCounts));
const overPlayers = Object.entries(playerCounts).filter(
  ([, v]) => v > 3
);

console.log("\nMAX PLAYER EXPOSURE:", maxPlayer);
console.log("PLAYERS > 3:", overPlayers.length);

/* =========================
   TEAM EXPOSURE
========================= */

const teamCounts = {};
for (const l of legs) {
  teamCounts[l.team] = (teamCounts[l.team] || 0) + 1;
}

const maxTeam = Math.max(...Object.values(teamCounts));
console.log("\nMAX TEAM EXPOSURE:", maxTeam);

/* =========================
   GAME EXPOSURE
========================= */

const gameCounts = {};
for (const l of legs) {
  gameCounts[l.game] = (gameCounts[l.game] || 0) + 1;
}

const maxGame = Math.max(...Object.values(gameCounts));
console.log("MAX GAME EXPOSURE:", maxGame);

/* =========================
   INVALID FIELDS
========================= */

const invalid = legs.filter(l =>
  !l.player ||
  !l.market ||
  l.line == null ||
  !l.side
);

console.log("\nINVALID LEGS:", invalid.length);

/* =========================
   PROJECTION CHECK
========================= */

const missingProj = legs.filter(l =>
  l.projection == null || isNaN(l.projection)
);

console.log("MISSING PROJECTIONS:", missingProj.length);

/* =========================
   MARKET FILTER CHECK
========================= */

const bannedMarkets = new Set([
  "pitcher_fantasy_score",
  "hitter_fantasy_score",
  "pitches_thrown",
  "walks_allowed",
  "triples"
]);

const badMarkets = legs.filter(l =>
  bannedMarkets.has(l.market)
);

console.log("BANNED MARKETS FOUND:", badMarkets.length);

/* =========================
   GAME FORMAT CHECK
========================= */

const badGames = legs.filter(l =>
  !l.game || !l.game.includes("@")
);

console.log("BAD GAME FORMAT:", badGames.length);

/* =========================
   SUMMARY
========================= */

console.log("\n=== SUMMARY ===");

if (
  dupProps.length === 0 &&
  overPlayers.length === 0 &&
  invalid.length === 0 &&
  missingProj.length === 0 &&
  badMarkets.length === 0 &&
  badGames.length === 0
) {
  console.log("✅ LOCKED SLATE IS CLEAN");
} else {
  console.log("⚠️ ISSUES DETECTED");
}
