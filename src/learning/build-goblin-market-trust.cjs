const fs = require("fs");
const path = require("path");

const HISTORY_DIR = "outputs/history";
const OUT_FILE = "data/learning/goblin-market-trust.json";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function sideKey(r) {
  return String(r.side || r.recommendedSide || "MORE").toUpperCase();
}

function marketKey(r) {
  return String(r.market || r.stat || "unknown").toLowerCase();
}

function isGraded(r) {
  return ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase());
}

function actionFor({ market, side, sample, hitRate }) {
  if (side !== "MORE") {
    return {
      action: "SUPPRESS",
      reason: "goblin_non_more_not_allowed"
    };
  }

  if (market === "strikeouts") {
    return {
      action: "SUPPRESS",
      reason: "raw_goblin_strikeouts_more_extremely_bad"
    };
  }

  if (sample < 20) {
    return {
      action: "WATCH",
      reason: "low_sample"
    };
  }

  if (hitRate >= 0.60) {
    return {
      action: "ALLOW",
      reason: "raw_goblin_hit_rate_60_plus"
    };
  }

  if (hitRate >= 0.54) {
    return {
      action: "WATCH",
      reason: "raw_goblin_hit_rate_watch"
    };
  }

  return {
    action: "SUPPRESS",
    reason: "raw_goblin_hit_rate_below_threshold"
  };
}

function listReports() {
  if (!fs.existsSync(HISTORY_DIR)) return [];

  return fs.readdirSync(HISTORY_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}-goblin-raw-performance\.json$/.test(f))
    .map(f => path.join(HISTORY_DIR, f))
    .sort();
}

const files = listReports();
const rows = [];

for (const file of files) {
  const report = readJson(file, null);
  if (!report || !Array.isArray(report.rows)) continue;

  for (const r of report.rows) {
    if (!isGraded(r)) continue;
    if (String(r.oddsTier || r.tier || "").toLowerCase() !== "goblin") continue;

    rows.push({
      date: report.date || path.basename(file).slice(0, 10),
      market: marketKey(r),
      side: sideKey(r),
      result: String(r.result || "").toUpperCase(),
      player: r.player || null,
      line: r.line ?? null
    });
  }
}

const groups = new Map();

for (const r of rows) {
  const key = `${r.market}|${r.side}`;
  if (!groups.has(key)) {
    groups.set(key, {
      market: r.market,
      side: r.side,
      sample: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      dates: new Set()
    });
  }

  const g = groups.get(key);
  g.sample += 1;
  if (r.result === "HIT") g.hits += 1;
  if (r.result === "MISS") g.misses += 1;
  if (r.result === "PUSH") g.pushes += 1;
  if (r.date) g.dates.add(r.date);
}

const markets = [...groups.values()]
  .map(g => {
    const denom = g.hits + g.misses;
    const hitRate = denom ? Number((g.hits / denom).toFixed(4)) : null;
    const policy = actionFor({
      market: g.market,
      side: g.side,
      sample: denom,
      hitRate: hitRate ?? 0
    });

    return {
      market: g.market,
      side: g.side,
      sample: denom,
      hits: g.hits,
      misses: g.misses,
      pushes: g.pushes,
      hitRate,
      action: policy.action,
      reason: policy.reason,
      dates: [...g.dates].sort()
    };
  })
  .sort((a, b) => {
    const actionOrder = { SUPPRESS: 0, WATCH: 1, ALLOW: 2 };
    return (
      (actionOrder[a.action] ?? 9) - (actionOrder[b.action] ?? 9) ||
      b.sample - a.sample ||
      a.market.localeCompare(b.market)
    );
  });

const output = {
  generatedAt: new Date().toISOString(),
  source: "outputs/history/*-goblin-raw-performance.json",
  reports: files.length,
  gradedRows: rows.length,
  policy: {
    suppressBelowHitRate: 0.54,
    watchBelowHitRate: 0.60,
    minSampleForAllow: 20,
    hardSuppress: [
      {
        market: "strikeouts",
        side: "MORE",
        reason: "raw goblin strikeouts MORE has been extremely poor"
      }
    ]
  },
  markets
};

writeJson(OUT_FILE, output);

console.log("GOBLIN MARKET TRUST");
console.log("===================");
console.log({
  reports: files.length,
  gradedRows: rows.length,
  markets: markets.length,
  outFile: OUT_FILE
});
console.table(markets.map(m => ({
  market: m.market,
  side: m.side,
  sample: m.sample,
  hits: m.hits,
  misses: m.misses,
  hitRate: m.hitRate,
  action: m.action,
  reason: m.reason
})));
