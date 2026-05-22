const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function pct(n, d) {
  return d ? Number((n / d).toFixed(4)) : 0;
}

const rawBoard = readJson("outputs/priced-board.json", []);
const board = rawBoard.filter(r => r.recordType === "merged_prop" || r.player);
const total = board.length;

const checks = [
  ["savantRollingForm", r => !!r.savantRollingForm],
  ["gameLogForm", r => r.hitterLast15Sample != null || r.pitcherLast5Sample != null || r.hitterLast15HitsPerGame != null || r.pitcherLast5StrikeoutsPerGame != null],
  ["lineupStrength", r => r.lineupStrength != null || r.lineupTier != null],
  ["ownBullpenFatigueReady", r => r.ownBullpenFatigueReady === true],
  ["opponentBullpenFatigueReady", r => r.opponentBullpenFatigueReady === true],
  ["opponentCatcherFramingReady", r => r.opponentCatcherFramingReady === true],
  ["umpireContextReady", r => r.umpireContextReady === true],
  ["pitchTypeMatchupReady", r => r.pitchTypeMatchupReady === true]
];

const report = checks.map(([name, fn]) => {
  const count = board.filter(fn).length;
  return { context: name, count, total, matchRate: pct(count, total) };
});

console.log("PHASE 6 CONTEXT AUDIT");
console.log("=====================");
console.table(report);

fs.writeFileSync("outputs/phase6-context-audit.json", JSON.stringify(report, null, 2));
console.log("Wrote outputs/phase6-context-audit.json");
