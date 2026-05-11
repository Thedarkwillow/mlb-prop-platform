import fs from "fs";

const INPUT_CANDIDATES = [
  "data/results/graded-props.json",
  "outputs/graded-props.json",
  "data/results/official-results.json",
  "outputs/official-results.json"
];

const OUT_JSON = "data/model/phase55-risk-calibration.json";
const OUT_REPORT = "reports/phase55-risk-calibration-report.json";

function readJson(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function rowsFromAnyShape(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.rows)) return raw.rows;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.graded)) return raw.graded;
  if (Array.isArray(raw?.props)) return raw.props;
  return [];
}

function loadRows() {
  for (const p of INPUT_CANDIDATES) {
    const raw = readJson(p);
    const rows = rowsFromAnyShape(raw);
    if (rows.length) {
      console.log(`Loaded ${rows.length} graded rows from ${p}`);
      return rows;
    }
  }
  throw new Error("No graded result file found.");
}

function normMarket(v) {
  return String(v || "unknown").toLowerCase().trim();
}

function normSide(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "UNKNOWN";
}

function getProb(r) {
  return Number(
    r.probability ??
    r.prob ??
    r.modelProbability ??
    r.winProbability ??
    r.p ??
    0
  );
}

function getEdge(r) {
  return Number(
    r.edge ??
    r.evEdge ??
    r.projectionEdge ??
    Math.abs(Number(r.projection ?? 0) - Number(r.line ?? 0))
  );
}

function isWin(r) {
  const v = r.result ?? r.outcome ?? r.grade ?? r.status ?? r.win;
  if (typeof v === "boolean") return v;
  const s = String(v || "").toLowerCase();
  return ["win", "won", "hit", "correct", "green", "true"].includes(s);
}

function isGraded(r) {
  const v = r.result ?? r.outcome ?? r.grade ?? r.status ?? r.win;
  if (typeof v === "boolean") return true;
  const s = String(v || "").toLowerCase();
  return ["win", "won", "hit", "correct", "green", "loss", "lost", "miss", "red", "false"].includes(s);
}

function bucketProb(p) {
  if (p >= 0.80) return "80+";
  if (p >= 0.75) return "75-79";
  if (p >= 0.70) return "70-74";
  if (p >= 0.65) return "65-69";
  if (p >= 0.60) return "60-64";
  return "<60";
}

function bucketEdge(e) {
  if (e >= 2.0) return "2.0+";
  if (e >= 1.5) return "1.5-1.99";
  if (e >= 1.0) return "1.0-1.49";
  if (e >= 0.5) return "0.5-0.99";
  return "<0.5";
}

function summarize(rows, keyFn) {
  const map = {};
  for (const r of rows) {
    const key = keyFn(r);
    if (!map[key]) map[key] = { plays: 0, wins: 0, losses: 0 };
    map[key].plays++;
    if (isWin(r)) map[key].wins++;
    else map[key].losses++;
  }

  for (const k of Object.keys(map)) {
    const x = map[k];
    x.hitRate = x.plays ? +(x.wins / x.plays).toFixed(4) : 0;
    x.roiProxy = +((x.hitRate - 0.5) * 2).toFixed(4);
  }

  return map;
}

function trustScore(x) {
  if (!x || x.plays < 10) return 0.5;
  let score = 0.5;

  score += (x.hitRate - 0.52) * 2.2;

  if (x.plays >= 50) score += 0.08;
  if (x.plays >= 100) score += 0.12;

  return Math.max(0.05, Math.min(1, +score.toFixed(4)));
}

function suppressionLevel(x) {
  if (!x || x.plays < 20) return "sample_watch";
  if (x.hitRate < 0.46) return "hard_suppress";
  if (x.hitRate < 0.50) return "soft_suppress";
  if (x.hitRate < 0.53) return "watch";
  return "healthy";
}

function confidenceRemap(probBucketStats) {
  const remap = {};

  for (const [bucket, x] of Object.entries(probBucketStats)) {
    if (x.plays < 15) {
      remap[bucket] = {
        sample: x.plays,
        action: "hold",
        multiplier: 0.97,
        observedHitRate: x.hitRate
      };
      continue;
    }

    const expectedMid = {
      "80+": 0.82,
      "75-79": 0.77,
      "70-74": 0.72,
      "65-69": 0.67,
      "60-64": 0.62,
      "<60": 0.58
    }[bucket] ?? 0.6;

    const multiplier = Math.max(0.82, Math.min(1.04, x.hitRate / expectedMid));

    remap[bucket] = {
      sample: x.plays,
      expected: expectedMid,
      observedHitRate: x.hitRate,
      multiplier: +multiplier.toFixed(4)
    };
  }

  return remap;
}

function main() {
  const allRows = loadRows().filter(isGraded);

  const rows = allRows.map(r => ({
    ...r,
    _market: normMarket(r.market ?? r.statType ?? r.stat ?? r.projectionType),
    _side: normSide(r.side ?? r.pick ?? r.direction),
    _prob: getProb(r),
    _edge: getEdge(r)
  }));

  const byMarket = summarize(rows, r => r._market);
  const byMarketSide = summarize(rows, r => `${r._market}:${r._side}`);
  const byProbBucket = summarize(rows, r => bucketProb(r._prob));
  const byEdgeBucket = summarize(rows, r => bucketEdge(r._edge));
  const byConfidence = summarize(rows, r => String(r.confidence ?? r.confidenceTier ?? "unknown"));

  const marketTrust = {};
  const marketSuppression = {};

  for (const [market, stats] of Object.entries(byMarket)) {
    marketTrust[market] = trustScore(stats);
    marketSuppression[market] = suppressionLevel(stats);
  }

  const marketSideSuppression = {};
  for (const [key, stats] of Object.entries(byMarketSide)) {
    marketSideSuppression[key] = suppressionLevel(stats);
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    sampleSize: rows.length,
    marketTrust,
    marketSuppression,
    marketSideSuppression,
    confidenceRemap: confidenceRemap(byProbBucket),
    volatilityRules: {
      hrr: { basePenalty: 0.08, suppressIfHitRateBelow: 0.50 },
      home_runs: { basePenalty: 0.10, suppressIfHitRateBelow: 0.50 },
      hitter_fantasy_score: { basePenalty: 0.12, suppressIfHitRateBelow: 0.52 },
      pitcher_fantasy_score: { basePenalty: 0.12, suppressIfHitRateBelow: 0.52 },
      bases: { basePenalty: 0.05, suppressIfHitRateBelow: 0.50 },
      hits: { basePenalty: 0.04, suppressIfHitRateBelow: 0.50 },
      strikeouts: { basePenalty: 0.02, suppressIfHitRateBelow: 0.49 },
      pitching_outs: { basePenalty: 0.03, suppressIfHitRateBelow: 0.49 }
    }
  };

  const report = {
    generatedAt: artifact.generatedAt,
    sampleSize: rows.length,
    byMarket,
    byMarketSide,
    byProbBucket,
    byEdgeBucket,
    byConfidence,
    marketTrust,
    marketSuppression,
    marketSideSuppression,
    confidenceRemap: artifact.confidenceRemap
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2));

  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_REPORT}`);
}

main();
