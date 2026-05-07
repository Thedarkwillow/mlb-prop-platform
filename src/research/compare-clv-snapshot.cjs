const fs = require("fs");

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);
const OPEN = `data/clv-snapshots/${DATE}.json`;
const CLOSE = `data/clv-snapshots/${DATE}-close.json`;
const OUT = `outputs/clv-compare-${DATE}.json`;

function key(x) {
  return [x.player, x.market, x.side, x.line].join("|");
}

if (!fs.existsSync(OPEN)) throw new Error(`Missing open snapshot: ${OPEN}`);
if (!fs.existsSync(CLOSE)) throw new Error(`Missing close snapshot: ${CLOSE}`);

const open = JSON.parse(fs.readFileSync(OPEN, "utf8"));
const close = JSON.parse(fs.readFileSync(CLOSE, "utf8"));

const closeMap = new Map(close.legs.map(x => [key(x), x]));

const rows = open.legs.map(o => {
  const c = closeMap.get(key(o));
  const openProb = Number(o.marketProb);
  const closeProb = c ? Number(c.marketProb) : null;
  const clv = Number.isFinite(openProb) && Number.isFinite(closeProb)
    ? Number((closeProb - openProb).toFixed(4))
    : null;

  return {
    player: o.player,
    market: o.market,
    side: o.side,
    line: o.line,
    openMarketProb: o.marketProb,
    closeMarketProb: c ? c.marketProb : null,
    clv,
    beatClose: clv != null ? clv > 0 : null,
    openEdge: o.edge,
    closeEdge: c ? c.edge : null,
    grade: o.grade
  };
});

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));

console.log("Wrote", OUT);
console.table(rows);
