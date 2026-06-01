const fs = require("fs");
const path = require("path");

const IN = "outputs/manual/manual-model-compare.json";
const OUT_JSON = "outputs/manual/manual-edge-mining-report.json";
const OUT_TXT = "outputs/manual/manual-edge-mining-report.txt";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function pct(n, d) {
  if (!d) return null;
  return Number(((n / d) * 100).toFixed(2));
}

function gradeBucket(x) {
  const graded = Number(x.graded || 0);
  const hitRate = Number(x.hitRate || 0);

  /*
    Manual buckets should not be promoted or downgraded from tiny samples.
    These are research-only labels, not execution rules.
  */
  if (graded < 30) {
    if (graded >= 5 && hitRate >= 65) return "WATCH_MORE_SAMPLE";
    return "LOW_SAMPLE";
  }

  if (hitRate >= 60) return "AUTOMATION_CANDIDATE";
  if (hitRate <= 47) return "AVOID_OR_DOWNGRADE";
  return "MONITOR_NEUTRAL";
}

function bucketKey(r) {
  return [
    r.modelClass || "UNKNOWN_MODEL_CLASS",
    r.market || "UNKNOWN_MARKET",
    r.side || "UNKNOWN_SIDE",
    r.tier || "UNKNOWN_TIER"
  ].join(" | ");
}

const raw = readJson(IN, null);
if (!raw) throw new Error(`Missing ${IN}. Run npm run manual first.`);

function extractCompareRows(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.manualRows)) return raw.manualRows;
  if (Array.isArray(raw.comparisons)) return raw.comparisons;
  if (Array.isArray(raw.results)) return raw.results;

  // Fallback: only keep leaf-like rows with actual comparison fields.
  return flatten(raw).filter(r =>
    (r.player || r.playerName) &&
    r.market &&
    r.side &&
    r.line !== undefined &&
    r.result
  );
}

const rows = extractCompareRows(raw);
const gradedRows = rows.filter(r => {
  const result = String(r.result || "").toUpperCase();
  return ["HIT", "MISS", "PUSH"].includes(result);
});

const buckets = new Map();

for (const r of gradedRows) {
  const key = bucketKey(r);
  if (!buckets.has(key)) {
    buckets.set(key, {
      bucket: key,
      modelClass: r.modelClass || "UNKNOWN_MODEL_CLASS",
      market: r.market || "UNKNOWN_MARKET",
      side: r.side || "UNKNOWN_SIDE",
      tier: r.tier || "UNKNOWN_TIER",
      graded: 0,
      hits: 0,
      misses: 0,
      pushes: 0,
      examples: []
    });
  }

  const b = buckets.get(key);
  const result = String(r.result || "").toUpperCase();

  b.graded += 1;
  if (result === "HIT") b.hits += 1;
  if (result === "MISS") b.misses += 1;
  if (result === "PUSH") b.pushes += 1;

  if (b.examples.length < 8) {
    b.examples.push({
      date: r.date || null,
      player: r.player || r.playerName || null,
      market: r.market || null,
      side: r.side || null,
      line: r.line ?? null,
      tier: r.tier || null,
      result,
      actual: r.actual ?? null,
      modelClass: r.modelClass || null
    });
  }
}

const summary = [...buckets.values()]
  .map(b => {
    const hitRate = pct(b.hits, b.graded);
    return {
      ...b,
      hitRate,
      roiProxy: Number(((b.hits - b.misses) / Math.max(1, b.graded)).toFixed(3)),
      recommendation: gradeBucket({ ...b, hitRate })
    };
  })
  .sort((a, b) =>
    b.graded - a.graded ||
    (b.hitRate ?? 0) - (a.hitRate ?? 0) ||
    b.roiProxy - a.roiProxy
  );

const automationCandidates = summary.filter(x => x.recommendation === "AUTOMATION_CANDIDATE");
const watchMoreSample = summary.filter(x => x.recommendation === "WATCH_MORE_SAMPLE");
const avoidOrDowngrade = summary.filter(x => x.recommendation === "AVOID_OR_DOWNGRADE");

const report = {
  generatedAt: new Date().toISOString(),
  source: IN,
  rows: rows.length,
  gradedRows: gradedRows.length,
  counts: {
    buckets: summary.length,
    automationCandidates: automationCandidates.length,
    watchMoreSample: watchMoreSample.length,
    avoidOrDowngrade: avoidOrDowngrade.length
  },
  automationCandidates,
  watchMoreSample,
  avoidOrDowngrade,
  allBuckets: summary
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + "\n");

const lines = [];
lines.push("MANUAL EDGE MINING REPORT");
lines.push("=========================");
lines.push(`rows: ${rows.length}`);
lines.push(`graded rows: ${gradedRows.length}`);
lines.push("");
lines.push("AUTOMATION CANDIDATES");
lines.push("---------------------");
if (!automationCandidates.length) {
  lines.push("none");
} else {
  for (const x of automationCandidates) {
    lines.push(`- ${x.bucket}: ${x.hits}-${x.misses}-${x.pushes} | graded=${x.graded} | hitRate=${x.hitRate}% | roiProxy=${x.roiProxy}`);
  }
}
lines.push("");
lines.push("WATCH MORE SAMPLE");
lines.push("-----------------");
if (!watchMoreSample.length) {
  lines.push("none");
} else {
  for (const x of watchMoreSample) {
    lines.push(`- ${x.bucket}: ${x.hits}-${x.misses}-${x.pushes} | graded=${x.graded} | hitRate=${x.hitRate}% | roiProxy=${x.roiProxy}`);
  }
}
lines.push("");
lines.push("AVOID / DOWNGRADE");
lines.push("-----------------");
if (!avoidOrDowngrade.length) {
  lines.push("none");
} else {
  for (const x of avoidOrDowngrade) {
    lines.push(`- ${x.bucket}: ${x.hits}-${x.misses}-${x.pushes} | graded=${x.graded} | hitRate=${x.hitRate}% | roiProxy=${x.roiProxy}`);
  }
}
lines.push("");
lines.push("ALL BUCKETS");
lines.push("-----------");
for (const x of summary) {
  lines.push(`- ${x.bucket}: ${x.hits}-${x.misses}-${x.pushes} | graded=${x.graded} | hitRate=${x.hitRate}% | ${x.recommendation}`);
}

fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log("");
console.log("saved:", OUT_JSON);
console.log("saved:", OUT_TXT);
