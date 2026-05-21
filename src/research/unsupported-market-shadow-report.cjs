const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function pct(n) {
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : null;
}

const blockedMarkets = new Set([
  "hitter_fantasy_score",
  "pitcher_fantasy_score",
  "pitches_thrown",
  "plate_appearances",
  "walks",
  "walks_allowed",
  "singles",
  "doubles",
  "triples",
  "stolen_bases",
  "hitter_strikeouts",
  "pitcher_strikeouts_(combo)"
]);

const files = [
  `outputs/history/${date}-full-board-graded.json`,
  "outputs/all-markets-graded.json",
  "outputs/fantasy-graded.json"
];

const rows = [];

for (const file of files) {
  const data = readJson(file, []);
  const arr = Array.isArray(data) ? data : [];
  for (const r of arr) {
    const market = norm(r.market || r.stat || r.statKey);
    const side = String(r.side || r.direction || r.recommendedSide || "").toUpperCase();
    const result = String(r.result || "").toUpperCase();

    if (!blockedMarkets.has(market)) continue;
    if (!["HIT", "MISS", "PUSH"].includes(result)) continue;

    rows.push({
      player: r.player,
      team: r.team || null,
      market,
      side: side || "UNKNOWN",
      line: r.line ?? null,
      actual: r.actual ?? null,
      result,
      source: file
    });
  }
}

const buckets = new Map();

for (const r of rows) {
  const key = `${r.market}_${r.side}`;
  if (!buckets.has(key)) {
    buckets.set(key, {
      market: r.market,
      side: r.side,
      plays: 0,
      hits: 0,
      misses: 0,
      pushes: 0
    });
  }

  const b = buckets.get(key);
  b.plays++;
  if (r.result === "HIT") b.hits++;
  else if (r.result === "MISS") b.misses++;
  else if (r.result === "PUSH") b.pushes++;
}

const summary = [...buckets.values()].map(b => {
  const graded = b.hits + b.misses;
  const hitRate = graded ? b.hits / graded : null;

  let action = "MONITOR_ONLY";
  if (graded < 100) action = "NEED_SAMPLE";
  if (graded >= 100 && hitRate < 0.52) action = "SUPPRESS";
  if (graded >= 300 && hitRate >= 0.56) action = "UNLOCK_CANDIDATE_SHADOW_ONLY";

  return {
    ...b,
    graded,
    hitRate,
    hitRatePct: pct(hitRate),
    action
  };
}).sort((a, b) =>
  a.market.localeCompare(b.market) ||
  a.side.localeCompare(b.side)
);

const report = {
  generatedAt: new Date().toISOString(),
  date,
  mode: "SHADOW_ONLY_DO_NOT_BET",
  policy: {
    unsupportedMarketsLiveEnabled: false,
    reason: "Unsupported markets must prove side-specific hit rate and sample size before final-slip unlock."
  },
  totalRows: rows.length,
  summary,
  rows
};

fs.writeFileSync(`outputs/unsupported-market-shadow-report-${date}.json`, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync("outputs/unsupported-market-shadow-report.json", JSON.stringify(report, null, 2) + "\n");

console.log("UNSUPPORTED MARKET SHADOW REPORT");
console.log("================================");
console.log("date:", date);
console.log("rows:", rows.length);
console.table(summary);
console.log(`Wrote outputs/unsupported-market-shadow-report-${date}.json`);
