const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

const PLAYABLE = "outputs/playable-final-slips.json";
const CLV = `data/clv-snapshots/playable-${DATE}.json`;
const GRADED = `outputs/playable-final-slips-graded-${DATE}.json`;
const OUT = `outputs/daily-review-${DATE}.json`;

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function flattenSlipLegs(slips) {
  const rows = [];
  for (const slip of slips || []) {
    for (const leg of slip.legs || []) {
      rows.push({
        slip: slip.name,
        size: slip.size,
        player: leg.player,
        team: leg.team,
        game: leg.game,
        market: leg.market,
        side: leg.side,
        line: leg.line,
        edge: leg.edge,
        adjustedEdge: leg.adjustedEdge,
        grade: leg.grade,
        books: leg.books,
        savant: leg.savant,
        correlation: slip.correlation || "OK",
      });
    }
  }
  return rows;
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows || []) {
    const k = r[key] ?? "UNKNOWN";
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function edgeBucket(edge) {
  if (typeof edge !== "number") return "unknown";
  if (edge >= 0.15) return "15%+";
  if (edge >= 0.10) return "10-15%";
  if (edge >= 0.05) return "5-10%";
  return "0-5%";
}

const slips = readJson(PLAYABLE, []);
const clv = readJson(CLV, { legs: [] });
const graded = readJson(GRADED, null);

const legs = flattenSlipLegs(slips);
const uniqueLegs = Array.from(
  new Map(legs.map(x => [`${x.player}|${x.market}|${x.side}|${x.line}`, x])).values()
);

const review = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  playableSlipCount: slips.length,
  playableSlipNames: slips.map(s => s.name),
  uniquePlayableLegCount: uniqueLegs.length,
  marketCounts: countBy(uniqueLegs, "market"),
  savantCounts: countBy(uniqueLegs, "savant"),
  gradeCounts: countBy(uniqueLegs, "grade"),
  edgeBuckets: uniqueLegs.reduce((a, x) => {
    const b = edgeBucket(x.edge);
    a[b] = (a[b] || 0) + 1;
    return a;
  }, {}),
  topPlayableLegs: uniqueLegs
    .slice()
    .sort((a, b) => (b.adjustedEdge ?? b.edge ?? -999) - (a.adjustedEdge ?? a.edge ?? -999))
    .slice(0, 10),
  clvSnapshot: {
    found: fs.existsSync(CLV),
    legCount: clv.legs?.length || 0,
    top: (clv.legs || []).slice(0, 10),
  },
  grading: graded
    ? {
        found: true,
        hits: graded.hits ?? null,
        misses: graded.misses ?? null,
        pushes: graded.pushes ?? null,
        unknown: graded.unknown ?? null,
        slipResults: graded.slips || graded.slipResults || [],
        legResults: graded.legs || [],
      }
    : {
        found: false,
        note: `No graded file found yet: ${GRADED}`,
      },
};

fs.writeFileSync(OUT, JSON.stringify(review, null, 2));

console.log(`\nDAILY REVIEW ${DATE}`);
console.log(`Playable slips: ${review.playableSlipCount}`);
console.log(`Unique playable legs: ${review.uniquePlayableLegCount}`);
console.log("\nMarket counts:");
console.table(review.marketCounts);
console.log("\nSavant counts:");
console.table(review.savantCounts);
console.log("\nEdge buckets:");
console.table(review.edgeBuckets);
console.log("\nTop playable legs:");
console.table(review.topPlayableLegs.map((x, i) => ({
  rank: i + 1,
  player: x.player,
  team: x.team,
  game: x.game,
  pick: `${x.market} ${x.side} ${x.line}`,
  edge: x.edge,
  adjEdge: x.adjustedEdge,
  grade: x.grade,
  books: x.books,
  savant: x.savant,
})));

if (review.grading.found) {
  console.log("\nGrading:");
  console.table({
    hits: review.grading.hits,
    misses: review.grading.misses,
    pushes: review.grading.pushes,
    unknown: review.grading.unknown,
  });
} else {
  console.log(`\nGrading: ${review.grading.note}`);
}

console.log(`\nWrote ${OUT}`);
