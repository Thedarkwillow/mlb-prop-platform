const fs = require("fs");
const path = require("path");

const OUT_JSON = "outputs/manual/auto-hitter-split-signal.json";
const OUT_TXT = "outputs/manual/auto-hitter-split-signal.txt";

const CURRENT_FILES = [
  "outputs/final-slips.json",
  "outputs/blocked-final-candidates.json",
  "outputs/playable-final-slips.json",
  "outputs/lean-final-slips.json"
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normMarket(m) {
  const x = norm(m).replaceAll(" ", "_");
  if (["total_bases", "bases", "tb"].includes(x)) return "bases";
  if (["hitter_fantasy_score", "fantasy_score", "hitter_fs", "fantasy"].includes(x)) return "hitter_fantasy_score";
  if (["hits_runs_rbis", "hrr"].includes(x)) return "hrr";
  if (["singles"].includes(x)) return "singles";
  if (["runs"].includes(x)) return "runs";
  if (["rbis", "rbi"].includes(x)) return "rbis";
  if (["walks"].includes(x)) return "walks";
  if (["hitter_strikeouts", "batter_strikeouts"].includes(x)) return "hitter_strikeouts";
  return x;
}

function isHitterMarket(m) {
  return [
    "hitter_fantasy_score",
    "hrr",
    "bases",
    "singles",
    "runs",
    "rbis",
    "walks",
    "hitter_strikeouts"
  ].includes(normMarket(m));
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

function resultFromRow(row, side, line) {
  const raw = String(row.result || row.outcome || "").toUpperCase();
  if (["HIT", "MISS", "PUSH", "REFUND", "DNP"].includes(raw)) return raw;

  const actual = n(row.actual ?? row.actualValue ?? row.statValue ?? row.value);
  const ln = n(line);

  if (actual === null || ln === null) return "UNMATCHED";
  if (actual === ln) return "PUSH";

  const s = String(side || "").toUpperCase();
  if (s === "MORE") return actual > ln ? "HIT" : "MISS";
  if (s === "LESS") return actual < ln ? "HIT" : "MISS";

  return "UNMATCHED";
}

function actualFromRow(row) {
  return n(row.actual ?? row.actualValue ?? row.statValue ?? row.value);
}

function rowDate(row, file) {
  const direct = row.date || row.slateDate || row.gameDate;
  if (direct) return String(direct).slice(0, 10);

  const m = file.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "unknown";
}

function compactHistorical(row, file) {
  const market = normMarket(row.market || row.stat || row.projectionType || "");
  const player = row.player || row.playerName || "";

  if (!player || !isHitterMarket(market)) return null;

  const side = String(row.side || row.recommendedSide || row.pickSide || "").toUpperCase();
  const line = n(row.line);
  const actual = actualFromRow(row);
  const result = resultFromRow(row, side, line);

  if (!["HIT", "MISS", "PUSH"].includes(result)) return null;

  return {
    date: rowDate(row, file),
    player,
    team: row.team || row.resolvedTeam || "",
    market,
    side,
    line,
    tier: String(row.oddsTier || row.tier || row.specialTier || "standard").toLowerCase(),
    actual,
    result,
    file,
    homeAway: row.homeAway || row.home_away || row.location || "",
    pitcherHand: row.pitcherHand || row.opposingPitcherHand || row.starterHand || "",
    opposingPitcher: row.opposingPitcher || row.pitcher || row.probablePitcher || ""
  };
}

function compactCurrent(row, file) {
  const market = normMarket(row.market || row.stat || "");
  const player = row.player || row.playerName || "";

  if (!player || !isHitterMarket(market)) return null;

  return {
    sourceFile: file,
    player,
    team: row.team || row.resolvedTeam || "",
    market,
    side: String(row.side || row.recommendedSide || row.pickSide || "").toUpperCase(),
    line: n(row.line),
    tier: String(row.oddsTier || row.tier || row.specialTier || "standard").toLowerCase(),
    prob: n(row.calibratedDistributionProb) ?? n(row.prob),
    edge: n(row.adjustedEdge) ?? n(row.edge),
    grade: row.grade || "",
    finalExecutionPassed: row.finalExecutionGate?.passed ?? row.finalExecutionPassed ?? null,
    blockedReason: row.blockedReason || row.disabledReason || row.reason || "",
    homeAway: row.homeAway || row.home_away || row.location || "",
    pitcherHand: row.pitcherHand || row.opposingPitcherHand || row.starterHand || "",
    opposingPitcher: row.opposingPitcher || row.pitcher || row.probablePitcher || ""
  };
}

function historicalFiles() {
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!p.includes("outputs/history/runs")) walk(p);
        continue;
      }
      if (!ent.name.endsWith(".json")) continue;
      if (
        ent.name.includes("graded") ||
        ent.name.includes("grades") ||
        ent.name.includes("full-board") ||
        ent.name.includes("decision-layer")
      ) {
        files.push(p);
      }
    }
  }

  walk("outputs/history");
  for (const f of [
    "outputs/all-markets-graded.json",
    "outputs/full-board-graded.json",
    "outputs/graded-props.json",
    "outputs/decision-layer-grades-latest.json"
  ]) {
    if (fs.existsSync(f)) files.push(f);
  }

  return [...new Set(files)];
}

