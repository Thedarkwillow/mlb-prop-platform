const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function bucketLine(line) {
  const n = Number(line);
  if (!Number.isFinite(n)) return "unknown";
  if (n <= 0.5) return "<=0.5";
  if (n <= 1.5) return "1.0-1.5";
  if (n <= 2.5) return "2.0-2.5";
  if (n <= 3.5) return "3.0-3.5";
  if (n <= 5.5) return "4.0-5.5";
  if (n <= 7.5) return "6.0-7.5";
  return "8.0+";
}

function normMarket(x) {
  return String(x || "").toLowerCase().trim();
}

function normSide(x) {
  return String(x || "").toUpperCase().trim();
}

function flagsOf(row) {
  const flags = new Set();

  for (const f of row.contextAdjustment?.flags || []) flags.add(f);
  for (const f of row.handednessAdjustment?.flags || []) flags.add(f);
  for (const f of row.contactQualityAdjustment?.flags || []) flags.add(f);
  for (const f of row.pitchTypeMatchupFlags || []) flags.add(f);
  for (const f of row.savantRollingForm?.flags || []) flags.add(f);

  return [...flags];
}

function sameRule(rule, row) {
  return (
    normMarket(rule.market) === normMarket(row.market) &&
    normSide(rule.side) === normSide(row.recommendedSide || row.side) &&
    String(rule.bucket) === bucketLine(row.line)
  );
}

const board = readJson("outputs/priced-board.json", [])
  .filter(r => r && (r.recordType === "merged_prop" || r.player));

const rules = readJson("data/rules/phase8-execution-rules.json", {});

const allowRules = rules.lineBuckets?.allow || [];
const blockRules = rules.lineBuckets?.block || [];

const preferred = new Set(rules.preferredSignals || []);
const avoid = new Set(rules.avoidSignals || []);

const minProb = Number(rules.minimums?.recommendedProb ?? 0);
const minEV = Number(rules.minimums?.expectedValue ?? -999);

const audited = board.map(row => {
  const market = normMarket(row.market);
  const side = normSide(row.recommendedSide || row.side);
  const bucket = bucketLine(row.line);
  const prob = Number(row.recommendedProb ?? row.probability ?? row.prob);
  const ev = Number(row.expectedValue ?? row.ev);

  const flags = flagsOf(row);
  const preferredHits = flags.filter(f => preferred.has(f));
  const avoidHits = flags.filter(f => avoid.has(f));

  const lineAllowed = allowRules.some(rule => sameRule(rule, row));
  const lineBlocked = blockRules.some(rule => sameRule(rule, row));

  const problems = [];

  if (lineBlocked) problems.push("BLOCKED_LINE_BUCKET");
  if (!lineAllowed) problems.push("UNPROVEN_LINE_BUCKET");
  if (Number.isFinite(prob) && prob < minProb) problems.push("LOW_PROBABILITY");
  if (Number.isFinite(ev) && ev < minEV) problems.push("LOW_EV");
  if (avoidHits.length) problems.push("AVOID_SIGNAL");
  if (!preferredHits.length) problems.push("NO_PREFERRED_SIGNAL");

  const phase8Status = problems.includes("BLOCKED_LINE_BUCKET")
    ? "BLOCK"
    : problems.length
      ? "WATCH"
      : "PASS";

  return {
    player: row.player,
    team: row.team || row.resolvedTeam,
    market,
    side,
    line: row.line,
    lineBucket: bucket,
    oddsTier: row.oddsTier,
    recommendedProb: prob,
    expectedValue: ev,
    confidenceBucket: row.confidenceBucket,
    phase8Status,
    phase8Problems: problems,
    preferredSignals: preferredHits,
    avoidSignals: avoidHits,
    pitchTypeMatchupTier: row.pitchTypeMatchupTier,
    ownBullpenFatigueTier: row.ownBullpenFatigueTier,
    opponentBullpenFatigueTier: row.opponentBullpenFatigueTier,
    opponentCatcherFramingTier: row.opponentCatcherFramingTier
  };
});

const summary = {
  total: audited.length,
  pass: audited.filter(r => r.phase8Status === "PASS").length,
  watch: audited.filter(r => r.phase8Status === "WATCH").length,
  block: audited.filter(r => r.phase8Status === "BLOCK").length,
  byProblem: {}
};

for (const r of audited) {
  for (const p of r.phase8Problems) {
    summary.byProblem[p] = (summary.byProblem[p] || 0) + 1;
  }
}

const ranked = audited
  .sort((a, b) => {
    const score = x =>
      (x.phase8Status === "PASS" ? 100 : x.phase8Status === "WATCH" ? 10 : -100) +
      (Number(x.expectedValue) || 0) +
      (Number(x.recommendedProb) || 0);
    return score(b) - score(a);
  });

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync("outputs/phase8-candidate-audit.json", JSON.stringify({ summary, candidates: ranked }, null, 2));

console.log("PHASE 8 CANDIDATE AUDIT");
console.log("=======================");
console.log(summary);
console.table(ranked.slice(0, 30).map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  bucket: r.lineBucket,
  prob: r.recommendedProb,
  ev: r.expectedValue,
  status: r.phase8Status,
  problems: r.phase8Problems.join(",")
})));
console.log("Wrote outputs/phase8-candidate-audit.json");
