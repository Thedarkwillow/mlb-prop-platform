function resolveDateArg() {
  const args = process.argv.slice(2);
  const dateEq = args.find(a => /^--date=/.test(a));
  if (dateEq) return dateEq.split("=")[1];
  const dateFlagIndex = args.findIndex(a => a === "--date");
  if (dateFlagIndex >= 0 && args[dateFlagIndex + 1]) return args[dateFlagIndex + 1];
  const positional = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  return (
    positional ||
    process.env.npm_config_date ||
    process.env.DATE ||
    new Date().toISOString().slice(0, 10)
  );
}

const fs = require("fs");
const path = require("path");

const date = resolveDateArg();

const TIER_REPORT = `outputs/live/live-tier-performance-${date}.json`;
const LATEST_TIER_REPORT = "outputs/live/live-tier-performance-latest.json";
const OUT = `outputs/shadow-promotion-audit-${date}.json`;
const LATEST = "outputs/shadow-promotion-audit-latest.json";

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

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function classify(row) {
  const bucket = String(row.bucket || "");
  const graded = num(row.graded);
  const hitRate = num(row.hitRate);
  const roi = num(row.roi);

  const approvedBuckets = [
    "goblin | strikeouts MORE",
    "goblin | walks_allowed MORE"
  ];

  if (!approvedBuckets.includes(bucket)) {
    return {
      action: "TRACK_ONLY",
      reason: "not_approved_shadow_bucket"
    };
  }

  if (bucket.includes("strikeouts") && graded < 75) {
    return {
      action: "TRACK_ONLY",
      reason: "needs_75_graded_for_goblin_k_more"
    };
  }

  if (bucket.includes("walks_allowed") && graded < 30) {
    return {
      action: "TRACK_ONLY",
      reason: "needs_30_graded_for_goblin_walks_allowed_more"
    };
  }

  if (hitRate >= 0.58 && roi >= 0.10) {
    return {
      action: "TRACK_ONLY",
      reason: "shadow_bucket_requires_manual_approval"
    };
  }

  return {
    action: "TRACK_ONLY",
    reason: "insufficient_hit_rate_or_roi"
  };
}

const report = readJson(TIER_REPORT, null) || readJson(LATEST_TIER_REPORT, {});
const rows = Array.isArray(report.byTierMarketSide)
  ? report.byTierMarketSide
  : Array.isArray(report.topTierMarketSide)
    ? report.topTierMarketSide
    : [];

const audited = rows.map(row => {
  const decision = classify(row);
  return {
    bucket: row.bucket,
    totalRows: row.totalRows,
    graded: row.graded,
    hits: row.hits,
    misses: row.misses,
    pushes: row.pushes,
    hitRate: row.hitRate,
    roi: row.roi,
    pending: row.pending,
    unsupported: row.unsupported,
    action: decision.action,
    reason: decision.reason
  };
});

const promoted = audited.filter(r => r.action === "PROMOTE_TO_ACTIONABLE_LEAN");
const watch = audited.filter(r => r.action !== "PROMOTE_TO_ACTIONABLE_LEAN");

const output = {
  date,
  generatedAt: new Date().toISOString(),
  source: report.date ? TIER_REPORT : LATEST_TIER_REPORT,
  promoted,
  watch,
  rows: audited
};

writeJson(OUT, output);
writeJson(LATEST, output);

console.log("SHADOW PROMOTION AUDIT");
console.log("----------------------");
console.log("date:", date);
console.log("promoted:", promoted.length);
console.table(audited.filter(r =>
  String(r.bucket).includes("goblin | strikeouts MORE") ||
  String(r.bucket).includes("goblin | walks_allowed MORE") ||
  r.action === "PROMOTE_TO_ACTIONABLE_LEAN"
));
console.log("saved:", OUT);
console.log("saved:", LATEST);
