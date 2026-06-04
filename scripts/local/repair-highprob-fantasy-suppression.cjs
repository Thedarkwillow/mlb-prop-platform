const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const AUDIT_FILE = `outputs/high-probability-promotion-audit-${DATE}.json`;
const AUDIT_TXT = `outputs/high-probability-promotion-audit-${DATE}.txt`;
const LATEST_JSON = "outputs/high-probability-promotion-audit-latest.json";
const LATEST_TXT = "outputs/high-probability-promotion-audit-latest.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "n/a";
  const n = Number(v);
  return `${(n <= 1 ? n * 100 : n).toFixed(1)}%`;
}

function findBucketContainer(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.buckets)) return { type: "array", value: data.buckets };
  if (data.buckets && typeof data.buckets === "object") return { type: "object", value: data.buckets };
  if (Array.isArray(data.results)) return { type: "array", value: data.results };
  if (data.results && typeof data.results === "object") return { type: "object", value: data.results };
  return null;
}

function upsertBucket(data, fixed) {
  const c = findBucketContainer(data);
  if (!c) {
    data.buckets = [fixed];
    return;
  }

  if (c.type === "array") {
    const idx = c.value.findIndex(x =>
      x?.key === "GOBLIN_FANTASY_HIGH_PROB" ||
      x?.bucket === "GOBLIN_FANTASY_HIGH_PROB"
    );
    if (idx >= 0) c.value[idx] = { ...c.value[idx], ...fixed };
    else c.value.push(fixed);
    return;
  }

  c.value.GOBLIN_FANTASY_HIGH_PROB = {
    ...(c.value.GOBLIN_FANTASY_HIGH_PROB || {}),
    ...fixed,
  };
}

function rebuildText(data) {
  const c = findBucketContainer(data);
  const rows = c
    ? (c.type === "array" ? c.value : Object.entries(c.value).map(([key, v]) => ({ key, ...v })))
    : [];

  const lines = [];
  lines.push("HIGH-PROBABILITY PROMOTION AUDIT");
  lines.push("================================");
  lines.push(`date=${data.date || DATE}`);
  lines.push("policy=manual approval required; no automatic official promotion");
  lines.push("");

  for (const row of rows) {
    const key = row.key || row.bucket || "UNKNOWN";
    lines.push(key);
    lines.push("-".repeat(key.length));
    lines.push(`label=${row.label || key}`);
    lines.push(`action=${row.action || "UNKNOWN"}`);
    lines.push(`reason=${row.reason || "n/a"}`);
    lines.push(`daysTracked=${row.daysTracked ?? 0}`);
    lines.push(`daysWithPositiveSignal=${row.daysWithPositiveSignal ?? 0}`);
    lines.push(`total=${row.total ?? 0} graded=${row.graded ?? 0} hits=${row.hits ?? 0} misses=${row.misses ?? 0} pushes=${row.pushes ?? 0} unmatched=${row.unmatched ?? 0} hitRate=${pct(row.hitRate)}`);
    if (row.thresholds) {
      lines.push(
        `thresholds=minGraded:${row.thresholds.minGraded ?? "?"} watch:${pct(row.thresholds.watchHitRate)} promote:${pct(row.thresholds.promoteHitRate)} requiredDays:${row.thresholds.requiredDays ?? "?"}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

const audit = readJson(AUDIT_FILE);
if (!audit) {
  console.error(`missing audit file: ${AUDIT_FILE}`);
  process.exit(1);
}

const fixed = {
  key: "GOBLIN_FANTASY_HIGH_PROB",
  bucket: "GOBLIN_FANTASY_HIGH_PROB",
  label: "Goblin fantasy high probability",
  action: "SUPPRESS",
  reason: "suppressed_fantasy_goblin_bucket_unstable_or_missing_clean_sample",
  total: 0,
  graded: 0,
  hits: 0,
  misses: 0,
  pushes: 0,
  unmatched: 0,
  hitRate: null,
  daysTracked: 1,
  daysWithPositiveSignal: 0,
  thresholds: {
    minGraded: 50,
    watchHitRate: 0.58,
    promoteHitRate: 0.62,
    requiredDays: 3
  },
  note: "Do not promote fantasy goblins. Prior clean June 3 sample was 1 hit, 3 misses, 25.0%; current bucket may appear as NO_DATA because fantasy research is not always emitted in the same high-probability board shape."
};

upsertBucket(audit, fixed);

writeJson(AUDIT_FILE, audit);
writeJson(LATEST_JSON, audit);

const text = rebuildText(audit);
fs.writeFileSync(AUDIT_TXT, text + "\n");
fs.writeFileSync(LATEST_TXT, text + "\n");

console.log("HIGH-PROB FANTASY SUPPRESSION REPAIR");
console.log("====================================");
console.log(`date=${DATE}`);
console.log("GOBLIN_FANTASY_HIGH_PROB: SUPPRESS");
console.log("reason=suppressed_fantasy_goblin_bucket_unstable_or_missing_clean_sample");
console.log(`saved: ${AUDIT_FILE}`);
