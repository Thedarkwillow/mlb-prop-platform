const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const AUDIT_FILE = `outputs/high-probability-promotion-audit-${DATE}.json`;
const OUT_JSON = `outputs/controlled-highprob-unlocks-${DATE}.json`;
const OUT_TXT = `outputs/controlled-highprob-unlocks-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/controlled-highprob-unlocks-latest.json";
const OUT_LATEST_TXT = "outputs/controlled-highprob-unlocks-latest.txt";

const ALLOWED_BUCKETS = {
  STANDARD_STRIKEOUTS_LESS: {
    label: "Standard strikeouts LESS",
    lane: "CONTROLLED_WATCH",
    maxStake: "track only / optional lean review later",
    officialAllowed: false,
    reason: "standard K LESS has strong early signal but needs candidate-side validation"
  },
  SHADOW_HITS_MORE_HIGH_PROB: {
    label: "Shadow hits MORE high probability",
    lane: "CONTROLLED_WATCH",
    maxStake: "track only / optional lean review later",
    officialAllowed: false,
    reason: "high-prob hits MORE shadow bucket is promising but needs more sample"
  }
};

const HARD_SUPPRESS = {
  GOBLIN_FANTASY_HIGH_PROB: "suppressed: poor June 3 signal / unstable fantasy goblin bucket",
  SHADOW_BASES_MORE_HIGH_PROB: "track only: bases MORE is more volatile than hits MORE",
  SHADOW_HITS_BASES_HIGH_PROB: "track only: combined hits/bases bucket must remain split",
  HRR_MORE_HIGH_PROB: "track only: strong June 3 result but still needs 30+ graded and repeat day",
  GOBLIN_STRIKEOUTS_MORE: "watch only: rolling hit rate below promote line",
  GOBLIN_WALKS_ALLOWED_MORE: "track only: below 30 graded minimum"
};

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "n/a";
  const n = Number(v);
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
}

function normalizeBucketRows(audit) {
  if (!audit) return [];
  if (Array.isArray(audit.buckets)) return audit.buckets;
  if (Array.isArray(audit.results)) return audit.results;
  if (audit.buckets && typeof audit.buckets === "object") {
    return Object.entries(audit.buckets).map(([key, value]) => ({ key, ...value }));
  }
  if (audit.results && typeof audit.results === "object") {
    return Object.entries(audit.results).map(([key, value]) => ({ key, ...value }));
  }
  return [];
}

function stat(row, key) {
  return Number(
    row?.[key] ??
    row?.summary?.[key] ??
    row?.totals?.[key] ??
    0
  );
}

const audit = readJson(AUDIT_FILE);
if (!audit) {
  console.error(`Missing audit file: ${AUDIT_FILE}`);
  process.exit(1);
}

const rows = normalizeBucketRows(audit);

const unlocks = [];
const suppressed = [];
const tracked = [];

for (const row of rows) {
  const key = row.key || row.bucket || row.name;
  const action = String(row.action || "").toUpperCase();
  const graded = stat(row, "graded");
  const hits = stat(row, "hits");
  const misses = stat(row, "misses");
  const hitRateRaw =
    row.hitRate ??
    row.summary?.hitRate ??
    row.totals?.hitRate ??
    (graded > 0 ? hits / graded : null);

  const base = {
    key,
    label: row.label || ALLOWED_BUCKETS[key]?.label || key,
    auditAction: action || "UNKNOWN",
    auditReason: row.reason || "",
    graded,
    hits,
    misses,
    hitRate: hitRateRaw,
    hitRatePct: pct(hitRateRaw),
    daysTracked: stat(row, "daysTracked"),
    daysWithPositiveSignal: stat(row, "daysWithPositiveSignal")
  };

  if (ALLOWED_BUCKETS[key]) {
    const allowed = ALLOWED_BUCKETS[key];

    unlocks.push({
      ...base,
      lane: allowed.lane,
      officialAllowed: false,
      slipBuilderAllowed: false,
      maxStake: allowed.maxStake,
      controlledReason: allowed.reason,
      requiredBeforeLean: [
        "repeat positive signal on another slate",
        "minimum 30 graded rows for the exact bucket",
        "manual final review",
        "no official promotion until bucket-specific ROI holds"
      ]
    });
  } else if (HARD_SUPPRESS[key]) {
    suppressed.push({
      ...base,
      lane: "SUPPRESSED_OR_TRACK_ONLY",
      officialAllowed: false,
      slipBuilderAllowed: false,
      controlledReason: HARD_SUPPRESS[key]
    });
  } else {
    tracked.push({
      ...base,
      lane: "TRACK_ONLY",
      officialAllowed: false,
      slipBuilderAllowed: false,
      controlledReason: "not in controlled unlock allowlist"
    });
  }
}

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  source: AUDIT_FILE,
  policy: "No automatic official promotion. These are controlled watch/lean review buckets only.",
  allowedUnlockKeys: Object.keys(ALLOWED_BUCKETS),
  unlocks,
  suppressed,
  tracked,
  notes: [
    "Goblin fantasy high-prob remains suppressed/research only.",
    "Shadow hits MORE is separated from bases MORE.",
    "Standard strikeouts LESS is allowed only as controlled watch, not official.",
    "HRR MORE high-prob was strong on June 3 but still needs more sample before unlock."
  ]
};

const lines = [];
lines.push("CONTROLLED HIGH-PROBABILITY UNLOCKS");
lines.push("===================================");
lines.push(`date=${DATE}`);
lines.push("policy=no official promotion; controlled watch/lean review only");
lines.push("");

lines.push("CONTROLLED WATCH UNLOCKS");
lines.push("------------------------");
if (!unlocks.length) {
  lines.push("none");
} else {
  for (const u of unlocks) {
    lines.push(`${u.key}`);
    lines.push(`  label=${u.label}`);
    lines.push(`  lane=${u.lane}`);
    lines.push(`  officialAllowed=${u.officialAllowed}`);
    lines.push(`  slipBuilderAllowed=${u.slipBuilderAllowed}`);
    lines.push(`  graded=${u.graded} hits=${u.hits} misses=${u.misses} hitRate=${u.hitRatePct}`);
    lines.push(`  auditAction=${u.auditAction}`);
    lines.push(`  reason=${u.controlledReason}`);
  }
}

lines.push("");
lines.push("SUPPRESSED / TRACK ONLY");
lines.push("-----------------------");
for (const s of suppressed) {
  lines.push(`${s.key}: ${s.controlledReason} | graded=${s.graded} hitRate=${s.hitRatePct}`);
}

writeJson(OUT_JSON, report);
writeJson(OUT_LATEST_JSON, report);
writeText(OUT_TXT, lines.join("\n"));
writeText(OUT_LATEST_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
