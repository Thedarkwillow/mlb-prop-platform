const fs = require("fs");

const PLAY = "outputs/goblin-context-playability.json";
const CARD = "outputs/goblin-recommended-card.json";
const OUT = "outputs/goblin-construction-gate-audit.json";
const TXT = "outputs/goblin-construction-gate-audit.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function legProb(leg) {
  return num(leg?.probability ?? leg?.prob ?? leg?.modelProbability ?? leg?.winProb ?? 0);
}

function market(leg) {
  return String(leg?.market || leg?.statType || leg?.projectionType || "").toLowerCase();
}

function legs(row) {
  return Array.isArray(row?.legs) ? row.legs : [];
}

function minProb(row) {
  const ps = legs(row).map(legProb).filter(x => x > 0);
  return ps.length ? Math.min(...ps) : num(row?.minProb, 0);
}

function avgProb(row) {
  const ps = legs(row).map(legProb).filter(x => x > 0);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : num(row?.avgProb, 0);
}

function marketCounts(row) {
  const out = {};
  for (const l of legs(row)) {
    const m = market(l);
    if (!m) continue;
    out[m] = (out[m] || 0) + 1;
  }
  return out;
}

function maxMarketCluster(row) {
  const counts = marketCounts(row);
  return Math.max(0, ...Object.values(counts));
}

function threshold(row) {
  const size = Number(row.size || legs(row).length || 0);
  const entry = String(row.entryType || "").toUpperCase();
  if (size === 2 && entry === "POWER") return 0.82;
  if (size === 3 && entry === "FLEX") return 0.80;
  if (size === 3 && entry === "POWER") return 0.81;
  if (size >= 4 && entry === "FLEX") return 0.78;
  if (size >= 4 && entry === "POWER") return 0.80;
  return 0.80;
}

function isPlayableLabel(row) {
  const p = String(row.playability || "").toUpperCase();
  return p === "PRIMARY_TRACK" || p === "WATCHLIST";
}

function gate(row) {
  const fails = [];
  const mp = minProb(row);
  const th = threshold(row);
  const size = Number(row.size || legs(row).length || 0);
  const entry = String(row.entryType || "").toUpperCase();
  const cluster = maxMarketCluster(row);

  if (!isPlayableLabel(row)) fails.push("not_playable_label");
  if (mp < th) fails.push(`weakest_leg_below_${th}`);
  if (size <= 3 && cluster > 2) fails.push("small_slip_market_cluster_gt_2");
  if (size >= 4 && cluster > 3) fails.push("large_slip_market_cluster_gt_3");
  if (String(row.lane || "").includes("highprob_clean") && size >= 4) fails.push("clean_highprob_4plus_shadow_only");
  if (entry === "POWER" && size >= 4) fails.push("4plus_power_shadow_only");

  return {
    id: row.id || row.slipId,
    lane: row.lane,
    size,
    entryType: entry,
    playability: row.playability,
    minProb: mp,
    avgProb: avgProb(row),
    threshold: th,
    maxMarketCluster: cluster,
    markets: marketCounts(row),
    pass: fails.length === 0,
    fails,
    legs: legs(row)
  };
}

const play = readJson(PLAY, {});
const card = readJson(CARD, {});
const rows = Array.isArray(play.slips) ? play.slips : [];
const audits = rows.map(gate);

const passed = audits.filter(x => x.pass);
const failed = audits.filter(x => !x.pass);

const byFail = {};
for (const row of failed) {
  for (const f of row.fails) byFail[f] = (byFail[f] || 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  inputRows: rows.length,
  cardStatus: card.status || null,
  passed: passed.length,
  failed: failed.length,
  byFail,
  topPassed: passed
    .sort((a, b) => (b.minProb - a.minProb) || (b.avgProb - a.avgProb))
    .slice(0, 20),
  topFailed: failed.slice(0, 20),
  rules: {
    "2_POWER_minProb": 0.82,
    "3_FLEX_minProb": 0.80,
    "3_POWER_minProb": 0.81,
    "4plus_FLEX_minProb": 0.78,
    "4plus_POWER_minProb": 0.80,
    "smallSlipMaxMarketCluster": 2,
    "largeSlipMaxMarketCluster": 3,
    "cleanHighprob4Plus": "shadow_only",
    "power4Plus": "shadow_only"
  }
};

const txt = [];
txt.push("GOBLIN CONSTRUCTION GATE AUDIT");
txt.push("==============================");
txt.push(JSON.stringify({
  generatedAt: report.generatedAt,
  inputRows: report.inputRows,
  cardStatus: report.cardStatus,
  passed: report.passed,
  failed: report.failed,
  byFail: report.byFail,
  rules: report.rules
}, null, 2));
txt.push("");
txt.push("TOP PASSED");
txt.push("----------");
if (!report.topPassed.length) {
  txt.push("No passed goblin construction gates right now.");
} else {
  report.topPassed.forEach((r, i) => {
    txt.push(`${i + 1}. ${r.id} | ${r.lane} | ${r.size}-man ${r.entryType} | minProb=${(r.minProb * 100).toFixed(1)}% | avgProb=${(r.avgProb * 100).toFixed(1)}% | cluster=${r.maxMarketCluster}`);
  });
}
txt.push("");
txt.push("TOP FAILED");
txt.push("----------");
report.topFailed.forEach((r, i) => {
  txt.push(`${i + 1}. ${r.id} | ${r.lane} | ${r.size}-man ${r.entryType} | minProb=${(r.minProb * 100).toFixed(1)}% | avgProb=${(r.avgProb * 100).toFixed(1)}% | fails=${r.fails.join(",")}`);
});

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
fs.writeFileSync(TXT, txt.join("\n"));

console.log({
  generatedAt: report.generatedAt,
  inputRows: report.inputRows,
  cardStatus: report.cardStatus,
  passed: report.passed,
  failed: report.failed,
  byFail: report.byFail
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);

if (report.cardStatus !== "NO_PLAYABLE_GOBLIN_CARD" && report.passed === 0) {
  console.error("GOBLIN CONSTRUCTION GATE AUDIT FAILED: card has playable status but no gate-passed rows.");
  process.exit(1);
}
