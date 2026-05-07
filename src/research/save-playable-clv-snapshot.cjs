const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

const IN = "outputs/playable-final-slips.json";
const OUT = `data/clv-snapshots/playable-${DATE}.json`;

function uniqLegKey(x) {
  return [
    x.player,
    x.team,
    x.game,
    x.market,
    x.side,
    x.line
  ].join("|");
}

const slips = JSON.parse(fs.readFileSync(IN, "utf8"));
const seen = new Set();
const legs = [];

for (const slip of slips) {
  for (const leg of slip.legs || []) {
    const key = uniqLegKey(leg);
    if (seen.has(key)) continue;
    seen.add(key);

    legs.push({
      player: leg.player,
      team: leg.team,
      game: leg.game,
      gamePk: leg.gamePk ?? null,
      market: leg.market,
      side: leg.side,
      line: leg.line,
      edge: leg.edge,
      adjustedEdge: leg.adjustedEdge,
      grade: leg.grade,
      books: leg.books,
      savant: leg.savant,
      marketSupportFlag: leg.marketSupportFlag,
      sourceSlips: slips
        .filter(s => (s.legs || []).some(l => uniqLegKey(l) === key))
        .map(s => s.name)
    });
  }
}

const output = {
  date: DATE,
  savedAt: new Date().toISOString(),
  source: IN,
  type: "playable_final_slips",
  legs
};

fs.mkdirSync("data/clv-snapshots", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(output, null, 2));

console.log(`Saved playable CLV snapshot: ${OUT}`);
console.table(legs.map((x, i) => ({
  rank: i + 1,
  player: x.player,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: x.edge,
  adjEdge: x.adjustedEdge,
  books: x.books,
  slips: x.sourceSlips.join(", ")
})));
