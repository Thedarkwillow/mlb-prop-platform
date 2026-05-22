const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function pct(n, d) {
  return d ? Number((n / d).toFixed(4)) : 0;
}

const board = readJson("outputs/priced-board.json", []);
const total = board.length;

const checks = [
  ["rollingFormReady", r => r.rollingFormReady === true],
  ["gameLogFormReady", r => r.gameLogFormReady === true],
  ["lineupStrengthReady", r => r.lineupStrengthReady === true],
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
