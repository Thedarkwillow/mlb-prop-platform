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

console.log("\nFINAL TOP LEGS");
console.table(topLegs.map((x, i) => ({
  rank: i + 1,
  player: x.player,
  team: x.team,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: val(x, "edge", "sportsbookEdge"),
  grade: val(x, "grade", "qualityGrade"),
  books: val(x, "books", "sportsbookBookCount")
})));

console.log("\nFINAL SLIPS");

for (const s of slips) {
  const title = s.type || s.name || `${s.size || (s.legs || []).length}-MAN`;
  console.log(`\n${String(title).toUpperCase()} | green=${s.green ?? ""} neutral=${s.neutral ?? ""}`);
  console.table((s.legs || []).map((x, i) => ({
    leg: i + 1,
    player: x.player,
    pick: `${x.market} ${x.side} ${x.line}`,
    edge: val(x, "edge", "sportsbookEdge"),
    grade: val(x, "grade", "qualityGrade")
  })));
}
