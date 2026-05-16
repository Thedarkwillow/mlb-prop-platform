const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function side(v) {
  return String(v || "").toUpperCase().trim();
}

function tier(v) {
  return String(v || "standard").toLowerCase().trim();
}

function bucketProb(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 0.5) return "<50";
  if (n < 0.55) return "50-55";
  if (n < 0.6) return "55-60";
  if (n < 0.65) return "60-65";
  if (n < 0.7) return "65-70";
  if (n < 0.75) return "70-75";
  return "75+";
}

function bucketScore(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 0.05) return "<0.05";
  if (n < 0.1) return "0.05-0.10";
  if (n < 0.15) return "0.10-0.15";
  if (n < 0.2) return "0.15-0.20";
  return "0.20+";
}

function result(row) {
  const r = String(row.result || row.outcome || "").toUpperCase();
  if (["HIT", "WIN", "WON"].includes(r)) return "HIT";
  if (["MISS", "LOSS", "LOST"].includes(r)) return "MISS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";
  return "UNKNOWN";
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(result(r)));
  const hits = graded.filter(r => result(r) === "HIT").length;
  const misses = graded.filter(r => result(r) === "MISS").length;
  const pushes = graded.filter(r => result(r) === "PUSH").length;
  const decisions = hits + misses;

  return {
    count: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    hitRate: decisions ? Number((hits / decisions).toFixed(4)) : null,
    roi: decisions ? Number(((hits - misses) / decisions).toFixed(4)) : null
  };
}

function add(map, key, row) {
  if (!map[key]) map[key] = [];
  map[key].push(row);
}

const blocked = read("outputs/blocked-final-candidates.json", []);
const enriched = read("outputs/slips-distribution-enriched.json", []);
const nearMissGraded = read(`outputs/near-miss-graded-${DATE}.json`, []);
const historyPath = "data/results/blocked-prop-history.json";
const history = read(historyPath, []);

const nearKeyToResult = new Map();
for (const r of nearMissGraded) {
  nearKeyToResult.set(
    [r.date, r.player, r.market, r.side, r.line].join("|"),
    r
  );
}

function joinKey(r) {
  return [
    String(r.player || "").toLowerCase().trim(),
    norm(r.market || r.stat),
    side(r.side || r.recommendedSide),
    String(r.line ?? r.ppLine ?? "").trim()
  ].join("|");
}

const enrichedByKey = new Map();
for (const r of enriched) enrichedByKey.set(joinKey(r), r);

const rows = blocked.map(r => {
  const key = [DATE, r.player, r.market, r.side, r.line].join("|");
  const graded = nearKeyToResult.get(key);
  const e = enrichedByKey.get(joinKey(r)) || {};

  return {
    date: DATE,
    player: r.player,
    team: r.team || e.team || null,
    game: r.game || e.game || null,
    market: norm(r.market),
    side: side(r.side),
    line: r.line,
    oddsTier: tier(r.oddsTier || r.tier || e.oddsTier || e.tier),
    prob: r.prob ?? e.calibratedDistributionProb ?? e.recommendedProb ?? null,
    edge: r.edge ?? e.sportsbookAdjustedEdge ?? e.adjustedEdge ?? e.sportsbookEdge ?? e.edge ?? null,
    score: r.score ?? null,
    reasonBlocked: r.reason || null,
    reasons: r.reasons || [],
    actual: graded?.actual ?? null,
    result: graded?.result ?? "UNKNOWN",
    shadow: true,
    source: graded ? "near_miss_graded" : "blocked_ungraded"
  };
});

const byKey = new Map();
for (const r of history) {
  byKey.set([r.date, r.player, r.market, r.side, r.line].join("|"), r);
}
for (const r of rows) {
  byKey.set([r.date, r.player, r.market, r.side, r.line].join("|"), r);
}

const combined = [...byKey.values()];
write(historyPath, combined);

const byReason = {};
const byMarket = {};
const byMarketSide = {};
const byMarketSideTier = {};
const byProbBucket = {};
const byScoreBucket = {};

for (const r of combined) {
  add(byReason, r.reasonBlocked || "unknown", r);
  add(byMarket, r.market || "unknown", r);
  add(byMarketSide, `${r.market}_${r.side}`, r);
  add(byMarketSideTier, `${r.market}_${r.side}_${tier(r.oddsTier)}`, r);
  add(byProbBucket, bucketProb(r.prob), r);
  add(byScoreBucket, bucketScore(r.score), r);
}

const report = {
  generatedAt: new Date().toISOString(),
  note: "Shadow-only learning for blocked/non-playable props. Does not count toward official ROI.",
  date: DATE,
  addedToday: rows.length,
  totalRows: combined.length,
  summary: summarize(combined),
  byReason: Object.fromEntries(Object.entries(byReason).map(([k,v]) => [k, summarize(v)])),
  byMarket: Object.fromEntries(Object.entries(byMarket).map(([k,v]) => [k, summarize(v)])),
  byMarketSide: Object.fromEntries(Object.entries(byMarketSide).map(([k,v]) => [k, summarize(v)])),
  byMarketSideTier: Object.fromEntries(Object.entries(byMarketSideTier).map(([k,v]) => [k, summarize(v)])),
  byProbBucket: Object.fromEntries(Object.entries(byProbBucket).map(([k,v]) => [k, summarize(v)])),
  byScoreBucket: Object.fromEntries(Object.entries(byScoreBucket).map(([k,v]) => [k, summarize(v)]))
};

write("data/learning/blocked-prop-learning.json", report);

console.log("BLOCKED PROP LEARNING");
console.log("=====================");
console.log("date:", DATE);
console.log("added today:", rows.length);
console.log("total rows:", combined.length);
console.log("summary:");
console.table([report.summary]);

console.log("By reason:");
console.table(Object.entries(report.byReason).map(([bucket, x]) => ({ bucket, ...x })));

console.log("By market side tier:");
console.table(Object.entries(report.byMarketSideTier).map(([bucket, x]) => ({ bucket, ...x })).slice(0, 25));

console.log("By score bucket:");
console.table(Object.entries(report.byScoreBucket).map(([bucket, x]) => ({ bucket, ...x })));

console.log("Wrote data/results/blocked-prop-history.json");
console.log("Wrote data/learning/blocked-prop-learning.json");
