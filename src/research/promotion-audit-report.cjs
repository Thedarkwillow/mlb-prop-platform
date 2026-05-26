const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = {
  decisionGrades: "outputs/decision-layer-grades-latest.json",
  production: "outputs/production-candidates.json",
  lineAudit: "outputs/line-specific-block-audit-latest.json",
  controlledUnlocks: "outputs/controlled-line-unlocks-latest.json",
  sideBiasWatch: "outputs/side-bias-override-watch-latest.json",
  out: `outputs/promotion-audit-report-${date}.json`,
  latest: "outputs/promotion-audit-report-latest.json",
  txt: `outputs/promotion-audit-report-${date}.txt`,
  latestTxt: "outputs/promotion-audit-report-latest.txt"
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function key(row) {
  return [
    norm(row.player),
    norm(row.market),
    norm(row.side),
    String(row.line ?? "")
  ].join("|");
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));
  const hits = graded.filter(r => String(r.result).toUpperCase() === "HIT").length;
  const misses = graded.filter(r => String(r.result).toUpperCase() === "MISS").length;
  const pushes = graded.filter(r => String(r.result).toUpperCase() === "PUSH").length;
  const unmatched = rows.length - graded.length;
  const denom = hits + misses;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : null,
    roi: denom ? Number(((hits - misses) / denom).toFixed(4)) : null
  };
}

function bucketOf(row) {
  return `${row.market || "unknown"}_${row.side || "unknown"}_${row.line ?? "unknown"}`;
}

function recommendationForGroup(layer, rows) {
  const s = summarize(rows);

  if (s.graded < 3) {
    return {
      action: "TRACK_MORE",
      reason: "too_few_graded_rows"
    };
  }

  if (s.hitRate >= 0.67 && s.roi >= 0.25) {
    return {
      action: "PROMOTION_CANDIDATE",
      reason: "strong_hit_rate_and_roi"
    };
  }

  if (s.hitRate >= 0.58 && s.roi > 0) {
    return {
      action: "WATCH_FOR_PROMOTION",
      reason: "positive_but_needs_more_sample"
    };
  }

  if (s.hitRate <= 0.45 || s.roi < -0.1) {
    return {
      action: "KEEP_BLOCKED",
      reason: "weak_or_negative_results"
    };
  }

  return {
    action: "TRACK_MORE",
    reason: "inconclusive"
  };
}

const decision = readJson(FILES.decisionGrades, {});
const production = readJson(FILES.production, {});
const lineAudit = readJson(FILES.lineAudit, {});
const unlocks = readJson(FILES.controlledUnlocks, {});
const sideBiasWatch = readJson(FILES.sideBiasWatch, {});

const gradedRows = Array.isArray(decision.rows) ? decision.rows : [];
const productionRows = Array.isArray(production.all) ? production.all : [];

const productionByKey = new Map();
for (const r of productionRows) productionByKey.set(key(r), r);

const enriched = gradedRows.map(r => {
  const p = productionByKey.get(key(r)) || {};
  return {
    ...r,
    productionClass: p.class || p.candidateClass || r.layer,
    reasons: p.reasons || [],
    blockedReason: p.blockedReason || r.blockedReason || null,
    sideBiasRoi: p.sideBias?.roi ?? p.fullBoardSideBias?.roi ?? p.sideRoi ?? null,
    sideBiasHitRate: p.sideBias?.hitRate ?? p.fullBoardSideBias?.hitRate ?? null,
    sportsbookBookCount: p.books ?? p.sportsbookBookCount ?? r.books ?? null,
    support: p.support ?? p.marketSupportFlag ?? r.support ?? null,
    grade: p.grade ?? p.qualityGrade ?? r.grade ?? null
  };
});

const byLayer = {};
for (const r of enriched) {
  if (!byLayer[r.layer]) byLayer[r.layer] = [];
  byLayer[r.layer].push(r);
}

const layerSummaries = Object.fromEntries(
  Object.entries(byLayer).map(([layer, rows]) => [
    layer,
    {
      ...summarize(rows),
      recommendation: recommendationForGroup(layer, rows)
    }
  ])
);

const bucketMap = new Map();
for (const r of enriched) {
  const b = `${r.layer} | ${bucketOf(r)}`;
  if (!bucketMap.has(b)) bucketMap.set(b, []);
  bucketMap.get(b).push(r);
}

