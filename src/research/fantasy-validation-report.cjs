const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function pct(n) {
  return Number.isFinite(n) ? Number((n * 100).toFixed(2)) : null;
}

const sideReport = readJson("outputs/fantasy-side-tracking.json", null);
const lessShadow = readJson("outputs/fantasy-less-shadow-sim.json", null);

if (!sideReport) {
  throw new Error("Missing outputs/fantasy-side-tracking.json. Run npm run fantasy:sides first.");
}

const summary = sideReport.summary || [];
const rows = sideReport.rows || [];

function bucket(row) {
  const line = Number(row.line);
  const type = row.type || "Fantasy Score";
  const side = row.side || "UNKNOWN";
  const synthetic = Boolean(row.syntheticInverse);

  let lineBucket = "unknown_line";
  if (Number.isFinite(line)) {
    if (line <= 5.5) lineBucket = "low_line";
    else if (line <= 8.5) lineBucket = "mid_line";
    else lineBucket = "high_line";
  }

  let playerType = "unknown";
  if (String(type).toLowerCase().includes("hitter")) playerType = "hitter";
  if (String(type).toLowerCase().includes("pitcher")) playerType = "pitcher";

  return `${lineBucket}_${playerType}_fantasy_${String(side).toLowerCase()}_${synthetic ? "synthetic" : "direct"}`;
}

const buckets = new Map();

for (const r of rows) {
  const result = String(r.result || "").toUpperCase();
  if (!["HIT", "MISS", "PUSH"].includes(result)) continue;

  const k = bucket(r);
  if (!buckets.has(k)) {
    buckets.set(k, {
      bucket: k,
      plays: 0,
      hits: 0,
      misses: 0,
      pushes: 0
    });
  }

  const b = buckets.get(k);
  b.plays++;
  if (result === "HIT") b.hits++;
  else if (result === "MISS") b.misses++;
  else if (result === "PUSH") b.pushes++;
}

const bucketSummary = [...buckets.values()].map(b => {
  const graded = b.hits + b.misses;
  const hitRate = graded ? b.hits / graded : null;

  let action = "MONITOR_ONLY";
  if (b.bucket.includes("more")) action = "SUPPRESS";
  if (
    b.bucket.includes("low_line_hitter_fantasy_less") &&
    b.bucket.includes("synthetic")
  ) {
    action = "MONITOR_ONLY_NOT_PLAYABLE";
  }

  return {
    ...b,
    graded,
    hitRate,
    hitRatePct: pct(hitRate),
    action
  };
}).sort((a, b) =>
  a.bucket.localeCompare(b.bucket)
);

const report = {
  generatedAt: new Date().toISOString(),
  status: "MONITOR_ONLY",
  policy: {
    fantasyLiveEnabled: false,
    lowLineHitterFantasyGoblinBucket: "MONITOR_ONLY_NOT_PLAYABLE",
    reason: "Fantasy LESS signal is currently inferred/synthetic. Do not unlock until direct LESS sample and ROI validation exist."
  },
  sideTotals: sideReport.totals || null,
  lessShadowTotal: lessShadow?.total || null,
  bucketSummary
};

fs.writeFileSync("outputs/fantasy-validation-report.json", JSON.stringify(report, null, 2) + "\n");

console.log("FANTASY VALIDATION REPORT");
console.log("=========================");
console.log("status:", report.status);
console.log("policy:", report.policy);
console.table(bucketSummary);
console.log("Wrote outputs/fantasy-validation-report.json");
