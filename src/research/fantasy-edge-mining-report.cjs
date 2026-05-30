const fs = require("fs");

const OUT_JSON = "outputs/manual/fantasy-edge-mining-report.json";
const OUT_TXT = "outputs/manual/fantasy-edge-mining-report.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 10000) / 100;
}

function resultOf(r) {
  return String(r.result || r.outcome || "").toUpperCase();
}

function addBucket(map, key, result) {
  if (!map[key]) map[key] = { total: 0, graded: 0, hits: 0, misses: 0, pushes: 0, pending: 0 };
  map[key].total++;
  if (["HIT", "MISS", "PUSH"].includes(result)) map[key].graded++;
  else map[key].pending++;
  if (result === "HIT") map[key].hits++;
  if (result === "MISS") map[key].misses++;
  if (result === "PUSH") map[key].pushes++;
}

function summarizeMap(map) {
  return Object.entries(map).map(([bucket, v]) => ({
    bucket,
    ...v,
    hitRate: pct(v.hits, v.graded),
    roiProxy: v.graded ? Math.round(((v.hits - v.misses) / v.graded) * 10000) / 10000 : null
  })).sort((a, b) => b.graded - a.graded || (b.hitRate || 0) - (a.hitRate || 0));
}

const manual = readJson("data/manual/manual-research-ledger.json", []);
const validation = readJson("outputs/fantasy-validation-report.json", {});
const directLess = readJson("outputs/direct-fantasy-less-tracker-latest.json", {});
const component = readJson("outputs/fantasy-component-model.json", []);
const advanced = readJson("outputs/hitter-fantasy-advanced-model.json", []);

const manualFantasy = Array.isArray(manual)
  ? manual.filter(r => String(r.market || "").includes("fantasy"))
  : [];

const manualBuckets = {};
for (const r of manualFantasy) {
  const key = [
    r.market || "unknown_market",
    r.side || "unknown_side",
    r.tier || "unknown_tier",
    r.source || "unknown_source"
  ].join(" | ");
  addBucket(manualBuckets, key, resultOf(r));
}

const componentRows = Array.isArray(component) ? component : (component.rows || []);
const componentReady = componentRows.filter(r => {
  const status = String(r.status || r.componentStatus || r.modelStatus || "").toUpperCase();
  return status === "COMPONENT_READY" || status.includes("READY");
}).length;

const advancedRows = Array.isArray(advanced) ? advanced : (advanced.rows || []);
const moreCandidates = advancedRows.filter(r => r.more || r.moreCandidate || r.morePlayable).length;
const lessCandidates = advancedRows.filter(r => r.less || r.lessCandidate || r.lessPlayable).length;

const bucketSummary = Array.isArray(validation.bucketSummary) ? validation.bucketSummary : [];

const directSummary = {
  rows: directLess.summary?.rows ?? directLess.rows ?? null,
  graded: directLess.summary?.graded ?? directLess.graded ?? null,
  hits: directLess.summary?.hits ?? directLess.hits ?? null,
  misses: directLess.summary?.misses ?? directLess.misses ?? null,
  pending: directLess.summary?.pending ?? directLess.pending ?? null,
  hitRate: directLess.summary?.hitRate ?? directLess.hitRate ?? null
};

const manualSummary = summarizeMap(manualBuckets);

const unlockCandidates = [];
const avoidBuckets = [];

for (const b of manualSummary) {
  if (b.bucket.includes("manual_research") && b.graded >= 30 && b.hitRate >= 58) {
    unlockCandidates.push({ source: "manual", type: "FANTASY_MORE_MANUAL_WATCH", ...b });
  } else if (b.bucket.includes("past_prizepicks_slip") && b.graded >= 20 && b.hitRate < 52) {
    avoidBuckets.push({ source: "manual", type: "PAST_SLIP_WEAK", ...b });
  }
}

for (const b of bucketSummary) {
  if (String(b.bucket || "").includes("less") && b.graded >= 30 && b.hitRatePct >= 60) {
    unlockCandidates.push({
      source: "validation",
      type: "SYNTHETIC_LESS_MONITOR",
      bucket: b.bucket,
      graded: b.graded,
      hits: b.hits,
      misses: b.misses,
      hitRate: b.hitRatePct,
      action: b.action
    });
  }
  if (String(b.bucket || "").includes("more") && b.graded >= 30 && b.hitRatePct < 52) {
    avoidBuckets.push({
      source: "validation",
      type: "FANTASY_MORE_WEAK",
      bucket: b.bucket,
      graded: b.graded,
      hits: b.hits,
      misses: b.misses,
      hitRate: b.hitRatePct,
      action: b.action
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  policy: {
    officialFantasyEnabled: false,
    leanFantasyEnabled: false,
    mode: "RESEARCH_ONLY",
    note: "Fantasy stays visible for mining, but does not enter official/lean execution until direct validation clears."
  },
  manual: {
    rows: manualFantasy.length,
    buckets: manualSummary
  },
  directFantasyLess: directSummary,
  validation: {
    status: validation.status || null,
    policy: validation.policy || null,
    sideTotals: validation.sideTotals || null,
    bucketSummary
  },
  component: {
    rows: componentRows.length,
    componentReady,
    readinessRate: pct(componentReady, componentRows.length)
  },
  advanced: {
    rows: advancedRows.length,
    moreCandidates,
    lessCandidates
  },
  unlockCandidates,
  avoidBuckets
};

const lines = [];
lines.push("FANTASY EDGE MINING REPORT");
lines.push("==========================");
lines.push(`mode: ${report.policy.mode}`);
lines.push(`manual fantasy rows: ${report.manual.rows}`);
lines.push(`component ready: ${componentReady}/${componentRows.length} (${report.component.readinessRate ?? "n/a"}%)`);
lines.push("");
lines.push("MANUAL FANTASY BUCKETS");
lines.push("----------------------");
for (const b of manualSummary) {
  lines.push(`- ${b.bucket}: ${b.hits}-${b.misses}-${b.pushes} | graded=${b.graded} | hitRate=${b.hitRate ?? "n/a"}% | roiProxy=${b.roiProxy ?? "n/a"}`);
}
lines.push("");
lines.push("DIRECT FANTASY LESS");
lines.push("-------------------");
lines.push(`rows=${directSummary.rows ?? "n/a"} graded=${directSummary.graded ?? "n/a"} hits=${directSummary.hits ?? "n/a"} misses=${directSummary.misses ?? "n/a"} pending=${directSummary.pending ?? "n/a"} hitRate=${directSummary.hitRate ?? "n/a"}`);
lines.push("");
lines.push("UNLOCK / WATCH CANDIDATES");
lines.push("-------------------------");
if (!unlockCandidates.length) lines.push("none");
for (const b of unlockCandidates) {
  lines.push(`- ${b.type} | ${b.bucket}: graded=${b.graded} hitRate=${b.hitRate}%`);
}
lines.push("");
lines.push("AVOID / DOWNGRADE");
lines.push("-----------------");
if (!avoidBuckets.length) lines.push("none");
for (const b of avoidBuckets) {
  lines.push(`- ${b.type} | ${b.bucket}: graded=${b.graded} hitRate=${b.hitRate}%`);
}
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push("Fantasy remains RESEARCH_ONLY. Direct LESS needs graded proof. Manual MORE needs sample >=30 and 58-60%+ hit rate before watchlist consideration.");

fs.mkdirSync("outputs/manual", { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
