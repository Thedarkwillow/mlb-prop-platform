const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

function read(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
}

function resultValue(r) {
  if (r === "HIT") return 1;
  if (r === "MISS") return -1;
  return 0;
}

const ledger = read(`outputs/final-decision-ledger-graded-${date}.json`);

const topLegs = ledger.filter(x => x.decisionStatus === "TOP_LEG");
const played = topLegs.filter(x => x.result !== "UNMATCHED");

const wins = played.filter(x => x.result === "HIT").length;
const losses = played.filter(x => x.result === "MISS").length;
const pushes = played.filter(x => x.result === "PUSH").length;

const total = played.length;
const hitRate = total ? (wins / total) : 0;

// simple ROI: +1 per win, -1 per loss (can refine later)
const profitUnits = played.reduce((sum, x) => sum + resultValue(x.result), 0);
const roi = total ? (profitUnits / total) : 0;

console.log("DAILY PERFORMANCE");
console.log("-----------------");
console.log("date:", date);
console.log("top legs:", topLegs.length);
console.log("graded legs:", total);
console.log("wins:", wins);
console.log("losses:", losses);
console.log("pushes:", pushes);
console.log("hit rate:", hitRate.toFixed(3));
console.log("roi (units):", roi.toFixed(3));
