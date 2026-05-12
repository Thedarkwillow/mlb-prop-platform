const fs = require("fs");

function readJson(p, fallback = []) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function pct(n) {
  return `${(Number(n || 0) * 100).toFixed(1)}%`;
}

function marketOf(r) {
  return String(r.market || r.stat || "").toLowerCase();
}

function typeOf(r) {
  const m = marketOf(r);
  if (m.includes("pitcher")) return "pitcher_fantasy_LESS";
  if (m.includes("hitter")) return "hitter_fantasy_LESS";
  return "unknown_fantasy_LESS";
}

function tierOf(r) {
  return String(r.oddsTier || r.tier || r.payoutTier || "unknown").toLowerCase();
}

function lineBucket(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 2.5) return "low_line_<=2.5";
  if (n <= 5.5) return "mid_low_3_to_5.5";
  if (n <= 8.5) return "mid_6_to_8.5";
  if (n <= 11.5) return "high_9_to_11.5";
  return "very_high_12+";
}

function invertResult(r) {
  if (r.result === "HIT") return "MISS";
  if (r.result === "MISS") return "HIT";
  if (r.result === "PUSH") return "PUSH";
  return null;
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.syntheticLessResult));
  const wins = graded.filter(r => r.syntheticLessResult === "HIT").length;
  const losses = graded.filter(r => r.syntheticLessResult === "MISS").length;
  const pushes = graded.filter(r => r.syntheticLessResult === "PUSH").length;
  const decisions = wins + losses;
  const hitRate = decisions ? wins / decisions : 0;
  const profit = wins - losses;
  const roi = decisions ? profit / decisions : 0;
  return { sample: rows.length, graded: graded.length, decisions, wins, losses, pushes, hitRate, roi, profit };
}

function groupBy(rows, fn) {
  const groups = {};
  for (const r of rows) {
    const k = fn(r);
    groups[k] ||= [];
    groups[k].push(r);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .map(([k, v]) => [k, summarize(v)])
      .sort((a, b) => b[1].decisions - a[1].decisions)
  );
}

const files = fs.existsSync("outputs/history")
  ? fs.readdirSync("outputs/history")
      .filter(f => f.endsWith("-fantasy-grades.json"))
      .map(f => `outputs/history/${f}`)
  : [];

const baseRows = [];

for (const f of files) {
  const rows = readJson(f, []);
  for (const r of rows) {
    if (!marketOf(r).includes("fantasy")) continue;
    if (!["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase())) continue;

    const syntheticLessResult = invertResult(r);
    if (!syntheticLessResult) continue;

    baseRows.push({
      ...r,
      syntheticSide: "LESS",
      syntheticLessResult,
      sourceFile: f
    });
  }
}

const overall = summarize(baseRows);
const byType = groupBy(baseRows, typeOf);
const byLineBucket = groupBy(baseRows, r => lineBucket(r.line));
const byTypeLineBucket = groupBy(baseRows, r => `${typeOf(r)}__${lineBucket(r.line)}`);
const byTier = groupBy(baseRows, tierOf);
const byTeam = groupBy(baseRows, r => r.team || "unknown");

const promotionRules = {
  minDecisions: 250,
  minHitRate: 0.55,
  minRoi: 0.02
};

const playableBuckets = Object.entries(byTypeLineBucket)
  .filter(([, s]) =>
    s.decisions >= promotionRules.minDecisions &&
    s.hitRate >= promotionRules.minHitRate &&
    s.roi >= promotionRules.minRoi
  )
  .map(([key, s]) => ({ key, ...s }));

const recommendation = playableBuckets.length
  ? "LESS_WATCHLIST_BUCKETS_FOUND_REVIEW_MANUALLY"
  : "KEEP_FANTASY_LESS_TRACKING_ONLY";

const report = {
  generatedAt: new Date().toISOString(),
  sourceFiles: files,
  syntheticSide: "LESS",
  rows: baseRows.length,
  promotionRules,
  recommendation,
  overall,
  byType,
  byLineBucket,
  byTypeLineBucket,
  byTier,
  byTeam,
  playableBuckets
};

fs.mkdirSync("data/learning", { recursive: true });
fs.mkdirSync("outputs/learning", { recursive: true });

fs.writeFileSync("data/learning/fantasy-less-learning.json", JSON.stringify(report, null, 2));

const lines = [];
lines.push("SYNTHETIC FANTASY LESS LEARNING REPORT");
lines.push("======================================");
lines.push(`Rows: ${baseRows.length}`);
lines.push(`Overall LESS: ${overall.wins}-${overall.losses}-${overall.pushes} | decisions=${overall.decisions} | hitRate=${pct(overall.hitRate)} | roi=${pct(overall.roi)}`);
lines.push(`Recommendation: ${recommendation}`);
lines.push("");

function section(title, obj) {
  lines.push(title);
  lines.push("-".repeat(title.length));
  for (const [k, s] of Object.entries(obj)) {
    lines.push(`${k}: ${s.wins}-${s.losses}-${s.pushes} | decisions=${s.decisions} | hitRate=${pct(s.hitRate)} | roi=${pct(s.roi)}`);
  }
  lines.push("");
}

section("By Fantasy Type", byType);
section("By Line Bucket", byLineBucket);
section("By Fantasy Type + Line Bucket", byTypeLineBucket);
section("By Tier", byTier);
section("By Team", byTeam);

lines.push("Playable/Watchlist Buckets");
lines.push("--------------------------");
if (!playableBuckets.length) {
  lines.push("None.");
} else {
  for (const b of playableBuckets) {
    lines.push(`${b.key}: ${b.wins}-${b.losses}-${b.pushes} | decisions=${b.decisions} | hitRate=${pct(b.hitRate)} | roi=${pct(b.roi)}`);
  }
}

fs.writeFileSync("outputs/learning/fantasy-less-learning-report.txt", lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("Wrote data/learning/fantasy-less-learning.json");
console.log("Wrote outputs/learning/fantasy-less-learning-report.txt");
