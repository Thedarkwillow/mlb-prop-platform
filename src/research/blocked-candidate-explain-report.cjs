const fs = require("fs");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FINAL = "outputs/final-slips.json";
const BLOCKED = "outputs/blocked-candidates.json";
const LINE_AUDIT = "outputs/line-specific-block-audit-latest.json";
const CONTROLLED = "outputs/controlled-line-unlocks-latest.json";
const LEANS = "outputs/lean-final-slips.json";
const CONTEXT = "outputs/context/context-coverage-report-latest.json";
const OUT = `outputs/blocked-candidate-explain-${date}.json`;
const LATEST = "outputs/blocked-candidate-explain-latest.json";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(require("path").dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function n(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function pct(v) {
  const x = n(v);
  if (x === null) return "n/a";
  return `${(x * 100).toFixed(1)}%`;
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function keyOf(r) {
  return [
    norm(r.player || r.playerName || r.name),
    String(r.market || "").toLowerCase(),
    String(r.side || r.recommendedSide || "").toUpperCase(),
    String(r.line ?? r.ppLine ?? "")
  ].join("|");
}

function arr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.rows)) return v.rows;
  if (Array.isArray(v.candidates)) return v.candidates;
  if (Array.isArray(v.blocked)) return v.blocked;
  if (Array.isArray(v.legs)) return v.legs;
  if (Array.isArray(v.topLegs)) return v.topLegs;
  return [];
}

function getReasons(r) {
  const out = [];
  for (const k of [
    "reason",
    "blockedReason",
    "disabledReason",
    "gateReason",
    "rejectionReason"
  ]) {
    if (r[k]) out.push(String(r[k]));
  }
  if (Array.isArray(r.reasons)) out.push(...r.reasons.map(String));
  if (Array.isArray(r.gateReasons)) out.push(...r.gateReasons.map(String));
  if (Array.isArray(r.officialGateReasons)) out.push(...r.officialGateReasons.map(String));
  if (Array.isArray(r.finalExecutionGate?.reasons)) out.push(...r.finalExecutionGate.reasons.map(String));
  if (Array.isArray(r.leanNotes)) out.push(...r.leanNotes.map(String));
  return [...new Set(out.filter(Boolean))];
}

function classify(row, auditRow, controlledRow, leanRow) {
  const prob = n(row.prob ?? row.recommendedProb ?? row.calibratedProb ?? row.distributionProb);
  const edge = n(row.edge ?? row.expectedValue ?? row.adjustedEdge ?? row.adjEdge);
  const score = n(row.score ?? row.officialScore ?? row.executionScore);
  const books = n(row.books ?? row.bookCount ?? row.supportingBooks);
  const market = String(row.market || "").toLowerCase();
  const side = String(row.side || row.recommendedSide || "").toUpperCase();
  const tier = String(row.oddsTier || row.tier || "").toLowerCase();
  const support = row.support || row.marketSupportFlag || row.priceCoverageTier || null;
  const reasons = getReasons(row);

  const flags = [];
  if (controlledRow) flags.push("CONTROLLED_UNLOCK_PRESENT");
  if (leanRow) flags.push("LEAN_REPORT_PRESENT");
  if (auditRow?.candidateClass) flags.push(`LINE_AUDIT:${auditRow.candidateClass}`);
  if (prob !== null && prob >= 0.72) flags.push("HIGH_PROB");
  if (edge !== null && edge >= 0.08) flags.push("HIGH_EDGE");
  if (books !== null && books >= 2) flags.push("BOOK_SUPPORT_OK");
  if (support === "LOW_BOOK_SUPPORT" || books === 1) flags.push("LOW_BOOK_SUPPORT");
  if (tier === "goblin" || tier === "demon") flags.push("SPECIAL_TIER");
  if (market === "bases" && side === "MORE" && Number(row.line) === 0.5) flags.push("BASES_MORE_0_5");
  if (reasons.some(x => /weak_confidence/i.test(x))) flags.push("WEAK_CONFIDENCE");
  if (reasons.some(x => /score_below|adaptive|floor/i.test(x))) flags.push("SCORE_GATE_FAIL");
  if (reasons.some(x => /market_gate|market/i.test(x))) flags.push("MARKET_GATE_FAIL");
  if (reasons.some(x => /volatility/i.test(x))) flags.push("VOLATILITY_FAIL");

  let recommendation = "BLOCKED";
  let action = "do_not_play";

  if (controlledRow) {
    recommendation = "LEAN_MANUAL_REVIEW";
    action = "track_only_manual_review";
  } else if (
    prob !== null &&
    prob >= 0.69 &&
    edge !== null &&
    edge >= 0.08 &&
    !flags.includes("MARKET_GATE_FAIL") &&
    !flags.includes("VOLATILITY_FAIL")
  ) {
    recommendation = "WATCHLIST";
    action = "track_before_unlock";
  } else if (
    prob !== null &&
    prob >= 0.66 &&
    edge !== null &&
    edge >= 0.07
  ) {
    recommendation = "TRACK_ONLY";
    action = "collect_result_no_play";
  }

  if (tier === "goblin" && side === "LESS") {
    recommendation = "BLOCKED";
    action = "blocked_special_less_rule";
  }
  if (tier === "demon" && side === "LESS") {
    recommendation = "BLOCKED";
    action = "blocked_special_less_rule";
  }

  return {
    recommendation,
    action,
    flags,
    reasons
  };
}

