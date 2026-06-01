const fs = require("fs");
const path = require("path");

const date =
  process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.rows)) return v.rows;
  if (Array.isArray(v.candidates)) return v.candidates;
  if (Array.isArray(v.leans)) return v.leans;
  if (Array.isArray(v.trackOnly)) return v.trackOnly;
  return [];
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function resultOf(row) {
  return String(row.result || row.gradeResult || row.outcome || "").toUpperCase();
}

function keyOf(row) {
  return [
    norm(row.controlledUnlockRule || row.unlock?.rule || row.rule || "unknown_rule"),
    norm(row.market),
    String(row.side || "").toUpperCase(),
    Number(row.line)
  ].join("|");
}

function playerKey(row) {
  return [
    norm(row.player || row.playerName),
    norm(row.market),
    String(row.side || "").toUpperCase(),
    Number(row.line)
  ].join("|");
}

const latestLean = readJson("outputs/lean-final-slips.json", {});
const currentControlled = asArray(latestLean.leans).filter(r =>
  String(r.leanStatus || "").toUpperCase().includes("CONTROLLED_UNLOCK")
);

const gradedSources = [
  "outputs/decision-layer-grades-latest.json",
  `outputs/history/${date}-decision-layer-grades.json`,
  `outputs/lean-final-slips-graded-${date}.json`,
  `outputs/playable-final-slips-graded-${date}.json`
];

let gradedRows = [];
for (const file of gradedSources) {
  gradedRows.push(...asArray(readJson(file, [])));
}

const byPlayer = new Map();
for (const row of gradedRows) {
  byPlayer.set(playerKey(row), row);
}

const evaluations = currentControlled.map(row => {
  const graded = byPlayer.get(playerKey(row)) || null;
  const result = graded ? resultOf(graded) : null;
  return {
    date,
    player: row.player,
    team: row.team,
    game: row.game,
    market: row.market,
    side: row.side,
    line: row.line,
    tier: row.oddsTier || row.tier || null,
    prob: row.prob,
    edge: row.edge,
    controlledUnlockRule: row.controlledUnlockRule || row.unlock?.rule || null,
    leanStatus: row.leanStatus,
    result,
    graded: !!graded,
    promotionStatus: "TRACK_ONLY",
    reason: "controlled_unlock_requires_3_to_5_slates_before_actionable_promotion"
  };
});

const grouped = {};
for (const row of evaluations) {
  const k = keyOf(row);
  grouped[k] ||= {
    key: k,
    rule: row.controlledUnlockRule || "unknown_rule",
    market: row.market,
    side: row.side,
    line: row.line,
    tracked: 0,
    graded: 0,
    hits: 0,
    misses: 0,
    pushes: 0
  };
  grouped[k].tracked += 1;
  if (row.graded) grouped[k].graded += 1;
  if (row.result === "HIT") grouped[k].hits += 1;
  if (row.result === "MISS") grouped[k].misses += 1;
  if (row.result === "PUSH") grouped[k].pushes += 1;
}

const buckets = Object.values(grouped).map(b => {
  const decisions = b.hits + b.misses;
  const hitRate = decisions ? b.hits / decisions : null;
  let promotionStatus = "TRACK_ONLY";
  let reason = "needs_3_to_5_graded_controlled_unlock_results";

  if (decisions >= 5 && hitRate >= 0.65) {
    promotionStatus = "ACTIONABLE_LEAN_REVIEW_READY";
    reason = "sample_ready_for_manual_review_not_auto_official";
  } else if (decisions >= 3 && hitRate >= 0.67) {
    promotionStatus = "WATCHLIST_STRONG";
    reason = "early_positive_but_needs_more_sample";
  } else if (decisions >= 3 && hitRate < 0.50) {
    promotionStatus = "SUPPRESS_REVIEW";
    reason = "early_negative_controlled_unlock_results";
  }

  return {
    ...b,
    decisions,
    hitRate,
    hitRatePct: hitRate === null ? null : Number((hitRate * 100).toFixed(1)),
    promotionStatus,
    reason
  };
});

const report = {
  date,
  generatedAt: new Date().toISOString(),
  policy: "Controlled unlocks can enter lean/watch display, but cannot become official playable automatically.",
  currentControlledUnlocks: evaluations.length,
  evaluations,
  buckets
};

fs.mkdirSync("outputs/unlocks", { recursive: true });
fs.writeFileSync(`outputs/unlocks/controlled-unlock-readiness-${date}.json`, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync("outputs/unlocks/controlled-unlock-readiness-latest.json", JSON.stringify(report, null, 2) + "\n");

console.log("CONTROLLED UNLOCK READINESS");
console.log("---------------------------");
console.log("date:", date);
console.log("current controlled unlocks:", evaluations.length);
console.table(buckets.map(b => ({
  rule: b.rule,
  market: b.market,
  side: b.side,
  line: b.line,
  graded: b.graded,
  hits: b.hits,
  misses: b.misses,
  hitRatePct: b.hitRatePct,
  promotionStatus: b.promotionStatus,
  reason: b.reason
})));
console.log("saved:", `outputs/unlocks/controlled-unlock-readiness-${date}.json`);
console.log("saved:", "outputs/unlocks/controlled-unlock-readiness-latest.json");
