const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const HISTORY_PATH = "data/results/daily-performance-history.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(require("path").dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function resultValue(r) {
  if (r === "HIT") return 1;
  if (r === "MISS") return -1;
  return 0;
}

function summarize(rows) {
  const graded = rows.filter(x => x.result !== "UNMATCHED");
  const wins = graded.filter(x => x.result === "HIT").length;
  const losses = graded.filter(x => x.result === "MISS").length;
  const pushes = graded.filter(x => x.result === "PUSH").length;
  const total = graded.length;
  const profitUnits = graded.reduce((sum, x) => sum + resultValue(x.result), 0);

  return {
    count: rows.length,
    graded: total,
    wins,
    losses,
    pushes,
    hitRate: total ? wins / total : 0,
    profitUnits,
    roiUnits: total ? profitUnits / total : 0
  };
}

const ledger = read(`outputs/final-decision-ledger-graded-${date}.json`, []);

const topLegs = ledger.filter(x => x.decisionStatus === "TOP_LEG");
const blocked = ledger.filter(x => x.decisionStatus === "BLOCKED");

const daily = {
  date,
  topLegs: summarize(topLegs),
  blocked: summarize(blocked),
  props: topLegs.map(x => ({
    player: x.player,
    team: x.team,
    market: x.market,
    side: x.side,
    line: x.line,
    result: x.result,
    actual: x.actual,
    prob: x.prob,
    edge: x.edge,
    grade: x.grade
  }))
};

const history = read(HISTORY_PATH, []);
const updated = [...history.filter(x => x.date !== date), daily].sort((a, b) => a.date.localeCompare(b.date));
write(HISTORY_PATH, updated);

const allTopProps = updated.flatMap(d => d.props.map(p => ({ ...p, date: d.date })));
const allSummary = summarize(allTopProps);
const last7Dates = updated.slice(-7);
const last7Props = last7Dates.flatMap(d => d.props.map(p => ({ ...p, date: d.date })));
const last7Summary = summarize(last7Props);

console.log("DAILY PERFORMANCE");
console.log("-----------------");
console.log("date:", date);
console.log("top legs:", daily.topLegs.count);
console.log("graded legs:", daily.topLegs.graded);
console.log("record:", `${daily.topLegs.wins}-${daily.topLegs.losses}-${daily.topLegs.pushes}`);
console.log("hit rate:", daily.topLegs.hitRate.toFixed(3));
console.log("roi (units):", daily.topLegs.roiUnits.toFixed(3));

console.log("");
console.log("CUMULATIVE TOP PROP RECORD");
console.log("--------------------------");
console.log("all-time:", `${allSummary.wins}-${allSummary.losses}-${allSummary.pushes}`);
console.log("all-time hit rate:", allSummary.hitRate.toFixed(3));
console.log("all-time roi (units):", allSummary.roiUnits.toFixed(3));
console.log("last 7 days:", `${last7Summary.wins}-${last7Summary.losses}-${last7Summary.pushes}`);
console.log("last 7 hit rate:", last7Summary.hitRate.toFixed(3));

console.log("");
console.log("TOP PROPS");
console.table(daily.props.map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  result: x.result,
  actual: x.actual
})));

console.log("");
console.log("saved:", HISTORY_PATH);