const final = readJson(FINAL, {});
const blockedRaw = readJson(BLOCKED, []);
const audit = readJson(LINE_AUDIT, {});
const controlled = readJson(CONTROLLED, {});
const leans = readJson(LEANS, {});
const context = readJson(CONTEXT, {});

const topLegs = arr(final.topLegs || final);
const blockedRows = arr(blockedRaw);
const all = [...topLegs, ...blockedRows];

const seen = new Set();
const unique = [];
for (const r of all) {
  const k = keyOf(r);
  if (!k.replace(/\|/g, "")) continue;
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(r);
}

const auditByKey = new Map(arr(audit.rows || audit.interesting || audit.candidates || audit).map(r => [keyOf(r), r]));
const controlledByKey = new Map(arr(controlled.rows || controlled.candidates || controlled).map(r => [keyOf(r), r]));
const leanByKey = new Map(arr(leans.leans || leans).map(r => [keyOf(r), r]));

const rows = unique.map(r => {
  const k = keyOf(r);
  const auditRow = auditByKey.get(k) || null;
  const controlledRow = controlledByKey.get(k) || null;
  const leanRow = leanByKey.get(k) || null;
  const classification = classify(r, auditRow, controlledRow, leanRow);

  return {
    player: r.player || r.playerName || r.name || null,
    team: r.team || r.resolvedTeam || null,
    game: r.game || r.resolvedGame || null,
    market: r.market || null,
    side: r.side || r.recommendedSide || null,
    line: r.line ?? r.ppLine ?? null,
    oddsTier: r.oddsTier || r.tier || null,
    prob: n(r.prob ?? r.recommendedProb ?? r.calibratedProb ?? r.distributionProb),
    edge: n(r.edge ?? r.expectedValue ?? r.adjustedEdge ?? r.adjEdge),
    score: n(r.score ?? r.officialScore ?? r.executionScore),
    books: n(r.books ?? r.bookCount ?? r.supportingBooks),
    support: r.support || r.marketSupportFlag || r.priceCoverageTier || null,
    grade: r.grade || null,
    auditClass: auditRow?.candidateClass || auditRow?.class || null,
    controlledUnlock: Boolean(controlledRow),
    leanReport: Boolean(leanRow),
    recommendation: classification.recommendation,
    action: classification.action,
    flags: classification.flags,
    failReasons: classification.reasons
  };
}).sort((a, b) =>
  (b.controlledUnlock ? 1 : 0) - (a.controlledUnlock ? 1 : 0) ||
  (b.prob ?? 0) - (a.prob ?? 0) ||
  (b.edge ?? 0) - (a.edge ?? 0)
);

const byRecommendation = rows.reduce((acc, r) => {
  acc[r.recommendation] = (acc[r.recommendation] || 0) + 1;
  return acc;
}, {});

const reasonCounts = {};
for (const r of rows) {
  for (const reason of r.failReasons || []) {
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }
}

const out = {
  date,
  generatedAt: new Date().toISOString(),
  mode: "BLOCKED_CANDIDATE_EXPLAIN_REPORT",
  warning: "Diagnostic only. Does not promote official plays.",
  counts: {
    totalRows: rows.length,
    byRecommendation,
    controlledUnlocks: rows.filter(r => r.controlledUnlock).length,
    leanReportRows: rows.filter(r => r.leanReport).length
  },
  contextHealth: context.percentages || context.coverage || null,
  topRecommendations: rows.filter(r => r.recommendation !== "BLOCKED").slice(0, 20),
  rows,
  reasonCounts: Object.entries(reasonCounts)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
};

writeJson(OUT, out);
writeJson(LATEST, out);

console.log("BLOCKED CANDIDATE EXPLAIN REPORT");
console.log("--------------------------------");
console.log("date:", date);
console.log("rows:", rows.length);
console.log("by recommendation:", byRecommendation);
console.log("");
console.log("Top non-blocked diagnostics:");
console.table(out.topRecommendations.map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  tier: r.oddsTier,
  prob: pct(r.prob),
  edge: r.edge,
  rec: r.recommendation,
  action: r.action,
  flags: r.flags.slice(0, 4).join(",")
})));
console.log("");
console.log("Top blocked/fail reasons:");
console.table(out.reasonCounts.slice(0, 15));
console.log("saved:", OUT);
console.log("saved:", LATEST);
