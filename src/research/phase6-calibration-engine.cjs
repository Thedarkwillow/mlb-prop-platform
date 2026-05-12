const fs = require("fs");

function readJson(p, fallback) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sideOf(v) {
  return String(v || "").toUpperCase().includes("LESS") ? "LESS" : "MORE";
}

function marketOf(r) {
  return norm(r.market || r.stat || r.statKey);
}

function resultOf(r) {
  const raw = String(r.result || r.grade || r.outcome || r.status || "").toUpperCase();
  if (["WIN", "WON", "HIT", "CASH", "GREEN"].includes(raw)) return "WIN";
  if (["LOSS", "LOST", "MISS", "RED"].includes(raw)) return "LOSS";
  return null;
}

function probOf(r) {
  const v = Number(r.recommendedProb ?? r.calibratedProb ?? r.prob ?? r.modelProb ?? r.probability);
  return Number.isFinite(v) ? Math.max(0.01, Math.min(0.99, v)) : null;
}

function edgeOf(r) {
  const v = Number(r.adjEdge ?? r.edge ?? r.expectedEdge);
  return Number.isFinite(v) ? Math.abs(v) : null;
}

function probBucket(p) {
  if (!Number.isFinite(p)) return "unknown";
  const low = Math.floor(p * 20) / 20;
  return `${low.toFixed(2)}-${(low + 0.05).toFixed(2)}`;
}

function edgeBucket(e) {
  if (!Number.isFinite(e)) return "unknown";
  if (e < 0.03) return "0.00-0.03";
  if (e < 0.06) return "0.03-0.06";
  if (e < 0.10) return "0.06-0.10";
  if (e < 0.20) return "0.10-0.20";
  if (e < 0.35) return "0.20-0.35";
  return "0.35+";
}

function add(group, key, r) {
  group[key] ||= {
    key,
    sample: 0,
    wins: 0,
    losses: 0,
    probSum: 0,
    probCount: 0,
    edgeSum: 0,
    edgeCount: 0
  };
  const g = group[key];
  g.sample++;
  if (r.result === "WIN") g.wins++;
  if (r.result === "LOSS") g.losses++;
  if (r.prob !== null) {
    g.probSum += r.prob;
    g.probCount++;
  }
  if (r.edge !== null) {
    g.edgeSum += r.edge;
    g.edgeCount++;
  }
}

const files = [
  "outputs/all-markets-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  "outputs/fantasy-graded.json"
];

if (fs.existsSync("outputs/history")) {
  for (const f of fs.readdirSync("outputs/history")) {
    if (f.endsWith(".json")) files.push(`outputs/history/${f}`);
  }
}

const rows = [];
for (const file of files) {
  const raw = readJson(file, []);
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.rows) ? raw.rows : Object.values(raw || {});
  for (const r of arr) {
    const result = resultOf(r);
    const market = marketOf(r);
    if (!result || !market) continue;
    rows.push({
      market,
      side: sideOf(r.side || r.recommendedSide),
      result,
      prob: probOf(r),
      edge: edgeOf(r)
    });
  }
}

const calibration = {};
const shrinkage = {};
const confidence = {};

for (const r of rows) {
  const ms = `${r.market}_${r.side}`;
  add(calibration, `${ms}_${probBucket(r.prob)}`, r);
  add(shrinkage, `${ms}_${edgeBucket(r.edge)}`, r);
  add(confidence, ms, r);
}

function finalize(g) {
  for (const v of Object.values(g)) {
    v.hitRate = v.sample ? +(v.wins / v.sample).toFixed(4) : null;
    v.avgProb = v.probCount ? +(v.probSum / v.probCount).toFixed(4) : null;
    v.avgEdge = v.edgeCount ? +(v.edgeSum / v.edgeCount).toFixed(4) : null;
    v.calibrationBias =
      v.avgProb !== null && v.hitRate !== null
        ? +(v.hitRate - v.avgProb).toFixed(4)
        : null;

    if (v.sample < 20) {
      v.trust = "LOW_SAMPLE";
      v.probMultiplier = 1;
      v.edgeMultiplier = 0.85;
      continue;
    }

    const actual = v.hitRate ?? 0.5;
    const expected = v.avgProb ?? 0.55;

    v.probMultiplier = +Math.max(0.65, Math.min(1.12, actual / Math.max(expected, 0.01))).toFixed(4);

    if (actual < 0.48) v.edgeMultiplier = 0.45;
    else if (actual < 0.52) v.edgeMultiplier = 0.70;
    else if (actual < 0.56) v.edgeMultiplier = 0.88;
    else if (actual > 0.62) v.edgeMultiplier = 1.08;
    else v.edgeMultiplier = 1.0;

    v.trust =
      actual < 0.48 ? "BAD" :
      actual < 0.52 ? "WEAK" :
      actual < 0.56 ? "WATCH" :
      actual > 0.62 ? "STRONG" :
      "OK";
  }
}

finalize(calibration);
finalize(shrinkage);
finalize(confidence);

const out = {
  createdAt: new Date().toISOString(),
  sourceRows: rows.length,
  calibration,
  shrinkage,
  confidence
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/phase6-calibration-shrinkage.json", JSON.stringify(out, null, 2));

console.log("PHASE 6 CALIBRATION / SHRINKAGE BUILT");
console.log("graded rows:", rows.length);
console.table(Object.values(confidence).slice(0, 20).map(x => ({
  key: x.key,
  sample: x.sample,
  hitRate: x.hitRate,
  avgProb: x.avgProb,
  bias: x.calibrationBias,
  trust: x.trust,
  edgeMultiplier: x.edgeMultiplier
})));