const bucketSummaries = [...bucketMap.entries()]
  .map(([bucket, rows]) => ({
    bucket,
    layer: rows[0]?.layer || null,
    market: rows[0]?.market || null,
    side: rows[0]?.side || null,
    line: rows[0]?.line ?? null,
    ...summarize(rows),
    recommendation: recommendationForGroup(rows[0]?.layer || "UNKNOWN", rows),
    rows: rows.map(r => ({
      player: r.player,
      team: r.team,
      market: r.market,
      side: r.side,
      line: r.line,
      prob: r.prob,
      edge: r.edge,
      result: r.result,
      actual: r.actual,
      matchMethod: r.matchMethod,
      support: r.support,
      grade: r.grade,
      books: r.sportsbookBookCount,
      reasons: r.reasons
    }))
  }))
  .sort((a, b) => {
    const ar = a.recommendation.action === "PROMOTION_CANDIDATE" ? 0 : a.recommendation.action === "WATCH_FOR_PROMOTION" ? 1 : 2;
    const br = b.recommendation.action === "PROMOTION_CANDIDATE" ? 0 : b.recommendation.action === "WATCH_FOR_PROMOTION" ? 1 : 2;
    return ar - br || (b.roi ?? -99) - (a.roi ?? -99) || (b.hitRate ?? -99) - (a.hitRate ?? -99);
  });

const promotionCandidates = bucketSummaries.filter(b => b.recommendation.action === "PROMOTION_CANDIDATE");
const watchForPromotion = bucketSummaries.filter(b => b.recommendation.action === "WATCH_FOR_PROMOTION");
const keepBlocked = bucketSummaries.filter(b => b.recommendation.action === "KEEP_BLOCKED");

const output = {
  date,
  generatedAt: new Date().toISOString(),
  files: FILES,
  sourceCounts: {
    decisionRows: gradedRows.length,
    productionRows: productionRows.length,
    lineAuditRows: Array.isArray(lineAudit.rows) ? lineAudit.rows.length : null,
    controlledUnlockRows: Array.isArray(unlocks.candidates) ? unlocks.candidates.length : null,
    sideBiasWatchRows: Array.isArray(sideBiasWatch.watch) ? sideBiasWatch.watch.length : null
  },
  layerSummaries,
  promotionCandidates,
  watchForPromotion,
  keepBlocked,
  bucketSummaries
};

const lines = [];
lines.push("PROMOTION AUDIT REPORT");
lines.push("======================");
lines.push(`date: ${date}`);
lines.push(`generatedAt: ${output.generatedAt}`);
lines.push("");
lines.push("LAYER SUMMARIES");
lines.push("---------------");
for (const [layer, s] of Object.entries(layerSummaries)) {
  lines.push(`${layer}: rows=${s.rows} graded=${s.graded} hits=${s.hits} misses=${s.misses} hitRate=${pct(s.hitRate)} roi=${pct(s.roi)} action=${s.recommendation.action} reason=${s.recommendation.reason}`);
}
lines.push("");
lines.push("PROMOTION CANDIDATES");
lines.push("--------------------");
if (!promotionCandidates.length) {
  lines.push("none");
} else {
  for (const b of promotionCandidates) {
    lines.push(`${b.bucket}: graded=${b.graded} hits=${b.hits} misses=${b.misses} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)} reason=${b.recommendation.reason}`);
    for (const r of b.rows) {
      lines.push(`- ${r.player} | ${r.market} ${r.side} ${r.line} | prob=${pct(r.prob)} edge=${pct(r.edge)} result=${r.result} actual=${r.actual}`);
    }
  }
}
lines.push("");
lines.push("WATCH FOR PROMOTION");
lines.push("-------------------");
if (!watchForPromotion.length) {
  lines.push("none");
} else {
  for (const b of watchForPromotion) {
    lines.push(`${b.bucket}: graded=${b.graded} hits=${b.hits} misses=${b.misses} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)} reason=${b.recommendation.reason}`);
  }
}
lines.push("");
lines.push("KEEP BLOCKED");
lines.push("------------");
if (!keepBlocked.length) {
  lines.push("none");
} else {
  for (const b of keepBlocked) {
    lines.push(`${b.bucket}: graded=${b.graded} hits=${b.hits} misses=${b.misses} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)} reason=${b.recommendation.reason}`);
  }
}

writeJson(FILES.out, output);
writeJson(FILES.latest, output);
writeText(FILES.txt, lines.join("\n"));
writeText(FILES.latestTxt, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("saved:", FILES.out);
console.log("saved:", FILES.latest);
console.log("saved:", FILES.txt);
console.log("saved:", FILES.latestTxt);
