const fs = require("fs");
const path = require("path");

const HIST = "outputs/history";
const OUT = "outputs/goblin-slip-construction-roi.json";
const TXT = "outputs/goblin-slip-construction-roi.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function normResult(v) {
  const r = String(v || "").toLowerCase();
  if (r === "hit" || r === "win" || r === "won") return "hit";
  if (r === "miss" || r === "loss" || r === "lost") return "miss";
  if (r === "partialunmatched" || r === "partial_unmatched") return "partialUnmatched";
  if (r === "allunmatched" || r === "all_unmatched") return "allUnmatched";
  if (r === "ungraded") return "ungraded";
  return r || "unknown";
}

function emptyBucket() {
  return {
    slips: 0,
    hit: 0,
    miss: 0,
    partialUnmatched: 0,
    allUnmatched: 0,
    ungraded: 0,
    unknown: 0,
    hitRate: null,
    roiProxy: null
  };
}

function add(bucket, result) {
  bucket.slips++;
  bucket[result] = (bucket[result] || 0) + 1;
}

function finalize(bucket) {
  const graded = bucket.hit + bucket.miss;
  bucket.graded = graded;
  bucket.hitRate = graded ? bucket.hit / graded : null;
  bucket.roiProxy = graded ? (bucket.hit - bucket.miss) / graded : null;
  return bucket;
}

function files() {
  try {
    return fs.readdirSync(HIST)
      .filter(f => /^\d{4}-\d{2}-\d{2}-goblin-context-playability-graded\.json$/.test(f))
      .sort();
  } catch {
    return [];
  }
}

const byShape = {};
const byLane = {};
const byPlayability = {};
const byDate = {};
const samples = [];

for (const f of files()) {
  const date = f.slice(0, 10);
  const full = path.join(HIST, f);
  const data = readJson(full, {});
  const rows = arr(data.rows || data.slips || data.details || []);
  const summary = data.summary || data;

  if (!byDate[date]) byDate[date] = {
    date,
    playabilityRows: summary.playabilityRows || rows.length || 0,
    matchedGrades: summary.matchedGrades || 0,
    byLane: summary.byLane || {},
    byPlayability: summary.byPlayability || {},
    byShape: summary.byShape || {}
  };

  // Prefer summary.byShape when available because it already aggregates cleanly.
  for (const [shape, bucket] of Object.entries(summary.byShape || {})) {
    if (!byShape[shape]) byShape[shape] = emptyBucket();
    byShape[shape].slips += Number(bucket.slips || 0);
    byShape[shape].hit += Number(bucket.hit || 0);
    byShape[shape].miss += Number(bucket.miss || 0);
    byShape[shape].partialUnmatched += Number(bucket.partialUnmatched || 0);
    byShape[shape].allUnmatched += Number(bucket.allUnmatched || 0);
    byShape[shape].ungraded += Number(bucket.ungraded || 0);
  }

  for (const [lane, bucket] of Object.entries(summary.byLane || {})) {
    if (!byLane[lane]) byLane[lane] = emptyBucket();
    byLane[lane].slips += Number(bucket.slips || 0);
    byLane[lane].hit += Number(bucket.hit || 0);
    byLane[lane].miss += Number(bucket.miss || 0);
    byLane[lane].partialUnmatched += Number(bucket.partialUnmatched || 0);
    byLane[lane].allUnmatched += Number(bucket.allUnmatched || 0);
    byLane[lane].ungraded += Number(bucket.ungraded || 0);
  }

  for (const [p, bucket] of Object.entries(summary.byPlayability || {})) {
    if (!byPlayability[p]) byPlayability[p] = emptyBucket();
    byPlayability[p].slips += Number(bucket.slips || 0);
    byPlayability[p].hit += Number(bucket.hit || 0);
    byPlayability[p].miss += Number(bucket.miss || 0);
    byPlayability[p].partialUnmatched += Number(bucket.partialUnmatched || 0);
    byPlayability[p].allUnmatched += Number(bucket.allUnmatched || 0);
    byPlayability[p].ungraded += Number(bucket.ungraded || 0);
  }

  for (const row of rows.slice(0, 10)) {
    samples.push({
      date,
      id: row.id || row.slipId,
      lane: row.lane,
      size: row.size,
      entryType: row.entryType,
      playability: row.playability,
      result: row.result
    });
  }
}

for (const obj of [byShape, byLane, byPlayability]) {
  for (const bucket of Object.values(obj)) finalize(bucket);
}

const rankedShapes = Object.entries(byShape)
  .map(([shape, stats]) => ({ shape, ...stats }))
  .sort((a, b) => {
    const ar = a.roiProxy ?? -999;
    const br = b.roiProxy ?? -999;
    if (br !== ar) return br - ar;
    return b.graded - a.graded;
  });

const report = {
  generatedAt: new Date().toISOString(),
  historyFiles: files().length,
  byShape,
  byLane,
  byPlayability,
  rankedShapes,
  byDate,
  samples,
  notes: [
    "Use this to judge profitability by exact goblin slip construction.",
    "Hit rate alone is not enough; compare by lane + size + entry type.",
    "2-man POWER and 3-man FLEX should stay preferred until another shape proves better over sample."
  ]
};

const txt = [];
txt.push("GOBLIN SLIP CONSTRUCTION ROI REPORT");
txt.push("===================================");
txt.push(JSON.stringify({
  generatedAt: report.generatedAt,
  historyFiles: report.historyFiles,
  topShapes: rankedShapes.slice(0, 10)
}, null, 2));
txt.push("");
txt.push("BY SHAPE");
txt.push("--------");
for (const r of rankedShapes) {
  txt.push(`${r.shape} | slips=${r.slips} | graded=${r.graded} | hit=${r.hit} | miss=${r.miss} | partial=${r.partialUnmatched} | hitRate=${r.hitRate === null ? "?" : (r.hitRate * 100).toFixed(1) + "%"} | roiProxy=${r.roiProxy === null ? "?" : r.roiProxy.toFixed(3)}`);
}
txt.push("");
txt.push("BY LANE");
txt.push("-------");
for (const [lane, r] of Object.entries(byLane)) {
  txt.push(`${lane} | slips=${r.slips} | graded=${r.graded} | hit=${r.hit} | miss=${r.miss} | partial=${r.partialUnmatched} | hitRate=${r.hitRate === null ? "?" : (r.hitRate * 100).toFixed(1) + "%"} | roiProxy=${r.roiProxy === null ? "?" : r.roiProxy.toFixed(3)}`);
}
txt.push("");
txt.push("BY PLAYABILITY");
txt.push("--------------");
for (const [p, r] of Object.entries(byPlayability)) {
  txt.push(`${p} | slips=${r.slips} | graded=${r.graded} | hit=${r.hit} | miss=${r.miss} | partial=${r.partialUnmatched} | hitRate=${r.hitRate === null ? "?" : (r.hitRate * 100).toFixed(1) + "%"} | roiProxy=${r.roiProxy === null ? "?" : r.roiProxy.toFixed(3)}`);
}

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
fs.writeFileSync(TXT, txt.join("\n"));

console.log({
  generatedAt: report.generatedAt,
  historyFiles: report.historyFiles,
  shapes: rankedShapes.length,
  topShapes: rankedShapes.slice(0, 5)
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
