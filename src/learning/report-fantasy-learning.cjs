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

function fantasyType(r) {
  const m = marketOf(r);
  if (m.includes("pitcher")) return "pitcher_fantasy";
  if (m.includes("hitter")) return "hitter_fantasy";
  return "unknown_fantasy";
}

function tierOf(r) {
  return String(r.oddsTier || r.tier || r.payoutTier || "unknown").toLowerCase();
}

function confidenceOf(r) {
  return String(r.confidenceBucket || r.confidence || "unknown").toLowerCase();
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

function duplicateKey(r) {
  return [
    r.player || "",
    r.team || "",
    marketOf(r),
    r.side || "",
    r.line ?? ""
  ].join("|").toLowerCase();
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));
  const wins = graded.filter(r => r.result === "HIT").length;
  const losses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const decisions = wins + losses;
  const hitRate = decisions ? wins / decisions : 0;
  const profit = wins - losses;
  const roi = decisions ? profit / decisions : 0;

  return {
    sample: rows.length,
    graded: graded.length,
    decisions,
    wins,
    losses,
    pushes,
    hitRate,
    roi,
    profit
  };
}

function groupBy(rows, fn) {
  const out = {};
  for (const r of rows) {
    const k = fn(r);
    if (!out[k]) out[k] = [];
    out[k].push(r);
  }
  return Object.fromEntries(
    Object.entries(out)
      .map(([k, v]) => [k, summarize(v)])
      .sort((a, b) => b[1].decisions - a[1].decisions)
  );
}

const files = [
  "outputs/fantasy-graded.json",
  ...fs.existsSync("outputs/history")
    ? fs.readdirSync("outputs/history")
        .filter(f => f.endsWith("-fantasy-grades.json"))
        .map(f => `outputs/history/${f}`)
    : []
];

const rows = [];
for (const f of files) {
  const data = readJson(f, []);
  if (!Array.isArray(data)) continue;
  for (const r of data) {
    if (String(r.result || "").toUpperCase() === "EXCLUDED") continue;
    if (!marketOf(r).includes("fantasy")) continue;
    rows.push({ ...r, sourceFile: f });
  }
}

const byDup = groupBy(rows, duplicateKey);
const duplicateLines = Object.entries(byDup)
  .filter(([, s]) => s.sample > 1)
  .slice(0, 50);

const overall = summarize(rows);
const byType = groupBy(rows, fantasyType);
const byLineBucket = groupBy(rows, r => lineBucket(r.line));
const byTeam = groupBy(rows, r => r.team || "unknown");
const byConfidence = groupBy(rows, confidenceOf);
const byTier = groupBy(rows, tierOf);

const promotionRules = {
  minCleanGradedRows: 250,
  minHitRate: 0.55,
  minRoi: 0.02,
  maxPendingRate: 0.05
};

const pending = rows.filter(r => String(r.result || "").toUpperCase() === "PENDING").length;
const pendingRate = rows.length ? pending / rows.length : 0;

const canPromote =
  overall.decisions >= promotionRules.minCleanGradedRows &&
  overall.hitRate >= promotionRules.minHitRate &&
  overall.roi >= promotionRules.minRoi &&
  pendingRate <= promotionRules.maxPendingRate;

const recommendation = canPromote
  ? "PROMOTION_ELIGIBLE_REVIEW_MANUALLY"
  : "KEEP_BANNED_TRACKING_ONLY";

const report = {
  generatedAt: new Date().toISOString(),
  sourceFiles: files,
  rows: rows.length,
  pending,
  pendingRate,
  promotionRules,
  recommendation,
  overall,
  byType,
  byLineBucket,
  byTier,
  byConfidence,
  byTeam,
  duplicateLines: duplicateLines.map(([key, summary]) => ({ key, ...summary }))
};

fs.mkdirSync("data/learning", { recursive: true });
fs.mkdirSync("outputs/learning", { recursive: true });

fs.writeFileSync("data/learning/fantasy-learning.json", JSON.stringify(report, null, 2));

const lines = [];
lines.push("FANTASY LEARNING REPORT");
lines.push("=======================");
lines.push(`Rows: ${rows.length}`);
lines.push(`Clean decisions: ${overall.decisions}`);
lines.push(`Pending: ${pending} (${pct(pendingRate)})`);
lines.push(`Overall: ${overall.wins}-${overall.losses}-${overall.pushes} | hitRate=${pct(overall.hitRate)} | roi=${pct(overall.roi)}`);
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
section("By Tier", byTier);
section("By Confidence", byConfidence);
section("By Team", byTeam);

lines.push("Duplicate Player/Line Groups");
lines.push("----------------------------");
for (const d of report.duplicateLines.slice(0, 25)) {
  lines.push(`${d.key}: sample=${d.sample} | ${d.wins}-${d.losses}-${d.pushes} | hitRate=${pct(d.hitRate)}`);
}

fs.writeFileSync("outputs/learning/fantasy-learning-report.txt", lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("Wrote data/learning/fantasy-learning.json");
console.log("Wrote outputs/learning/fantasy-learning-report.txt");
