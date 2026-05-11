const fs = require("fs");

const OUT = "data/learning/rolling-roi-validation.json";

const INPUTS = [
  "outputs/all-markets-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  "outputs/slips-graded.json",
  "outputs/final-slips-graded.json",
  "outputs/official-slip-graded-2026-05-11.json",
  "outputs/playable-final-slips-graded-2026-05-11.json",
  "outputs/history/2026-05-04-all-markets-graded.json",
  "outputs/history/2026-05-04-hrr-graded.json",
  "outputs/history/2026-05-09-fantasy-grades.json",
  "outputs/history/2026-05-10-fantasy-grades.json"
];

function read(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function flatten(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap(flatten);
  if (Array.isArray(x.legs)) return x.legs.flatMap(flatten);
  if (Array.isArray(x.slips)) return x.slips.flatMap(flatten);
  if (Array.isArray(x.rows)) return x.rows.flatMap(flatten);
  if (Array.isArray(x.results)) return x.results.flatMap(flatten);
  return [x];
}

function normMarket(x) {
  return String(x.market || x.stat || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function normSide(x) {
  return String(x.side || x.recommendedSide || x.pick || x.direction || "")
    .toUpperCase()
    .includes("LESS") ? "LESS" : "MORE";
}

function confidence(x) {
  return String(x.confidenceBucket || x.confidence || x.dynamicConfidence || "unknown")
    .toLowerCase()
    .trim();
}

function prob(x) {
  const v = Number(x.recommendedProb ?? x.probability ?? x.prob ?? x.calibratedDistributionProb);
  return Number.isFinite(v) ? Math.max(0.01, Math.min(0.99, v)) : null;
}

function edge(x) {
  const v = Number(x.expectedValue ?? x.edge ?? x.sportsbookEdge ?? x.adjustedEdge ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function edgeBucket(v) {
  if (v >= 1.00) return "1.00+";
  if (v >= 0.50) return "0.50-1.00";
  if (v >= 0.25) return "0.25-0.50";
  if (v >= 0.10) return "0.10-0.25";
  if (v >= 0.00) return "0.00-0.10";
  return "negative";
}

function result(x) {
  const r = String(x.result || x.outcome || x.gradeResult || x.status || "").toUpperCase();
  if (["WIN", "HIT", "WON"].includes(r)) return "WIN";
  if (["LOSS", "MISS", "LOST"].includes(r)) return "LOSS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";
  return null;
}

function dateOf(x, source) {
  const raw =
    x.date ||
    x.slateDate ||
    x.gameDate ||
    x.gradedDate ||
    x.createdAt ||
    x.updatedAt ||
    "";

  const fromRaw = String(raw).match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (fromRaw) return fromRaw;

  const fromSource = String(source).match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (fromSource) return fromSource;

  return "unknown";
}

function parseDate(d) {
  if (!d || d === "unknown") return null;
  const t = Date.parse(d + "T00:00:00Z");
  return Number.isFinite(t) ? t : null;
}

function init() {
  return {
    sample: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    stake: 0,
    profit: 0,
    predictedSum: 0,
    edgeSum: 0
  };
}

function add(map, key, row) {
  if (!map[key]) map[key] = init();

  const r = row._result;
  const p = row._prob;
  const e = row._edge;

  map[key].sample++;
  map[key].wins += r === "WIN" ? 1 : 0;
  map[key].losses += r === "LOSS" ? 1 : 0;
  map[key].pushes += r === "PUSH" ? 1 : 0;
  map[key].stake += r === "PUSH" ? 0 : 1;
  map[key].profit += r === "WIN" ? 1 : r === "LOSS" ? -1 : 0;
  map[key].predictedSum += p ?? 0;
  map[key].edgeSum += e ?? 0;
}

function finish(v) {
  const decisions = v.wins + v.losses;
  const hitRate = decisions ? v.wins / decisions : null;
  const roi = v.stake ? v.profit / v.stake : null;
  const avgPredicted = v.sample ? v.predictedSum / v.sample : null;
  const avgEdge = v.sample ? v.edgeSum / v.sample : null;

  return {
    sample: v.sample,
    decisions,
    wins: v.wins,
    losses: v.losses,
    pushes: v.pushes,
    hitRate: hitRate == null ? null : Number(hitRate.toFixed(4)),
    roi: roi == null ? null : Number(roi.toFixed(4)),
    profit: Number(v.profit.toFixed(2)),
    avgPredicted: avgPredicted == null ? null : Number(avgPredicted.toFixed(4)),
    avgEdge: avgEdge == null ? null : Number(avgEdge.toFixed(4))
  };
}

function finishMap(map) {
  return Object.fromEntries(
    Object.entries(map)
      .map(([k, v]) => [k, finish(v)])
      .sort((a, b) => b[1].sample - a[1].sample)
  );
}

function buildWindow(rows, label, days = null) {
  let selected = rows;

  if (days != null) {
    const dates = rows.map(r => r._dateMs).filter(Boolean);
    const max = dates.length ? Math.max(...dates) : null;
    const cutoff = max == null ? null : max - days * 86400000;
    selected = cutoff == null ? [] : rows.filter(r => r._dateMs != null && r._dateMs >= cutoff);
  }

  const byMarket = {};
  const byMarketDirection = {};
  const byConfidence = {};
  const byEdgeBucket = {};
  const byMarketConfidence = {};
  const byMarketEdge = {};

  for (const row of selected) {
    const m = normMarket(row);
    const s = normSide(row);
    const c = confidence(row);
    const eb = edgeBucket(row._edge);

    add(byMarket, m, row);
    add(byMarketDirection, `${m}_${s}`, row);
    add(byConfidence, c, row);
    add(byEdgeBucket, eb, row);
    add(byMarketConfidence, `${m}_${c}`, row);
    add(byMarketEdge, `${m}_${eb}`, row);
  }

  return {
    label,
    days,
    rows: selected.length,
    byMarket: finishMap(byMarket),
    byMarketDirection: finishMap(byMarketDirection),
    byConfidence: finishMap(byConfidence),
    byEdgeBucket: finishMap(byEdgeBucket),
    byMarketConfidence: finishMap(byMarketConfidence),
    byMarketEdge: finishMap(byMarketEdge)
  };
}

const rows = [];

for (const file of INPUTS) {
  const data = read(file);
  if (!data) continue;

  for (const row of flatten(data)) {
    const r = result(row);
    if (!r) continue;

    const d = dateOf(row, file);
    rows.push({
      ...row,
      _sourceFile: file,
      _result: r,
      _prob: prob(row),
      _edge: edge(row),
      _date: d,
      _dateMs: parseDate(d)
    });
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: INPUTS.filter(fs.existsSync),
  usableRows: rows.length,
  dateRange: {
    min: rows.map(r => r._date).filter(d => d !== "unknown").sort()[0] || null,
    max: rows.map(r => r._date).filter(d => d !== "unknown").sort().slice(-1)[0] || null
  },
  windows: {
    all: buildWindow(rows, "all", null),
    last7: buildWindow(rows, "last7", 7),
    last14: buildWindow(rows, "last14", 14),
    last30: buildWindow(rows, "last30", 30)
  }
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("ROLLING ROI VALIDATION");
console.log("======================");
console.log(`Usable rows: ${rows.length}`);
console.log(`Date range: ${out.dateRange.min} -> ${out.dateRange.max}`);
console.log(`Wrote ${OUT}`);

for (const [name, win] of Object.entries(out.windows)) {
  console.log(`\nWindow: ${name} | rows=${win.rows}`);
  console.log("By market:");
  console.table(Object.entries(win.byMarket).slice(0, 12).map(([key, v]) => ({ key, ...v })));
  console.log("By confidence:");
  console.table(Object.entries(win.byConfidence).slice(0, 12).map(([key, v]) => ({ key, ...v })));
}
