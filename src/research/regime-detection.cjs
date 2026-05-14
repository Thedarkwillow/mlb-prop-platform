const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function classifyBucket(row) {
  const count = Number(row.count || 0);
  const roi = Number(row.roi);
  const hitRate = Number(row.hitRate);

  if (count < 5) return { regime: "INSUFFICIENT_SAMPLE", adjustment: 0 };

  if (roi <= -0.35 && hitRate < 0.45) {
    return { regime: "BAD_REGIME", adjustment: -0.06 };
  }

  if (roi <= -0.20 || hitRate < 0.48) {
    return { regime: "WEAK_REGIME", adjustment: -0.035 };
  }

  if (roi >= 0.25 && hitRate >= 0.58 && count >= 8) {
    return { regime: "HOT_REGIME", adjustment: 0.015 };
  }

  return { regime: "NORMAL", adjustment: 0 };
}

function analyzeSection(rows = []) {
  return rows.map(row => {
    const c = classifyBucket(row);
    return {
      bucket: row.bucket,
      count: row.count,
      wins: row.wins,
      losses: row.losses,
      hitRate: row.hitRate,
      roi: row.roi,
      roiPct: row.roiPct,
      regime: c.regime,
      adjustment: c.adjustment
    };
  });
}

const rolling = readJson("data/results/rolling-roi-windows.json", null);

if (!rolling) {
  console.error("Missing data/results/rolling-roi-windows.json. Run: node src/research/rolling-roi-windows.cjs YYYY-MM-DD");
  process.exit(1);
}

const report = {
  generatedAt: new Date().toISOString(),
  asOf: rolling.asOf,
  source: "data/results/rolling-roi-windows.json",
  windows: {}
};

for (const [windowKey, windowData] of Object.entries(rolling.windows || {})) {
  report.windows[windowKey] = {
    start: windowData.start,
    end: windowData.end,
    rows: windowData.rows,
    byMarket: analyzeSection(windowData.byMarket),
    byMarketSide: analyzeSection(windowData.byMarketSide),
    byConfidence: analyzeSection(windowData.byConfidence),
    byProbabilityBucket: analyzeSection(windowData.byProbabilityBucket),
    byEdgeBucket: analyzeSection(windowData.byEdgeBucket)
  };
}

const bad = [];
for (const [windowKey, windowData] of Object.entries(report.windows)) {
  for (const section of ["byMarket", "byMarketSide", "byConfidence", "byProbabilityBucket", "byEdgeBucket"]) {
    for (const row of windowData[section] || []) {
      if (["BAD_REGIME", "WEAK_REGIME", "HOT_REGIME"].includes(row.regime)) {
        bad.push({
          window: windowKey,
          section,
          ...row
        });
      }
    }
  }
}

report.signals = bad.sort((a, b) => {
  const order = { BAD_REGIME: 0, WEAK_REGIME: 1, HOT_REGIME: 2 };
  return (order[a.regime] ?? 9) - (order[b.regime] ?? 9) || b.count - a.count;
});

writeJson("data/results/regime-detection.json", report);
writeJson(`outputs/regime-detection-${rolling.asOf}.json`, report);

console.log("REGIME DETECTION");
console.log("================");
console.log("asOf:", rolling.asOf);
console.log("signals:", report.signals.length);
console.table(report.signals.slice(0, 25));