function currentRows() {
  const rows = [];

  for (const file of CURRENT_FILES) {
    const json = readJson(file);
    if (!json) continue;
    for (const row of flatten(json)) {
      const c = compactCurrent(row, file);
      if (c && c.line !== null) rows.push(c);
    }
  }

  return rows;
}

function historicalRows() {
  const rows = [];
  const files = historicalFiles();

  for (const file of files) {
    const json = readJson(file);
    if (!json) continue;

    for (const row of flatten(json)) {
      const h = compactHistorical(row, file);
      if (h) rows.push(h);
    }
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return rows;
}

function samePlayer(a, b) {
  return norm(a.player) === norm(b.player);
}

function sameMarketSide(a, b) {
  return a.market === b.market && String(a.side).toUpperCase() === String(b.side).toUpperCase();
}

function sameTier(a, b) {
  return String(a.tier || "standard").toLowerCase() === String(b.tier || "standard").toLowerCase();
}

function lineCompatible(hist, cur) {
  const hl = n(hist.line);
  const cl = n(cur.line);
  if (hl === null || cl === null) return false;

  // Exact line match preferred. For hitter fantasy/HRR, allow same line only.
  return Math.abs(hl - cl) < 0.0001;
}

function summarizeSample(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const actuals = graded.map(r => n(r.actual)).filter(v => v !== null);
  const avg = actuals.length ? actuals.reduce((a, b) => a + b, 0) / actuals.length : null;

  return {
    count: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    hitRate: graded.length ? +(hits / graded.length).toFixed(4) : null,
    avg: avg === null ? null : +avg.toFixed(3)
  };
}

function rateScore(rate) {
  if (rate === null || rate === undefined) return { score: 0, label: "missing" };
  if (rate >= 0.7) return { score: 2.0, label: "elite_70_plus" };
  if (rate >= 0.65) return { score: 1.5, label: "very_strong_65_plus" };
  if (rate >= 0.6) return { score: 1.0, label: "strong_60_plus" };
  if (rate >= 0.55) return { score: 0.6, label: "solid_55_plus" };
  if (rate >= 0.5) return { score: 0.25, label: "positive_50_plus" };
  return { score: -0.75, label: "below_50" };
}

function avgScore(avg, line) {
  const a = n(avg);
  const l = n(line);
  if (a === null || l === null || l === 0) return { score: 0, label: "missing" };

  const ratio = a / l;
  if (ratio >= 1.75) return { score: 1.0, label: "avg_far_above_line" };
  if (ratio >= 1.4) return { score: 0.75, label: "avg_well_above_line" };
  if (ratio >= 1.15) return { score: 0.5, label: "avg_above_line" };
  if (ratio >= 1.0) return { score: 0.25, label: "avg_slightly_above_line" };
  return { score: -0.5, label: "avg_below_line" };
}

function scoreSignal(cur, splits) {
  let score = 0;
  const reasons = [];
  const warnings = [];
  let positiveRateSplits = 0;
  let avgAboveLineSplits = 0;

  for (const [label, sample] of Object.entries(splits)) {
    if (!sample || sample.graded === 0) continue;

    const rs = rateScore(sample.hitRate);
    const as = avgScore(sample.avg, cur.line);

    score += rs.score + as.score;

    if (sample.hitRate !== null && sample.hitRate >= 0.5) positiveRateSplits++;
    if (sample.avg !== null && cur.line !== null && sample.avg >= cur.line) avgAboveLineSplits++;

    reasons.push(`${label}:${rs.label}:${sample.hitRate === null ? "n/a" : (sample.hitRate * 100).toFixed(1) + "%"}:n=${sample.graded}`);
    reasons.push(`${label}_avg:${as.label}:${sample.avg === null ? "n/a" : sample.avg}`);
  }

  if (cur.tier === "goblin" && cur.market === "bases" && cur.side === "MORE" && cur.line === 0.5) {
    score += 0.5;
    reasons.push("goblin_bases_more_0_5_auto_lane");
  }

  if (cur.market === "hrr" && cur.side === "MORE") {
    score -= 0.5;
    warnings.push("hrr_more_manual_bucket_has_been_weak");
  }

  if (cur.market === "hitter_fantasy_score" && cur.side === "MORE") {
    score += 0.25;
    reasons.push("hitter_fantasy_more_auto_lane");
  }

  let cls = "WEAK_AUTO_SIGNAL";
  if (score >= 7 && positiveRateSplits >= 4 && avgAboveLineSplits >= 3) cls = "ELITE_AUTO_SIGNAL";
  else if (score >= 5 && positiveRateSplits >= 3 && avgAboveLineSplits >= 2) cls = "STRONG_AUTO_SIGNAL";
  else if (score >= 3 && positiveRateSplits >= 2) cls = "GOOD_AUTO_SIGNAL";
  else if (score >= 1) cls = "WATCH_AUTO_SIGNAL";

  return {
    score: +score.toFixed(3),
    class: cls,
    reasons,
    warnings,
    positiveRateSplits,
    avgAboveLineSplits
  };
}

function buildForCurrent(cur, hist) {
  const basePool = hist.filter(h =>
    samePlayer(h, cur) &&
    sameMarketSide(h, cur) &&
    lineCompatible(h, cur)
  );

  const tierPool = basePool.filter(h => sameTier(h, cur));
  const pool = tierPool.length >= 3 ? tierPool : basePool;

  const last = [...pool].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const splits = {
    last5: summarizeSample(last.slice(0, 5)),
    last10: summarizeSample(last.slice(0, 10)),
    last15: summarizeSample(last.slice(0, 15)),
    season: summarizeSample(pool)
  };

  if (cur.homeAway) {
    const locPool = pool.filter(h => norm(h.homeAway) === norm(cur.homeAway));
    if (locPool.length) splits.homeAway = summarizeSample(locPool);
  }

  if (cur.pitcherHand) {
    const handPool = pool.filter(h => norm(h.pitcherHand) === norm(cur.pitcherHand));
    if (handPool.length) splits.handedness = summarizeSample(handPool);
  }

  if (cur.homeAway && cur.pitcherHand) {
    const comboPool = pool.filter(h =>
      norm(h.homeAway) === norm(cur.homeAway) &&
      norm(h.pitcherHand) === norm(cur.pitcherHand)
    );
    if (comboPool.length) splits.homeAwayHand = summarizeSample(comboPool);
  }

  if (cur.opposingPitcher) {
    const vpPool = pool.filter(h => norm(h.opposingPitcher) && norm(h.opposingPitcher) === norm(cur.opposingPitcher));
    if (vpPool.length) splits.vsPitcher = summarizeSample(vpPool);
  }

  const signal = scoreSignal(cur, splits);

  return {
    ...cur,
    historySample: pool.length,
    usedTierSpecificPool: tierPool.length >= 3,
    splits,
    autoManualSignalScore: signal.score,
    autoManualSignalClass: signal.class,
    autoManualSignalReasons: signal.reasons,
    autoManualSignalWarnings: signal.warnings,
    positiveRateSplits: signal.positiveRateSplits,
    avgAboveLineSplits: signal.avgAboveLineSplits
  };
}

function bucket(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, { key, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

const hist = historicalRows();
const current = currentRows();
const scored = current.map(row => buildForCurrent(row, hist));

const summary = {
  generatedAt: new Date().toISOString(),
  historicalRows: hist.length,
  currentRows: current.length,
  bySignalClass: bucket(scored, r => r.autoManualSignalClass),
  byMarketSignalClass: bucket(scored, r => `${r.market} ${r.side} | ${r.autoManualSignalClass}`),
  rows: scored
};

writeJson(OUT_JSON, summary);

const lines = [];
lines.push("AUTO HITTER SPLIT SIGNAL");
lines.push("========================");
lines.push(`historical hitter rows: ${hist.length}`);
lines.push(`current hitter rows: ${current.length}`);
lines.push("");

lines.push("BY SIGNAL CLASS");
lines.push("---------------");
for (const b of summary.bySignalClass) {
  lines.push(`- ${b.key}: ${b.count}`);
}
lines.push("");

lines.push("BY MARKET + SIGNAL CLASS");
lines.push("------------------------");
for (const b of summary.byMarketSignalClass) {
  lines.push(`- ${b.key}: ${b.count}`);
}
lines.push("");

lines.push("TOP AUTO SIGNALS");
lines.push("----------------");
for (const r of scored
  .filter(r => r.autoManualSignalClass !== "WEAK_AUTO_SIGNAL")
  .sort((a, b) => b.autoManualSignalScore - a.autoManualSignalScore)
  .slice(0, 50)
) {
  lines.push(`- ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | signal=${r.autoManualSignalClass} score=${r.autoManualSignalScore} | sample=${r.historySample} | source=${r.sourceFile}`);
  if (r.autoManualSignalReasons?.length) lines.push(`  reasons: ${r.autoManualSignalReasons.slice(0, 10).join(", ")}`);
  if (r.autoManualSignalWarnings?.length) lines.push(`  warnings: ${r.autoManualSignalWarnings.join(", ")}`);
}

lines.push("");
lines.push("LOW / MISSING SAMPLE CURRENT HITTERS");
lines.push("------------------------------------");
for (const r of scored.filter(r => r.historySample < 3).slice(0, 60)) {
  lines.push(`- ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | sample=${r.historySample} | signal=${r.autoManualSignalClass}`);
}

fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
