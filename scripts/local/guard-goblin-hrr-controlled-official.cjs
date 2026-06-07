const fs = require("fs");

function getDate() {
  const arg = process.argv.find(x => /^--date=/.test(x));
  if (arg) return arg.replace(/^--date=/, "");
  const bare = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (bare) return bare;
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();
const REPAIRED = `outputs/history/${DATE}-goblin-hrr-controlled-repaired.json`;
const OUT = `outputs/history/${DATE}-goblin-hrr-controlled-official-guard.json`;
const TXT = `outputs/history/${DATE}-goblin-hrr-controlled-official-guard.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync("outputs/history", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const repaired = readJson(REPAIRED, null);

if (!repaired) {
  const payload = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    status: "BLOCK_GOBLIN_HRR_CONTROLLED_OFFICIAL",
    reason: "missing_repaired_goblin_hrr_controlled_grade",
    expectedSource: REPAIRED
  };
  writeJson(OUT, payload);
  fs.writeFileSync(TXT, JSON.stringify(payload, null, 2) + "\n");
  console.log(payload);
  process.exit(0);
}

const hrr = repaired.summary?.byMarket?.hrr || {};
const er = repaired.summary?.byMarket?.earned_runs_allowed || {};
const legs = repaired.summary?.legs || {};

const reasons = [];

if (!hrr.graded || hrr.graded < 25) {
  reasons.push("insufficient_hrr_anchor_sample");
}
if (hrr.hitRate === null || hrr.hitRate < 0.58) {
  reasons.push("hrr_anchor_hit_rate_below_promotion_threshold");
}
if ((er.total || 0) > 0 && (er.graded || 0) === 0) {
  reasons.push("pitcher_filler_earned_runs_ungraded");
}
if ((legs.unmatched || 0) > 0) {
  reasons.push("slips_have_unmatched_filler_legs");
}

const status = reasons.length
  ? "BLOCK_GOBLIN_HRR_CONTROLLED_OFFICIAL"
  : "ALLOW_GOBLIN_HRR_CONTROLLED_RESEARCH_PROMOTION_REVIEW";

const payload = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  source: REPAIRED,
  status,
  reasons,
  thresholds: {
    minHrrAnchorSample: 25,
    minHrrAnchorHitRateForPromotion: 0.58,
    requirePitcherFillerGraded: true
  },
  summary: {
    hrr,
    earned_runs_allowed: er,
    legs
  },
  note: "This guard does not delete research files. It prevents goblin HRR controlled from being treated as official while anchors are poor or pitcher filler legs are ungraded."
};

writeJson(OUT, payload);

const lines = [];
lines.push("GOBLIN HRR CONTROLLED OFFICIAL GUARD");
lines.push("====================================");
lines.push(JSON.stringify(payload, null, 2));
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(payload);

if (status.startsWith("BLOCK")) process.exit(0);
