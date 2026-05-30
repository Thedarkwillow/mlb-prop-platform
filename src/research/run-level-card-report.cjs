const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const RUNS_DIR = `outputs/history/runs/${date}`;
const OUT_JSON = `outputs/history/${date}-run-level-cards.json`;
const OUT_TXT = `outputs/history/${date}-run-level-cards.txt`;

function readJson(file, fallback = null) {
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

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function pct(v) {
  const x = n(v);
  return x == null ? "n/a" : `${(x * 100).toFixed(2)}%`;
}

function keyOf(r) {
  return [
    String(r.player || r.playerName || "").toLowerCase().trim(),
    String(r.market || r.stat || "").toLowerCase().trim(),
    String(r.side || r.recommendedSide || r.pickSide || "").toUpperCase().trim(),
    String(r.line ?? "").trim(),
    String(r.oddsTier || r.tier || "").toLowerCase().trim()
  ].join("|");
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

function compactLeg(r, source, run) {
  const prob =
    n(r.calibratedDistributionProb) ??
    n(r.distributionProb) ??
    n(r.recommendedProb) ??
    n(r.prob);

  const edge =
    n(r.adjustedEdge) ??
    n(r.edge) ??
    n(r.expectedValue);

  return {
    date,
    runId: run.runId,
    timestampUtc: run.timestampUtc,
    timestampPacific: run.timestampPacific,
    source,
    player: r.player || r.playerName || null,
    team: r.team || r.resolvedTeam || null,
    game: r.game || r.resolvedGame || null,
    gamePk: r.gamePk || r.resolvedGamePk || null,
    market: String(r.market || r.stat || "").toLowerCase() || null,
    side: String(r.side || r.recommendedSide || r.pickSide || "").toUpperCase() || null,
    line: n(r.line),
    oddsTier: String(r.oddsTier || r.tier || r.specialTier || "standard").toLowerCase(),
    prob,
    edge,
    adjustedEdge: n(r.adjustedEdge),
    score: n(r.finalScore) ?? n(r.score),
    books: n(r.books) ?? n(r.sportsbookBookCount),
    support: r.marketSupportFlag || r.support || r.priceCoverageTier || null,
    grade: r.grade || null,
    disabledReason: r.disabledReason || null,
    finalMarketGatePassed: r.finalMarketGatePassed ?? null,
    finalExecutionPassed: r.finalExecutionGate?.passed ?? null,
    finalExecutionReasons: r.finalExecutionGate?.reasons || [],
    sideBiasTier: r.fullBoardSideBias?.tier || r.fullBoardPromotion?.action || null,
    sideBiasRoi: n(r.fullBoardSideBias?.roi) ?? n(r.fullBoardPromotion?.roi),
    fullBoardPromotion: r.fullBoardPromotion ? {
      action: r.fullBoardPromotion.action || null,
      reason: r.fullBoardPromotion.reason || null,
      count: n(r.fullBoardPromotion.count),
      hitRate: n(r.fullBoardPromotion.hitRate),
      roi: n(r.fullBoardPromotion.roi)
    } : null,
    raw: {
      confidence: r.confidence || r.calibratedConfidence?.confidence || r.finalExecutionGate?.confidence || null,
      distributionConfidence: r.distributionConfidence || null,
      volatility: r.volatilityAdjustment?.volatility || r.finalExecutionGate?.volatility || null
    }
  };
}

function dedupe(legs) {
  const seen = new Set();
  const out = [];
  for (const leg of legs) {
    const k = [
      leg.source,
      String(leg.player || "").toLowerCase(),
      String(leg.market || "").toLowerCase(),
      String(leg.side || "").toUpperCase(),
      String(leg.line ?? ""),
      String(leg.oddsTier || "").toLowerCase()
    ].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(leg);
  }
  return out;
}

function runMeta(runDir) {
  const manifest = readJson(path.join(runDir, "manifest.json"), {});
  const runId = manifest.runId || path.basename(runDir);
  return {
    runId,
    timestampUtc: manifest.timestampUtc || null,
    timestampPacific: manifest.timestampPacific || runId.replace(`${date}-`, "")
  };
}

function summarize(legs) {
  const bySource = {};
  const byTier = {};
  const byMarketSide = {};
  for (const leg of legs) {
    bySource[leg.source] = (bySource[leg.source] || 0) + 1;
    byTier[leg.oddsTier] = (byTier[leg.oddsTier] || 0) + 1;
    const ms = `${leg.market} ${leg.side}`;
    byMarketSide[ms] = (byMarketSide[ms] || 0) + 1;
  }
  return { total: legs.length, bySource, byTier, byMarketSide };
}

if (!fs.existsSync(RUNS_DIR)) {
  console.error(`No run directory found: ${RUNS_DIR}`);
  process.exit(1);
}

const runDirs = fs.readdirSync(RUNS_DIR)
  .map(name => path.join(RUNS_DIR, name))
  .filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory())
  .sort();

const runs = [];

for (const runDir of runDirs) {
  const run = runMeta(runDir);

  const finalSlips = readJson(path.join(runDir, "final-slips.json"), null);
  const playable = readJson(path.join(runDir, "playable-final-slips.json"), null);
  const blocked = readJson(path.join(runDir, "blocked-final-candidates.json"), null);
  const slipType = readJson(path.join(runDir, "slip-type-optimization.json"), null);

  const finalLegs = dedupe(flatten(finalSlips).map(r => compactLeg(r, "final", run)));
  const playableLegs = dedupe(flatten(playable).map(r => compactLeg(r, "playable", run)));
  const blockedLegs = dedupe(flatten(blocked).map(r => compactLeg(r, "blocked", run)));
  const v5Legs = dedupe(flatten(slipType).map(r => compactLeg(r, "v5_shadow", run)));

  const allLegs = [...finalLegs, ...playableLegs, ...blockedLegs, ...v5Legs];

  runs.push({
    ...run,
    runDir,
    counts: {
      final: finalLegs.length,
      playable: playableLegs.length,
      blocked: blockedLegs.length,
      v5Shadow: v5Legs.length,
      totalExtracted: allLegs.length
    },
    summary: summarize(allLegs),
    legs: allLegs
  });
}

const allLegs = runs.flatMap(r => r.legs);
const report = {
  date,
  generatedAt: new Date().toISOString(),
  runCount: runs.length,
  totalLegRows: allLegs.length,
  summary: summarize(allLegs),
  runs
};

writeJson(OUT_JSON, report);

let txt = "";
txt += `RUN-LEVEL CARD REPORT\n`;
txt += `=====================\n`;
txt += `date: ${date}\n`;
txt += `runs: ${runs.length}\n`;
txt += `legs: ${allLegs.length}\n\n`;

for (const r of runs) {
  txt += `${r.runId} | ${r.timestampPacific || "n/a"}\n`;
  txt += `  final=${r.counts.final} playable=${r.counts.playable} blocked=${r.counts.blocked} v5=${r.counts.v5Shadow}\n`;

  const interesting = r.legs
    .filter(x =>
      x.source === "final" ||
      x.source === "playable" ||
      x.source === "v5_shadow"
    )
    .slice(0, 12);

  if (!interesting.length) {
    txt += `  none\n\n`;
    continue;
  }

  for (const leg of interesting) {
    txt += `  - [${leg.source}] ${leg.player || "unknown"} | ${leg.team || ""} | ${leg.market} ${leg.side} ${leg.line ?? ""} | ${leg.oddsTier} | prob=${pct(leg.prob)} | edge=${pct(leg.edge)} | books=${leg.books ?? "n/a"} | grade=${leg.grade || "n/a"} | exec=${leg.finalExecutionPassed}\n`;
    if (leg.finalExecutionReasons?.length) {
      txt += `    reasons: ${leg.finalExecutionReasons.join(", ")}\n`;
    }
  }
  txt += `\n`;
}

fs.writeFileSync(OUT_TXT, txt);

console.log("RUN-LEVEL CARD REPORT");
console.log("=====================");
console.log({ date, runs: runs.length, legs: allLegs.length, outJson: OUT_JSON, outTxt: OUT_TXT });
console.log();
console.log(txt.split("\n").slice(0, 80).join("\n"));
