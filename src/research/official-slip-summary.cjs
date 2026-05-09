const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v.toFixed(4) : "n/a";
}

const rows = read("outputs/final-slips-validated.json", []);
const rawLegs = rows
  .flatMap(x => Array.isArray(x.legs) ? x.legs : [x])
  .filter(l => l && l.player)
  .filter(l => (l.validationGrade || l.grade) !== "WATCHLIST");

const seen = new Set();
const legs = [];
for (const l of rawLegs) {
  const key = [l.player, l.team, l.market, l.side, l.line].join("|").toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  legs.push(l);
}

const greens = legs.filter(l => (l.validationGrade || l.grade) === "GREEN");
const neutrals = legs.filter(l => (l.validationGrade || l.grade) === "NEUTRAL");

console.log("OFFICIAL SLIP DECISION");
console.log("======================");

if (greens.length >= 2) {
  console.log("STATUS: PLAYABLE");
  console.log("REASON: 2+ GREEN legs available");
  greens.slice(0, 2).forEach((l, i) => {
    console.log(`${i + 1}. ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | prob=${n(l.prob ?? l.calibratedDistributionProb)} | edge=${n(l.edge)} | grade=${l.validationGrade || l.grade}`);
  });
} else {
  console.log("STATUS: PASS");
  console.log(`REASON: only ${greens.length} GREEN legs available`);
  console.log("");
  console.log("BEST NEUTRAL WATCHLIST");
  neutrals.slice(0, 5).forEach((l, i) => {
    console.log(`${i + 1}. ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | prob=${n(l.prob ?? l.calibratedDistributionProb)} | edge=${n(l.edge)} | grade=${l.validationGrade || l.grade}`);
  });
}
