const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = `outputs/history/${date}-prizepicks-board-graded.json`;
const OUT = `outputs/side-bias-report-${date}.json`;
const LATEST = "outputs/side-bias-report.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function pct(n) {
  return Number.isFinite(n) ? Number((n * 100).toFixed(1)) : null;
}

function marketOf(r) {
  return String(r.market || r.stat || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/^hr$/, "home_runs")
    .trim();
}

function sideOf(r) {
  return String(r.side || r.recommendedSide || r.direction || "").toUpperCase();
}

function summarize(rows) {
  const graded = rows.filter(r => r.result === "HIT" || r.result === "MISS" || r.result === "PUSH");
  const wins = graded.filter(r => r.result === "HIT").length;
  const losses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const decisions = wins + losses;
  const roiUnits = wins - losses;

  return {
    count: rows.length,
    graded: graded.length,
    wins,
    losses,
    pushes,
    hitRate: decisions ? Number((wins / decisions).toFixed(4)) : null,
    hitRatePct: decisions ? pct(wins / decisions) : null,
    roi: decisions ? Number((roiUnits / decisions).toFixed(4)) : null,
    roiPct: decisions ? pct(roiUnits / decisions) : null
  };
}

function actionFor({ market, side, sample, hitRate, roi }) {
  if (sample < 25 || hitRate == null || roi == null) return "INSUFFICIENT_SAMPLE";

  const hitterCounting = new Set([
    "hits",
    "bases",
    "hrr",
    "runs",
    "rbis",
    "rbi",
    "singles"
  ]);

  if (hitterCounting.has(market) && side === "MORE") {
    if (hitRate < 0.45 || roi < -0.10) return "HARDER_PROOF_REQUIRED";
    return "NEUTRAL";
  }

  if (hitterCounting.has(market) && side === "LESS") {
    if (hitRate >= 0.65 && roi > 0.10) return "LOWER_FRICTION_ALLOWED";
    return "NEUTRAL";
  }

  if (side === "LESS" && hitRate >= 0.62 && roi > 0.10) return "BOOST_LESS";
  if (side === "MORE" && hitRate < 0.48 && roi < -0.10) return "SUPPRESS_MORE";

  return "NEUTRAL";
}

const rows = read(INPUT, []);
const realRows = rows.filter(r => r.inferredSideForBoardGrade !== true);

const grouped = new Map();
for (const r of realRows) {
  const market = marketOf(r);
  const side = sideOf(r);
  if (!market || !side) continue;
  const k = `${market}|${side}`;
  if (!grouped.has(k)) grouped.set(k, []);
  grouped.get(k).push(r);
}

const marketSide = [...grouped.entries()]
  .map(([k, group]) => {
    const [market, side] = k.split("|");
    const s = summarize(group);
    return {
      market,
      side,
      ...s,
      action: actionFor({
        market,
        side,
        sample: s.graded,
        hitRate: s.hitRate,
        roi: s.roi
      })
    };
  })
  .sort((a, b) => {
    if (a.market !== b.market) return a.market.localeCompare(b.market);
    return a.side.localeCompare(b.side);
  });

const report = {
  date,
  generatedAt: new Date().toISOString(),
  input: INPUT,
  note: "Report-only side-bias intelligence. Do not auto-enforce without multi-day validation.",
  totalRows: rows.length,
  realSideRows: realRows.length,
  marketSide
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
fs.writeFileSync(LATEST, JSON.stringify(report, null, 2));

console.log("SIDE BIAS REPORT");
console.log("----------------");
console.log("date:", date);
console.log("input rows:", rows.length);
console.log("real-side rows:", realRows.length);
console.table(marketSide.map(x => ({
  market: x.market,
  side: x.side,
  graded: x.graded,
  hitRate: x.hitRatePct,
  roi: x.roiPct,
  action: x.action
})));
console.log("saved:", OUT);
console.log("saved:", LATEST);
