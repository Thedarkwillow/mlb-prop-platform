const fs = require("fs");

function argDate() {
  const eq = process.argv.find(x => x.startsWith("--date="));
  if (eq) return eq.split("=")[1];
  const plain = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return plain || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const IN = `outputs/fantasy-less-history-graded-${DATE}-to-${DATE}.json`;
const OUT = "outputs/fantasy-less-promotion-gate.json";
const TXT = "outputs/fantasy-less-promotion-gate.txt";
const HIST_OUT = `outputs/history/${DATE}-fantasy-less-promotion-gate.json`;
const HIST_TXT = `outputs/history/${DATE}-fantasy-less-promotion-gate.txt`;

function readJson(p, f = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return f; }
}

function writeJson(p, v) {
  fs.mkdirSync(require("path").dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
}

function writeText(p, t) {
  fs.mkdirSync(require("path").dirname(p), { recursive: true });
  fs.writeFileSync(p, t);
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function normMarket(v) {
  return s(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function marketOf(r) {
  const m = normMarket(r.market || r.statType || r.projectionType || r.stat);
  if (m.includes("pitcher") && m.includes("fantasy")) return "pitcher_fantasy_score";
  if (m.includes("hitter") && m.includes("fantasy")) return "hitter_fantasy_score";
  return m;
}

function playerOf(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}

function sideOf(r) {
  return s(r.side || r.pick || r.direction).toUpperCase();
}

function lineBucket(line) {
  const x = n(line);
  if (x === null) return "unknown";
  if (x <= 5.5) return "4.5_5.5";
  if (x <= 8.5) return "6.5_8.5";
  if (x <= 12.5) return "9.5_12.5";
  if (x <= 20.5) return "13.5_20.5";
  return "21.5_plus";
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (playerOf(v) || marketOf(v) || v.result || v.actual !== undefined || v.line !== undefined) out.push(v);
  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flat(x, out);
  }
  return out;
}

function resultOf(r) {
  const raw = s(r.result || r.outcome || r.grade).toUpperCase();
  if (raw.includes("HIT") || raw === "WIN") return "hit";
  if (raw.includes("MISS") || raw === "LOSS") return "miss";
  if (raw.includes("PUSH")) return "push";
  if (raw.includes("REFUND")) return "refund";
  if (raw.includes("UNMATCH")) return "unmatched";
  return "unmatched";
}

function emptyBucket() {
  return {
    rows: 0,
    graded: 0,
    hits: 0,
    misses: 0,
    pushes: 0,
    refunds: 0,
    unmatched: 0,
    hitRate: null,
    roiProxy: null,
    decision: "RESEARCH_ONLY",
    reasons: []
  };
}

function add(bucket, r) {
  bucket.rows++;
  const res = resultOf(r);
  if (res === "hit") bucket.hits++;
  else if (res === "miss") bucket.misses++;
  else if (res === "push") bucket.pushes++;
  else if (res === "refund") bucket.refunds++;
  else bucket.unmatched++;

  if (res === "hit" || res === "miss" || res === "push") bucket.graded++;
}

function finalize(bucket) {
  const denom = bucket.hits + bucket.misses;
  bucket.hitRate = denom > 0 ? +(bucket.hits / denom).toFixed(4) : null;
  bucket.roiProxy = bucket.hitRate == null ? null : +((bucket.hitRate * 2 - 1) * 100).toFixed(1);

  const unmatchedRate = bucket.rows > 0 ? bucket.unmatched / bucket.rows : 0;

  const reasons = [];
  if (bucket.graded < 25) reasons.push("sample_below_25");
  if (bucket.graded >= 25 && bucket.graded < 50) reasons.push("sample_below_50");
  if (unmatchedRate > 0.15) reasons.push("unmatched_rate_above_15_percent");
  if (bucket.hitRate !== null && bucket.hitRate < 0.56) reasons.push("hit_rate_below_56_percent");
  if (bucket.roiProxy !== null && bucket.roiProxy < 8) reasons.push("roi_proxy_below_8_percent");

  if (
    bucket.graded >= 25 &&
    unmatchedRate <= 0.15 &&
    bucket.hitRate !== null &&
    bucket.hitRate >= 0.56 &&
    bucket.roiProxy !== null &&
    bucket.roiProxy >= 8
  ) {
    bucket.decision = "PROMOTION_REVIEW";
    bucket.reasons = ["meets_minimum_sample_hit_rate_roi_unmatched_thresholds"];
  } else {
    bucket.decision = "RESEARCH_ONLY";
    bucket.reasons = reasons.length ? reasons : ["insufficient_edge"];
  }

  return bucket;
}

const data = readJson(IN, null);
const rows = flat(data).filter(r => {
  const m = marketOf(r);
  return sideOf(r) === "LESS" && (m === "hitter_fantasy_score" || m === "pitcher_fantasy_score");
});

const byMarket = {};
const byLineBucket = {};
const byMarketLine = {};
const eligibleRows = [];
const blockedRows = [];

for (const r of rows) {
  const market = marketOf(r);
  const lb = lineBucket(r.line ?? r.statValue ?? r.value);
  const ml = `${market}|${lb}`;

  byMarket[market] ||= emptyBucket();
  byLineBucket[lb] ||= emptyBucket();
  byMarketLine[ml] ||= emptyBucket();

  add(byMarket[market], r);
  add(byLineBucket[lb], r);
  add(byMarketLine[ml], r);
}

for (const obj of [byMarket, byLineBucket, byMarketLine]) {
  for (const k of Object.keys(obj)) finalize(obj[k]);
}

function gateForRow(r) {
  const market = marketOf(r);
  const lb = lineBucket(r.line ?? r.statValue ?? r.value);
  const ml = `${market}|${lb}`;
  return byMarketLine[ml] || byLineBucket[lb] || byMarket[market] || emptyBucket();
}

for (const r of rows) {
  const gate = gateForRow(r);
  const row = {
    player: playerOf(r),
    team: s(r.team),
    game: s(r.game),
    market: marketOf(r),
    side: sideOf(r),
    line: n(r.line ?? r.statValue ?? r.value),
    actual: n(r.actual ?? r.actualValue ?? r.final ?? r.score),
    result: resultOf(r),
    lineBucket: lineBucket(r.line ?? r.statValue ?? r.value),
    gateDecision: gate.decision,
    gateReasons: gate.reasons
  };

  if (gate.decision === "PROMOTION_REVIEW") eligibleRows.push(row);
  else blockedRows.push(row);
}

const topBuckets = Object.entries(byMarketLine)
  .map(([bucket, v]) => ({ bucket, ...v }))
  .sort((a, b) => {
    const ar = a.roiProxy ?? -999;
    const br = b.roiProxy ?? -999;
    if (br !== ar) return br - ar;
    return b.graded - a.graded;
  });

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  source: IN,
  rows: rows.length,
  eligibleRows: eligibleRows.length,
  blockedRows: blockedRows.length,
  byMarket,
  byLineBucket,
  byMarketLine,
  topBuckets,
  eligibleSample: eligibleRows.slice(0, 25),
  blockedSample: blockedRows.slice(0, 25)
};

writeJson(OUT, report);
writeJson(HIST_OUT, report);

function pct(v) {
  return v == null ? "n/a" : `${(v * 100).toFixed(1)}%`;
}

const lines = [];
lines.push("FANTASY LESS PROMOTION GATE");
lines.push("===========================");
lines.push(`date=${DATE}`);
lines.push(`rows=${report.rows}`);
lines.push(`eligibleRows=${report.eligibleRows}`);
lines.push(`blockedRows=${report.blockedRows}`);
lines.push("");
lines.push("BY MARKET");
lines.push("---------");
for (const [k, v] of Object.entries(byMarket)) {
  lines.push(`${k}: decision=${v.decision} graded=${v.graded}/${v.rows} hitRate=${pct(v.hitRate)} roiProxy=${v.roiProxy == null ? "n/a" : v.roiProxy + "%"} unmatched=${v.unmatched} reasons=${v.reasons.join(", ")}`);
}
lines.push("");
lines.push("BY LINE BUCKET");
lines.push("--------------");
for (const [k, v] of Object.entries(byLineBucket)) {
  lines.push(`${k}: decision=${v.decision} graded=${v.graded}/${v.rows} hitRate=${pct(v.hitRate)} roiProxy=${v.roiProxy == null ? "n/a" : v.roiProxy + "%"} unmatched=${v.unmatched} reasons=${v.reasons.join(", ")}`);
}
lines.push("");
lines.push("TOP MARKET+LINE BUCKETS");
lines.push("-----------------------");
for (const b of topBuckets.slice(0, 20)) {
  lines.push(`${b.bucket}: decision=${b.decision} graded=${b.graded}/${b.rows} hitRate=${pct(b.hitRate)} roiProxy=${b.roiProxy == null ? "n/a" : b.roiProxy + "%"} unmatched=${b.unmatched} reasons=${b.reasons.join(", ")}`);
}
lines.push("");
lines.push("ELIGIBLE SAMPLE");
lines.push("---------------");
if (!eligibleRows.length) lines.push("none");
for (const r of eligibleRows.slice(0, 25)) {
  lines.push(`${r.player} | ${r.market} LESS ${r.line} | actual=${r.actual ?? "?"} | result=${r.result} | bucket=${r.lineBucket}`);
}

writeText(TXT, lines.join("\n") + "\n");
writeText(HIST_TXT, lines.join("\n") + "\n");

console.log({
  date: DATE,
  rows: report.rows,
  eligibleRows: report.eligibleRows,
  blockedRows: report.blockedRows,
  topBuckets: topBuckets.slice(0, 5).map(b => ({
    bucket: b.bucket,
    decision: b.decision,
    graded: b.graded,
    rows: b.rows,
    hitRate: b.hitRate,
    roiProxy: b.roiProxy,
    unmatched: b.unmatched
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
