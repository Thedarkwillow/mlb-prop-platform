const fs = require("fs");

const inFile = "data/oddsapi/all-dk-player-props.json";
const outFile = "data/vegas-raw.json";
const consensusFile = "data/vegas-consensus.json";
const clvFile = "data/oddsapi/clv-snapshots.jsonl";

const marketMap = {
  batter_hits: "hits",
  batter_total_bases: "bases",
  batter_home_runs: "home_runs",
  batter_rbis: "rbis",
  batter_runs_scored: "runs",
  batter_hits_runs_rbis: "hrr",
  batter_strikeouts: "hitter_strikeouts",
  batter_walks: "walks",
  pitcher_strikeouts: "strikeouts",
  pitcher_hits_allowed: "hits_allowed",
  pitcher_earned_runs: "earned_runs_allowed",
  pitcher_outs: "pitching_outs",
  pitcher_walks: "walks_allowed"
};

const bookTier = {
  pinnacle: "sharp",
  fanduel: "major",
  draftkings: "major",
  betmgm: "major",
  caesars: "major",
  espnbet: "soft"
};

const bookWeight = {
  pinnacle: 1.5,
  fanduel: 1.15,
  draftkings: 1.15,
  betmgm: 1.05,
  caesars: 1.0,
  espnbet: 0.85
};

function sideName(name) {
  const n = String(name || "").toLowerCase();
  if (n === "over") return "MORE";
  if (n === "under") return "LESS";
  return String(name || "").toUpperCase();
}

function impliedProbAmerican(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o) || o === 0) return null;
  return o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100);
}

function noVigTwoWay(overProb, underProb) {
  if (!Number.isFinite(overProb) || !Number.isFinite(underProb)) return null;
  const total = overProb + underProb;
  if (total <= 0) return null;
  return {
    MORE: overProb / total,
    LESS: underProb / total
  };
}

const events = JSON.parse(fs.readFileSync(inFile, "utf8"));
if (!Array.isArray(events) || !events.length) {
  throw new Error("No Odds API events found. Refusing to write empty vegas file.");
}
const rows = [];

for (const event of events) {
  const game = `${event.away_team} @ ${event.home_team}`;

  for (const book of event.bookmakers || []) {
    const tier = bookTier[book.key] || "unknown";
    const weight = bookWeight[book.key] || 1;

    for (const m of book.markets || []) {
      const market = marketMap[m.key];
      if (!market) continue;

      for (const o of m.outcomes || []) {
        rows.push({
          source: "oddsapi",
          sportsbook: book.key,
          sportsbookTitle: book.title,
          bookTier: tier,
          bookWeight: weight,
          game,
          eventId: event.id,
          commenceTime: event.commence_time,
          market,
          rawMarket: m.key,
          player: o.description,
          side: sideName(o.name),
          line: Number(o.point),
          odds: Number(o.price),
          impliedProb: impliedProbAmerican(o.price),
          lastUpdate: m.last_update
        });
      }
    }
  }
}

const byKey = new Map();

for (const r of rows) {
  const key = [r.game, r.player, r.market, r.line].join("|");
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}

const consensus = [];

for (const [key, group] of byKey.entries()) {
  const sides = { MORE: [], LESS: [] };

  for (const r of group) {
    if (r.side === "MORE" || r.side === "LESS") sides[r.side].push(r);
  }

  const overBooks = sides.MORE;
  const underBooks = sides.LESS;
  const allBooks = [...new Set(group.map(x => x.sportsbook))];

  const overAvg = overBooks.length
    ? overBooks.reduce((a, x) => a + x.impliedProb, 0) / overBooks.length
    : null;

  const underAvg = underBooks.length
    ? underBooks.reduce((a, x) => a + x.impliedProb, 0) / underBooks.length
    : null;

  const noVig = noVigTwoWay(overAvg, underAvg);

  for (const side of ["MORE", "LESS"]) {
    const sideRows = sides[side];
    if (!sideRows.length) continue;

    const weightedNumerator = sideRows.reduce(
      (a, x) => a + (x.impliedProb || 0) * (x.bookWeight || 1),
      0
    );
    const weightedDenominator = sideRows.reduce(
      (a, x) => a + (x.bookWeight || 1),
      0
    );

    const probs = sideRows.map(x => x.impliedProb).filter(Number.isFinite);
    const prices = sideRows.map(x => x.odds).filter(Number.isFinite);

    const sharpRows = sideRows.filter(x => x.bookTier === "sharp");
    const softRows = sideRows.filter(x => x.bookTier === "soft");

    const sharpProb = sharpRows.length
      ? sharpRows.reduce((a, x) => a + x.impliedProb, 0) / sharpRows.length
      : null;

    const softProb = softRows.length
      ? softRows.reduce((a, x) => a + x.impliedProb, 0) / softRows.length
      : null;

    consensus.push({
      game: sideRows[0].game,
      eventId: sideRows[0].eventId,
      commenceTime: sideRows[0].commenceTime,
      player: sideRows[0].player,
      market: sideRows[0].market,
      rawMarket: sideRows[0].rawMarket,
      side,
      line: sideRows[0].line,
      books: allBooks.length,
      sportsbooks: allBooks,
      avgImpliedProb: probs.length ? probs.reduce((a, x) => a + x, 0) / probs.length : null,
      weightedImpliedProb: weightedDenominator ? weightedNumerator / weightedDenominator : null,
      noVigProb: noVig ? noVig[side] : null,
      minProb: probs.length ? Math.min(...probs) : null,
      maxProb: probs.length ? Math.max(...probs) : null,
      disagreement: probs.length ? Math.max(...probs) - Math.min(...probs) : null,
      bestOdds: prices.length ? Math.max(...prices) : null,
      worstOdds: prices.length ? Math.min(...prices) : null,
      sharpProb,
      softProb,
      sharpSoftGap:
        Number.isFinite(sharpProb) && Number.isFinite(softProb)
          ? sharpProb - softProb
          : null,
      lastUpdate: sideRows.map(x => x.lastUpdate).sort().at(-1)
    });
  }
}

fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
fs.writeFileSync(consensusFile, JSON.stringify(consensus, null, 2));

const snapTime = new Date().toISOString();
fs.appendFileSync(
  clvFile,
  rows.map(r => JSON.stringify({ snapshotAt: snapTime, ...r })).join("\n") + "\n"
);

console.log(`Wrote ${outFile}`);
console.log("Rows:", rows.length);
console.table(rows.slice(0, 25));

console.log(`Wrote ${consensusFile}`);
console.log("Consensus rows:", consensus.length);
console.table(
  consensus
    .filter(x => x.side === "MORE")
    .sort((a, b) => (b.noVigProb || 0) - (a.noVigProb || 0))
    .slice(0, 25)
);
