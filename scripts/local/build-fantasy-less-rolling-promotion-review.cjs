const fs = require("fs");
const path = require("path");

const OUT = "outputs/fantasy-less-rolling-promotion-review.json";
const TXT = "outputs/fantasy-less-rolling-promotion-review.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function pct(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "n/a";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function listHistory(pattern) {
  const dir = "outputs/history";
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => pattern.test(f))
    .map(f => path.join(dir, f))
    .sort();
}

function dateFromFile(file) {
  const m = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : "unknown";
}

function gateSummary(gate) {
  const byMarket = gate?.byMarket || gate?.marketBuckets || {};
  const byLine = gate?.byLineBucket || gate?.byLine || gate?.lineBuckets || {};
  const byCombo = gate?.byMarketLineBucket || gate?.topBuckets || {};

  return { byMarket, byLine, byCombo };
}

function rowsOf(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) rowsOf(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (
    v.player || v.playerName || v.market || v.statType || v.side ||
    v.line || v.result || v.actual != null
  ) out.push(v);
  for (const x of Object.values(v)) {
    if (x && typeof x === "object") rowsOf(x, out);
  }
  return out;
}

function summarizeRows(rows) {
  const result = {
    total: rows.length,
    hit: 0,
    miss: 0,
    push: 0,
    unmatched: 0,
    graded: 0,
    hitRate: null
  };

  for (const r of rows) {
    const res = String(r.result || r.grade || r.outcome || "").toLowerCase();
    if (res === "hit") {
      result.hit++;
      result.graded++;
    } else if (res === "miss") {
      result.miss++;
      result.graded++;
    } else if (res === "push") {
      result.push++;
      result.graded++;
    } else if (res === "unmatched") {
      result.unmatched++;
    }
  }

  const denom = result.hit + result.miss;
  result.hitRate = denom > 0 ? result.hit / denom : null;
  return result;
}

function decisionFromRolling({ dates, officialRows, guardBlocked, gateRows }) {
  const reasons = [];
  const s = summarizeRows(officialRows);

  if (dates.length < 3) reasons.push("needs_3_plus_dates");
  if (s.graded < 75) reasons.push("official_sample_below_75");
  if (s.hitRate == null || s.hitRate < 0.58) reasons.push("hit_rate_below_58_percent");

  const unmatchedRate = s.total > 0 ? s.unmatched / s.total : 0;
  if (unmatchedRate > 0.10) reasons.push("unmatched_rate_above_10_percent");

  const guardBlockedTotal = guardBlocked.reduce((a, b) => a + b.count, 0);
  if (guardBlockedTotal > 0) reasons.push("guard_blocks_present");

  const gatePromotionDates = gateRows.filter(x => x.gateDecision === "PROMOTION_REVIEW").length;
  if (gatePromotionDates < Math.min(3, dates.length || 3)) reasons.push("not_enough_promotion_review_dates");

  let decision = "RESEARCH_ONLY";
  if (!reasons.length) decision = "PROMOTION_REVIEW";
  if (s.graded >= 150 && s.hitRate >= 0.60 && unmatchedRate <= 0.05 && dates.length >= 5) {
    decision = "CANDIDATE_ELIGIBLE_REVIEW";
  }

  return { decision, reasons: reasons.length ? reasons : ["meets_current_review_thresholds"], summary: s };
}

const gateFiles = listHistory(/^\d{4}-\d{2}-\d{2}-fantasy-less-promotion-gate\.json$/);
const candidateFiles = listHistory(/^\d{4}-\d{2}-\d{2}-fantasy-less-promotion-candidates\.json$/);

const byDate = new Map();

