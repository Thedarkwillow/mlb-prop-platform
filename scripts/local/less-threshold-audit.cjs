const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const OUT_JSON = `outputs/less-threshold-audit-${DATE}.json`;
const OUT_TXT = `outputs/less-threshold-audit-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/less-threshold-audit-latest.json";
const OUT_LATEST_TXT = "outputs/less-threshold-audit-latest.txt";
const HISTORY_FILE = "data/results/less-threshold-audit-history.json";

const ROOTS = ["outputs/history", "outputs"];

const GOOD_LESS_MARKETS = new Set([
  "strikeouts",
  "earned_runs_allowed",
  "pitching_outs",
  "hits_allowed",
  "walks_allowed",
  "home_runs",
  "rbis",
  "hits",
  "runs",
  "walks",
  "bases",
]);

const WATCH_ONLY_MARKETS = new Set([
  "hrr",
  "hitter_fantasy_score",
  "pitcher_fantasy_score",
]);

const SUPPRESS_MARKETS = new Set([
  "runs_allowed",
  "pitches_thrown",
]);

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

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function listJsonFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      listJsonFiles(p, out);
    } else if (
      name.endsWith(".json") &&
      /graded|grade|roi|hardening|decision|full-board|production|playable-final-slips/i.test(name)
    ) {
      out.push(p);
    }
  }
  return out;
}

function flat(v, out = [], seen = new Set()) {
  if (!v || typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  if (Array.isArray(v)) {
    for (const x of v) flat(x, out, seen);
    return out;
  }

  if (
    v.player ||
    v.playerName ||
    v.market ||
    v.statType ||
    v.side ||
    v.direction ||
    v.result ||
    v.gradeResult
  ) {
    out.push(v);
  }

  for (const x of Object.values(v)) flat(x, out, seen);
  return out;
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function marketOf(r) {
  const m = norm(r.market || r.statType || r.projectionType || "unknown");
  if (m === "total_bases") return "bases";
  if (m === "rbi" || m === "rbis") return "rbis";
  if (m === "earned_runs") return "earned_runs_allowed";
  if (m === "pitcher_outs") return "pitching_outs";
  if (m === "pitching_outs") return "pitching_outs";
  if (m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed_") return "walks_allowed";
  if (m === "walks_allowed_less") return "walks_allowed";
  if (m === "walks_allowed_more") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  if (m === "walks_allowed" || m === "walks_allowed") return "walks_allowed";
  return m;
}

function sideOf(r) {
  return String(r.side || r.direction || r.pick || "").toUpperCase();
}

function resultOf(r) {
  return String(r.result || r._result || r.gradeResult || r.status || "").toUpperCase();
}

function tierOf(r) {
  return String(r.tier || r.oddsTier || r.specialTier || "standard").toLowerCase();
}

function probOf(r) {
  const raw =
    r.prob ??
    r.probability ??
    r.calibratedDistributionProb ??
    r.distributionProb ??
    r.modelProbability ??
    r.trueProbability ??
    null;

  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return n > 1 ? n / 100 : n;
}

function supportOf(r) {
  return String(r.support || r.bookSupportFlag || r.pricingSupport || "").toUpperCase();
}

function gradeOf(r) {
  return String(r.grade || r.finalGrade || r.supportGrade || "").toUpperCase();
}

function keyOf(r) {
  return [
    r.date || r.slateDate || r.gameDate || "",
    r.player || r.playerName || "",
    marketOf(r),
    sideOf(r),
    r.line ?? r.target ?? r.threshold ?? ""
  ].join("|").toLowerCase();
}

function summarize(rows) {
  const graded = rows.length;
  const hits = rows.filter(r => r._result === "HIT").length;
  const misses = rows.filter(r => r._result === "MISS").length;
  const avgProb = rows.reduce((a, r) => a + r._prob, 0) / (graded || 1);
  const actual = hits / (graded || 1);
  const gap = actual - avgProb;
  return {
    graded,
    hits,
    misses,
    avgModelProb: graded ? avgProb : null,
    actualHitRate: graded ? actual : null,
    calibrationGap: graded ? gap : null,
  };
}

function pct(v) {
  return v == null || !Number.isFinite(Number(v)) ? "n/a" : `${(Number(v) * 100).toFixed(1)}%`;
}

function thresholdBucket(p) {
  if (p >= 0.675) return "67.5%+";
  if (p >= 0.65) return "65.0-67.5%";
  if (p >= 0.625) return "62.5-65.0%";
  if (p >= 0.60) return "60.0-62.5%";
  if (p >= 0.575) return "57.5-60.0%";
  if (p >= 0.55) return "55.0-57.5%";
  if (p >= 0.50) return "50.0-55.0%";
  return "below_50%";
}

function recommendation(market, summary) {
  if (SUPPRESS_MARKETS.has(market)) return "SUPPRESS_OR_RESEARCH_ONLY";
  if (WATCH_ONLY_MARKETS.has(market)) return "WATCH_ONLY_NEEDS_SPLIT";
  if (!GOOD_LESS_MARKETS.has(market)) return "RESEARCH_ONLY_UNKNOWN_MARKET";
  if (summary.graded < 30) return "WATCH_ONLY_NEEDS_30+";
  if (summary.actualHitRate >= 0.70 && summary.calibrationGap >= 0.05) return "TEST_55_PERCENT_LESS_WATCH";
  if (summary.actualHitRate >= 0.65) return "TEST_57_5_PERCENT_LESS_WATCH";
  return "NO_THRESHOLD_LOWER";
}

const files = [...new Set(ROOTS.flatMap(r => listJsonFiles(r)))];
const seen = new Set();
const rows = [];

for (const f of files) {
  for (const r of flat(readJson(f))) {
    if (sideOf(r) !== "LESS") continue;
    const res = resultOf(r);
    if (!["HIT", "MISS"].includes(res)) continue;

    const prob = probOf(r);
    if (prob === null) continue;

    const key = keyOf(r) + "|" + res;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      ...r,
      _file: f,
      _result: res,
      _prob: prob,
      _market: marketOf(r),
      _tier: tierOf(r),
      _thresholdBucket: thresholdBucket(prob),
      _support: supportOf(r),
      _grade: gradeOf(r),
    });
  }
}

const byMarket = {};
for (const r of rows) {
  if (!byMarket[r._market]) byMarket[r._market] = [];
  byMarket[r._market].push(r);
}

const byThreshold = {};
for (const r of rows) {
  if (!byThreshold[r._thresholdBucket]) byThreshold[r._thresholdBucket] = [];
  byThreshold[r._thresholdBucket].push(r);
}

const byMarketThreshold = {};
for (const r of rows) {
  const k = `${r._market}|${r._thresholdBucket}`;
  if (!byMarketThreshold[k]) byMarketThreshold[k] = [];
  byMarketThreshold[k].push(r);
}

const marketSummary = {};
for (const [market, rs] of Object.entries(byMarket)) {
  const s = summarize(rs);
  marketSummary[market] = {
    ...s,
    recommendation: recommendation(market, s),
  };
}

const thresholdSummary = {};
for (const [bucket, rs] of Object.entries(byThreshold)) {
  thresholdSummary[bucket] = summarize(rs);
}

const marketThresholdSummary = {};
for (const [key, rs] of Object.entries(byMarketThreshold)) {
  marketThresholdSummary[key] = summarize(rs);
}

const testBuckets = {};
for (const floor of [0.55, 0.575, 0.60, 0.625, 0.65, 0.675]) {
  const key = `${(floor * 100).toFixed(1)}%+`;
  testBuckets[key] = summarize(rows.filter(r => r._prob >= floor && GOOD_LESS_MARKETS.has(r._market)));
}

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  mode: "REPORT_ONLY",
  policy: {
    noSlipBuilderMutation: true,
    noOfficialPromotion: true,
    purpose: "Audit whether selected LESS markets deserve lower report-only watch thresholds.",
    currentActionableFloor: "60%",
    testedFloors: ["55%", "57.5%", "60%", "62.5%", "65%", "67.5%"],
  },
  overall: summarize(rows),
  testBuckets,
  byMarket: marketSummary,
  byThreshold: thresholdSummary,
  byMarketThreshold: marketThresholdSummary,
};

writeJson(OUT_JSON, report);
writeJson(OUT_LATEST_JSON, report);

const history = readJson(HISTORY_FILE, []);
const nextHistory = Array.isArray(history) ? history.filter(r => r.date !== DATE) : [];
nextHistory.push({
  date: DATE,
  generatedAt: report.generatedAt,
  overall: report.overall,
  testBuckets: report.testBuckets,
  byMarket: report.byMarket,
});
writeJson(HISTORY_FILE, nextHistory.sort((a, b) => String(a.date).localeCompare(String(b.date))));

const lines = [];
lines.push("LESS THRESHOLD AUDIT");
lines.push("====================");
lines.push(`date=${DATE}`);
lines.push("mode=REPORT_ONLY");
lines.push("policy=no slip-builder mutation; no official promotion");
lines.push("");

lines.push("OVERALL LESS");
lines.push("------------");
lines.push(`graded=${report.overall.graded} hits=${report.overall.hits} misses=${report.overall.misses} avgProb=${pct(report.overall.avgModelProb)} actual=${pct(report.overall.actualHitRate)} gap=${pct(report.overall.calibrationGap)}`);
lines.push("");

lines.push("TESTED LESS FLOORS - GOOD MARKETS ONLY");
lines.push("--------------------------------------");
for (const [bucket, s] of Object.entries(report.testBuckets)) {
  lines.push(`${bucket}: graded=${s.graded} hits=${s.hits} misses=${s.misses} avgProb=${pct(s.avgModelProb)} actual=${pct(s.actualHitRate)} gap=${pct(s.calibrationGap)}`);
}
lines.push("");

lines.push("BY MARKET");
lines.push("---------");
for (const [market, s] of Object.entries(report.byMarket).sort((a, b) => b[1].graded - a[1].graded)) {
  lines.push(`${market}: graded=${s.graded} hits=${s.hits} misses=${s.misses} avgProb=${pct(s.avgModelProb)} actual=${pct(s.actualHitRate)} gap=${pct(s.calibrationGap)} action=${s.recommendation}`);
}
lines.push("");

lines.push("BY PROBABILITY THRESHOLD");
lines.push("------------------------");
for (const [bucket, s] of Object.entries(report.byThreshold).sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(`${bucket}: graded=${s.graded} hits=${s.hits} misses=${s.misses} avgProb=${pct(s.avgModelProb)} actual=${pct(s.actualHitRate)} gap=${pct(s.calibrationGap)}`);
}

writeText(OUT_TXT, lines.join("\n"));
writeText(OUT_LATEST_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved history: ${HISTORY_FILE}`);
