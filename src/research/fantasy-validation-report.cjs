const fs = require("fs");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const input = `outputs/history/${date}-fantasy-grades.json`;
const out = `outputs/history/${date}-fantasy-validation-report.json`;

function read(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function bucketLine(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 3.5) return "low_line_possible_goblin";
  if (n <= 6.5) return "mid_line";
  if (n <= 10.5) return "high_line_standard";
  return "very_high_line_possible_demon";
}

function summarize(rows) {
  const decided = rows.filter(x => x.result === "HIT" || x.result === "MISS");
  const hits = decided.filter(x => x.result === "HIT").length;
  const misses = decided.filter(x => x.result === "MISS").length;
  const pushes = rows.filter(x => x.result === "PUSH").length;
  const pending = rows.filter(x => x.result === "PENDING").length;

  return {
    count: rows.length,
    decided: decided.length,
    hits,
    misses,
    pushes,
    pending,
    hitRate: decided.length ? Number((hits / decided.length).toFixed(4)) : null,
    roiFlat: decided.length ? Number(((hits - misses) / decided.length).toFixed(4)) : null
  };
}

function groupBy(rows, fn) {
  const map = {};
  for (const row of rows) {
    const key = fn(row);
    if (!map[key]) map[key] = [];
    map[key].push(row);
  }
  return Object.fromEntries(
    Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, summarize(v)])
  );
}

const rows = read(input, []);

const enriched = rows.map(r => ({
  ...r,
  lineBucket: bucketLine(r.line),
  fantasyStatus: "TRACK_ONLY",
  promotionEligible: false,
  playableEligible: false,
  disabledReason: `${r.market || "fantasy"}_track_only_until_calibrated`
}));

const report = {
  date,
  note: "Fantasy remains Option A: research-only / track-only. No playable promotion.",
  overall: summarize(enriched),
  byMarket: groupBy(enriched, r => r.market || "unknown"),
  bySide: groupBy(enriched, r => r.side || "unknown"),
  byOddsTier: groupBy(enriched, r => r.oddsTier || "unknown"),
  byLineBucket: groupBy(enriched, r => r.lineBucket),
  byMarketAndLineBucket: groupBy(enriched, r => `${r.market || "unknown"} | ${r.lineBucket}`),
  topMisses: enriched
    .filter(r => r.result === "MISS")
    .sort((a, b) => Number(b.line || 0) - Number(a.line || 0))
    .slice(0, 25),
  topHits: enriched
    .filter(r => r.result === "HIT")
    .sort((a, b) => Number(b.actual || 0) - Number(a.actual || 0))
    .slice(0, 25)
};

fs.writeFileSync(out, JSON.stringify(report, null, 2));

console.log(`FANTASY VALIDATION REPORT ${date}`);
console.log("OVERALL");
console.table([report.overall]);
console.log("BY MARKET");
console.table(Object.entries(report.byMarket).map(([bucket, x]) => ({ bucket, ...x })));
console.log("BY LINE BUCKET");
console.table(Object.entries(report.byLineBucket).map(([bucket, x]) => ({ bucket, ...x })));
console.log("BY ODDS TIER");
console.table(Object.entries(report.byOddsTier).map(([bucket, x]) => ({ bucket, ...x })));
console.log(`Wrote ${out}`);