for (const file of gateFiles) {
  const date = dateFromFile(file);
  const gate = readJson(file, {});
  const s = gateSummary(gate);
  const rec = byDate.get(date) || { date };
  rec.gateFile = file;
  rec.gateDecision =
    gate?.decision ||
    s.byMarket?.hitter_fantasy_score?.decision ||
    s.byCombo?.["hitter_fantasy_score|9.5_12.5"]?.decision ||
    "UNKNOWN";
  rec.gate = gate;
  byDate.set(date, rec);
}

for (const file of candidateFiles) {
  const date = dateFromFile(file);
  const data = readJson(file, {});
  const rec = byDate.get(date) || { date };
  rec.candidateFile = file;
  rec.candidates = data;
  byDate.set(date, rec);
}

const dates = [...byDate.keys()].sort();

const daily = [];
const officialRows = [];
const guardBlocked = [];
const gateRows = [];

for (const date of dates) {
  const rec = byDate.get(date);
  const candidates = rec.candidates || {};

  const official =
    Array.isArray(candidates.officialEligibleRows) ? candidates.officialEligibleRows :
    Array.isArray(candidates.officialEligible) ? candidates.officialEligible :
    [];

  const blocked =
    Array.isArray(candidates.guardBlockedRows) ? candidates.guardBlockedRows :
    Array.isArray(candidates.guardBlocked) ? candidates.guardBlocked :
    [];

  const officialSummary = summarizeRows(official);
  const blockedSummary = summarizeRows(blocked);

  officialRows.push(...official);
  guardBlocked.push({ date, count: blocked.length });
  gateRows.push({ date, gateDecision: rec.gateDecision });

  daily.push({
    date,
    gateDecision: rec.gateDecision,
    officialEligible: official.length,
    guardBlocked: blocked.length,
    officialSummary,
    blockedSummary
  });
}

const rollingDecision = decisionFromRolling({
  dates,
  officialRows,
  guardBlocked,
  gateRows
});

const report = {
  generatedAt: new Date().toISOString(),
  lane: "fantasy_less_hitter_9_5_to_12_5",
  decision: rollingDecision.decision,
  reasons: rollingDecision.reasons,
  dates,
  daily,
  rollingSummary: rollingDecision.summary,
  gateRows,
  guardBlocked,
  rule: "Fantasy LESS can only move beyond research after multiple dates of clean STANDARD hitter_fantasy_score LESS 9.5-12.5 performance, low unmatched rate, and guard-clean game context."
};

const lines = [];
lines.push("FANTASY LESS ROLLING PROMOTION REVIEW");
lines.push("=====================================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`lane=${report.lane}`);
lines.push(`decision=${report.decision}`);
lines.push(`reasons=${report.reasons.join(", ")}`);
lines.push(`dates=${dates.join(", ") || "none"}`);
lines.push("");
lines.push("ROLLING SUMMARY");
lines.push("---------------");
lines.push(`officialRows=${report.rollingSummary.total}`);
lines.push(`graded=${report.rollingSummary.graded}`);
lines.push(`hits=${report.rollingSummary.hit}`);
lines.push(`misses=${report.rollingSummary.miss}`);
lines.push(`pushes=${report.rollingSummary.push}`);
lines.push(`unmatched=${report.rollingSummary.unmatched}`);
lines.push(`hitRate=${pct(report.rollingSummary.hitRate)}`);
lines.push("");
lines.push("DAILY");
lines.push("-----");
for (const d of daily) {
  lines.push(
    `${d.date}: gate=${d.gateDecision} officialEligible=${d.officialEligible} guardBlocked=${d.guardBlocked} ` +
    `graded=${d.officialSummary.graded} hitRate=${pct(d.officialSummary.hitRate)} unmatched=${d.officialSummary.unmatched}`
  );
}
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push(report.rule);

writeJson(OUT, report);
writeText(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: report.generatedAt,
  lane: report.lane,
  decision: report.decision,
  reasons: report.reasons,
  dates: dates.length,
  officialRows: report.rollingSummary.total,
  graded: report.rollingSummary.graded,
  hitRate: report.rollingSummary.hitRate
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
