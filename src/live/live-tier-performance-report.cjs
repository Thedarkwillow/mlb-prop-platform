const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const HIST = "data/live/mlb-live-board-history.json";
const GRADED = `outputs/live/mlb-live-inning-graded-${date}.json`;
const OUT = `outputs/live/live-tier-performance-${date}.json`;
const LATEST = "outputs/live/live-tier-performance-latest.json";

function readJson(file, fallback) {
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

function norm(v) {
  return String(v ?? "").trim();
}

function key(r) {
  return [
    norm(r.prizepicksId),
    norm(r.player),
    norm(r.market),
    norm(r.side),
    norm(r.line),
    norm(r.inningWindow),
    norm(r.game)
  ].join("|");
}

function resultValue(r) {
  return norm(r.result || r.gradeResult || "UNKNOWN").toUpperCase();
}

function isGraded(r) {
  return norm(r.gradeStatus).toUpperCase() === "GRADED";
}

function summarize(rows, groupFn) {
  const groups = new Map();

  for (const r of rows) {
    const bucket = groupFn(r);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(r);
  }

  return [...groups.entries()]
    .map(([bucket, arr]) => {
      const graded = arr.filter(isGraded);
      const hits = graded.filter(r => resultValue(r) === "HIT").length;
      const misses = graded.filter(r => resultValue(r) === "MISS").length;
      const pushes = graded.filter(r => resultValue(r) === "PUSH").length;
      const gradedCount = graded.length;

      return {
        bucket,
        totalRows: arr.length,
        graded: gradedCount,
        hits,
        misses,
        pushes,
        hitRate: gradedCount ? +(hits / gradedCount).toFixed(4) : null,
        roi: gradedCount ? +((hits - misses) / gradedCount).toFixed(4) : null,
        pending: arr.filter(r => resultValue(r) === "PENDING").length,
        unsupported: arr.filter(r => resultValue(r) === "UNSUPPORTED").length
      };
    })
    .sort((a, b) => {
      const ar = a.roi ?? -999;
      const br = b.roi ?? -999;
      if (br !== ar) return br - ar;
      return b.graded - a.graded;
    });
}

function main() {
  const hist = readJson(HIST, []).filter(r => r.date === date);
  const graded = readJson(GRADED, []);

  if (!Array.isArray(hist) || hist.length === 0) {
    throw new Error(`No live board history rows found for ${date}: ${HIST}`);
  }

  if (!Array.isArray(graded) || graded.length === 0) {
    throw new Error(`No live graded rows found for ${date}: ${GRADED}`);
  }

  const tierByKey = new Map();

  for (const r of hist) {
    tierByKey.set(key(r), {
      oddsTier: r.oddsTier || "standard",
      sourceType: r.sourceType || null,
      sourceFeed: r.sourceFeed || null,
      capturedAt: r.capturedAt || null,
      prizepicksId: r.prizepicksId || null,
      durationName: r.durationName || null,
      durationId: r.durationId || null
    });
  }

  const rows = graded.map(r => ({
    ...r,
    ...(tierByKey.get(key(r)) || {
      oddsTier: "unknown",
      tierJoinStatus: "UNMATCHED"
    })
  }));

  const byTier = summarize(rows, r => r.oddsTier || "unknown");
  const byTierMarketSide = summarize(
    rows,
    r => `${r.oddsTier || "unknown"} | ${r.market || "unknown"} ${r.side || ""}`.trim()
  );
  const byTierMarketSideInning = summarize(
    rows,
    r => `${r.oddsTier || "unknown"} | ${r.market || "unknown"} ${r.side || ""} | ${r.inningWindow || "unknown"}`
  );

  const report = {
    date,
    generatedAt: new Date().toISOString(),
    input: {
      history: HIST,
      graded: GRADED
    },
    rows: rows.length,
    tierMatched: rows.filter(r => r.oddsTier && r.oddsTier !== "unknown").length,
    tierUnmatched: rows.filter(r => !r.oddsTier || r.oddsTier === "unknown").length,
    byTier,
    byTierMarketSide,
    byTierMarketSideInning
  };

  writeJson(OUT, report);
  writeJson(LATEST, report);

  console.log("LIVE TIER PERFORMANCE REPORT");
  console.log("----------------------------");
  console.log("date:", date);
  console.log("rows:", report.rows);
  console.log("tier matched:", report.tierMatched);
  console.log("tier unmatched:", report.tierUnmatched);

  console.log("\nBY TIER");
  console.table(byTier);

  console.log("\nBY TIER + MARKET SIDE");
  console.table(byTierMarketSide.filter(r => r.graded >= 5));

  console.log("saved:", OUT);
  console.log("saved:", LATEST);
}

main();
