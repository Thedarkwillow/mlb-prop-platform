const fs = require("fs");

const rows = JSON.parse(fs.readFileSync("outputs/odds-api-mlb-props.json","utf8"));

function implied(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? Math.abs(n) / (Math.abs(n) + 100) : 100 / (n + 100);
}

function normMarket(m) {
  if (m === "batter_hits") return "hits";
  if (m === "batter_total_bases") return "bases";
  if (m === "pitcher_strikeouts") return "strikeouts";
  return m;
}

function normSide(s) {
  s = String(s || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function key(r) {
  return [
    String(r.player || "").toLowerCase().trim(),
    normMarket(r.market),
    normSide(r.side),
    String(r.line)
  ].join("|");
}

const groups = new Map();

for (const r of rows) {
  const prob = implied(r.oddsAmerican);
  if (!Number.isFinite(prob)) continue;

  const k = key(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push({
    sportsbook: r.sportsbook,
    player: r.player,
    market: normMarket(r.market),
    side: normSide(r.side),
    line: r.line,
    oddsAmerican: r.oddsAmerican,
    impliedProb: prob,
    game: `${r.awayTeam} @ ${r.homeTeam}`
  });
}

const out = [];

for (const [k, arr] of groups) {
  const avg = arr.reduce((a,b)=>a+b.impliedProb,0) / arr.length;
  const best = arr.slice().sort((a,b)=>b.impliedProb-a.impliedProb)[0];
  out.push({
    key: k,
    player: best.player,
    market: best.market,
    side: best.side,
    line: best.line,
    avgImpliedProb: Number(avg.toFixed(4)),
    bookCount: arr.length,
    books: arr.map(x=>({
      sportsbook:x.sportsbook,
      oddsAmerican:x.oddsAmerican,
      impliedProb:Number(x.impliedProb.toFixed(4))
    })),
    game: best.game
  });
}

out.sort((a,b)=>b.avgImpliedProb-a.avgImpliedProb);

fs.writeFileSync("outputs/odds-api-summary.json", JSON.stringify(out,null,2));

console.log("market prices:", out.length);
console.log("wrote outputs/odds-api-summary.json");

console.log("\nTop HITS MORE 0.5:");
console.table(out.filter(r=>r.market==="hits" && r.side==="MORE" && Number(r.line)===0.5).slice(0,25).map(r=>({
  player:r.player,
  line:r.line,
  avgProb:r.avgImpliedProb,
  books:r.bookCount,
  game:r.game
})));

console.log("\nTop K LESS:");
console.table(out.filter(r=>r.market==="strikeouts" && r.side==="LESS").slice(0,25).map(r=>({
  player:r.player,
  line:r.line,
  avgProb:r.avgImpliedProb,
  books:r.bookCount,
  game:r.game
})));
