const fs = require("fs");
const path = require("path");

const ledgerFile = "data/manual/manual-research-ledger.json";
const outJson = "outputs/manual/manual-model-compare.json";
const outTxt = "outputs/manual/manual-model-compare.txt";

const modelFiles = [
  "outputs/final-slips.json",
  "outputs/blocked-final-candidates.json",
  "outputs/playable-final-slips.json",
  "outputs/lean-final-slips.json",
  "outputs/history/2026-05-30-run-level-cards.json",
  "outputs/history/2026-05-30-run-level-grades.json"
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normMarket(m) {
  const x = norm(m);
  if (["total bases", "total_bases", "tb", "bases"].includes(x)) return "bases";
  if (["hitter fantasy score", "hitter_fantasy_score", "fantasy"].includes(x)) return "hitter_fantasy_score";
  if (["hits runs rbis", "hrr"].includes(x)) return "hrr";
  if (["pitcher strikeouts", "strikeouts", "ks"].includes(x)) return "strikeouts";
  if (["pitching outs", "pitching_outs"].includes(x)) return "pitching_outs";
  if (["hits allowed", "hits_allowed"].includes(x)) return "hits_allowed";
  if (["walks allowed", "walks_allowed"].includes(x)) return "walks_allowed";
  return x.replaceAll(" ", "_");
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
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

function compactModelRow(r, file) {
  return {
    file,
    runId: r.runId || null,
    source: r.source || null,
    player: r.player || r.playerName || null,
    team: r.team || r.resolvedTeam || null,
    market: normMarket(r.market || r.stat || ""),
    side: String(r.side || r.recommendedSide || r.pickSide || "").toUpperCase(),
    line: n(r.line),
    tier: String(r.oddsTier || r.tier || r.specialTier || "standard").toLowerCase(),
    prob: n(r.calibratedDistributionProb) ?? n(r.prob),
    edge: n(r.adjustedEdge) ?? n(r.edge),
    grade: r.grade || null,
    result: r.result || null,
    actual: n(r.actual),
    finalExecutionPassed: r.finalExecutionGate?.passed ?? r.finalExecutionPassed ?? null,
    finalExecutionReasons: r.finalExecutionGate?.reasons || r.finalExecutionReasons || [],
    blockedReason: r.blockedReason || r.disabledReason || r.reason || null,
    leanStatus: r.leanStatus || null,
    official: r.official ?? null
  };
}

function samePlayer(a, b) {
  return norm(a.player) === norm(b.player);
}

function sameMarketSide(a, b) {
  return normMarket(a.market) === normMarket(b.market) &&
    String(a.side || "").toUpperCase() === String(b.side || "").toUpperCase();
}

function sameLine(a, b) {
  const al = n(a.line);
  const bl = n(b.line);
  return al !== null && bl !== null && Math.abs(al - bl) < 0.0001;
}

function classifyManualVsModel(manual, matches) {
  if (!matches.length) return "MODEL_MISSING";

  const exact = matches.filter(m => sameMarketSide(manual, m) && sameLine(manual, m));
  const pool = exact.length ? exact : matches;

  if (pool.some(m => m.finalExecutionPassed === true && (m.source === "final" || m.file.includes("final-slips")))) {
    return "MODEL_EXECUTION_PASSED";
  }

  if (pool.some(m => String(m.leanStatus || "").toUpperCase() === "LEAN" || m.file.includes("lean-final-slips"))) {
    return "MODEL_LEAN";
  }

  if (pool.some(m => m.file.includes("blocked") || m.blockedReason || m.finalExecutionPassed === false)) {
    return "MODEL_BLOCKED_OR_WATCH";
  }

  if (exact.length) return "MODEL_SAW_EXACT";
  return "MODEL_SAW_PLAYER";
}

function bucketSummary(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) {
      map.set(key, { key, total: 0, graded: 0, hits: 0, misses: 0, pushes: 0, refunds: 0, pending: 0, hitRate: null });
    }
    const b = map.get(key);
    const result = String(r.result || "").toUpperCase();
    b.total++;
    if (result === "HIT" || result === "WIN") { b.graded++; b.hits++; }
    else if (result === "MISS" || result === "LOSS") { b.graded++; b.misses++; }
    else if (result === "PUSH") { b.graded++; b.pushes++; }
    else if (result === "REFUND" || result === "DNP") b.refunds++;
    else b.pending++;
    b.hitRate = b.graded ? +(b.hits / b.graded).toFixed(4) : null;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || (b.hitRate || 0) - (a.hitRate || 0));
}

const manualRows = readJson(ledgerFile, []);
const modelRows = [];

for (const file of modelFiles) {
  const json = readJson(file);
  if (!json) continue;
  for (const row of flatten(json)) {
    modelRows.push(compactModelRow(row, file));
  }
}

const compared = manualRows.map(m => {
  const manual = {
    ...m,
    market: normMarket(m.market),
    side: String(m.side || "").toUpperCase(),
    tier: String(m.tier || "standard").toLowerCase(),
    line: n(m.line)
  };

  const playerMatches = modelRows.filter(r => samePlayer(manual, r));
  const exactMatches = playerMatches.filter(r => sameMarketSide(manual, r) && sameLine(manual, r));
  const marketMatches = playerMatches.filter(r => sameMarketSide(manual, r));

  const usefulMatches = exactMatches.length ? exactMatches : (marketMatches.length ? marketMatches : playerMatches);
  const modelClass = classifyManualVsModel(manual, usefulMatches);

  return {
    ...manual,
    modelClass,
    modelMatchCount: usefulMatches.length,
    exactModelMatchCount: exactMatches.length,
    modelMatches: usefulMatches.slice(0, 8)
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  manualRows: manualRows.length,
  modelRows: modelRows.length,
  byModelClass: bucketSummary(compared, r => r.modelClass),
  byMarketSideAndModelClass: bucketSummary(compared, r => `${r.market} ${r.side} | ${r.modelClass}`),
  rows: compared
};

writeJson(outJson, summary);

const lines = [];
lines.push("MANUAL VS MODEL COMPARE");
lines.push("=======================");
lines.push(`manual rows: ${manualRows.length}`);
lines.push(`model rows scanned: ${modelRows.length}`);
lines.push("");

lines.push("BY MODEL CLASS");
lines.push("--------------");
for (const b of summary.byModelClass) {
  const hr = b.hitRate == null ? "n/a" : `${(b.hitRate * 100).toFixed(2)}%`;
  lines.push(`- ${b.key}: total=${b.total} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} refunds=${b.refunds} pending=${b.pending} hitRate=${hr}`);
}
lines.push("");

lines.push("BY MARKET/SIDE + MODEL CLASS");
lines.push("----------------------------");
for (const b of summary.byMarketSideAndModelClass.slice(0, 60)) {
  const hr = b.hitRate == null ? "n/a" : `${(b.hitRate * 100).toFixed(2)}%`;
  lines.push(`- ${b.key}: total=${b.total} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} refunds=${b.refunds} pending=${b.pending} hitRate=${hr}`);
}
lines.push("");

lines.push("MANUAL ROWS MODEL DID NOT SEE");
lines.push("-----------------------------");
for (const r of compared.filter(x => x.modelClass === "MODEL_MISSING").slice(0, 80)) {
  lines.push(`- ${r.date} | ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | result=${r.result} actual=${r.actual ?? "n/a"}`);
}

fs.writeFileSync(outTxt, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${outJson}`);
console.log(`saved: ${outTxt}`);
