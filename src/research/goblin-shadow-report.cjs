const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pct(x) {
  return Number.isFinite(x) ? Number((x * 100).toFixed(2)) : null;
}

const board = readJson("outputs/priced-board.json", []);
const blockedMarkets = new Set([
  "hitter_fantasy_score",
  "pitcher_fantasy_score",
  "plate_appearances",
  "singles",
  "doubles",
  "triples",
  "stolen_bases",
  "pitcher_strikeouts_(combo)"
]);

const goblinPayout = 1.15;
const breakeven = 1 / goblinPayout;

const rows = board
  .filter(r => norm(r.oddsTier || r.tier || r.specialTier) === "goblin")
  .map(r => {
    const market = norm(r.market || r.stat);
    const rawSide = String(r.recommendedSide || r.side || "").toUpperCase();
    const side = (!rawSide || rawSide === "NO_SIDE") ? "MORE" : rawSide; // PrizePicks goblins are MORE-only for evaluation.
    const prob = num(r.calibratedDistributionProb ?? r.recommendedProb ?? r.probability ?? r.prob);
    const books = num(r.sportsbookBookCount ?? r.books);
    const edge = num(r.sportsbookAdjustedEdge ?? r.adjustedEdge ?? r.sportsbookEdge ?? r.edge);
    const modelEv = Number.isFinite(prob) ? Number((prob * goblinPayout - 1).toFixed(4)) : null;

    const reasons = [];
    if (side !== "MORE") reasons.push("not_more");
    if (blockedMarkets.has(market)) reasons.push("unsupported_market");
    if (!Number.isFinite(prob)) reasons.push("missing_probability");
    if (Number.isFinite(prob) && prob < breakeven) reasons.push("below_goblin_breakeven");
    if (Number.isFinite(prob) && prob < 0.72) reasons.push("below_shadow_prob_floor");
    if (!Number.isFinite(books) || books < 2) reasons.push("low_or_missing_books");
    if (market === "home_runs" || market === "hr") reasons.push("hr_variance_block");

    let action = "MONITOR_ONLY";
    if (reasons.includes("unsupported_market")) action = "SUPPRESS";
    else if (reasons.includes("not_more")) action = "NO_SIDE_FIX_NEEDED";
    else if (!reasons.length || (prob >= 0.72 && modelEv > 0 && (!Number.isFinite(books) || books >= 2))) {
      action = "SHADOW_CANDIDATE";
    }

    return {
      player: r.player,
      team: r.team,
      game: r.game,
      market,
      side,
      line: r.line,
      prob,
      probPct: pct(prob),
      goblinPayout,
      breakeven,
      breakevenPct: pct(breakeven),
      modelEv,
      books,
      edge,
      confidenceBucket: r.confidenceBucket ?? null,
      pricingStatus: r.pricingStatus ?? null,
      action,
      reasons
    };
  });

const summaryMap = new Map();
for (const r of rows) {
  const key = `${r.market}|${r.side}|${r.action}`;
  if (!summaryMap.has(key)) {
    summaryMap.set(key, {
      market: r.market,
      side: r.side,
      action: r.action,
      count: 0,
      avgProb: 0,
      avgModelEv: 0,
      withProb: 0
    });
  }
  const b = summaryMap.get(key);
  b.count++;
  if (Number.isFinite(r.prob)) {
    b.avgProb += r.prob;
    b.withProb++;
  }
  if (Number.isFinite(r.modelEv)) b.avgModelEv += r.modelEv;
}

const summary = [...summaryMap.values()]
  .map(x => ({
    ...x,
    avgProb: x.withProb ? Number((x.avgProb / x.withProb).toFixed(4)) : null,
    avgProbPct: x.withProb ? pct(x.avgProb / x.withProb) : null,
    avgModelEv: x.withProb ? Number((x.avgModelEv / x.withProb).toFixed(4)) : null
  }))
  .sort((a, b) => b.count - a.count);

const topCandidates = rows
  .filter(r => r.action === "SHADOW_CANDIDATE")
  .sort((a, b) => (b.modelEv ?? -999) - (a.modelEv ?? -999))
  .slice(0, 50);

const report = {
  generatedAt: new Date().toISOString(),
  mode: "SHADOW_ONLY_DO_NOT_BET",
  policy: {
    goblinLiveEnabled: false,
    reason: "Goblin candidates are monitored separately. Do not unlock until side-specific goblin hit rate and ROI are validated."
  },
  totalGoblinRows: rows.length,
  breakeven,
  breakevenPct: pct(breakeven),
  summary,
  topCandidates,
  rows
};

fs.writeFileSync("outputs/goblin-shadow-report.json", JSON.stringify(report, null, 2));

console.log("GOBLIN SHADOW REPORT");
console.log("====================");
console.log({
  totalGoblinRows: report.totalGoblinRows,
  breakeven: report.breakeven,
  breakevenPct: report.breakevenPct,
  shadowCandidates: topCandidates.length
});
console.table(summary.slice(0, 30));
console.log("Top candidates:");
console.table(topCandidates.slice(0, 20).map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  prob: r.prob,
  modelEv: r.modelEv,
  books: r.books,
  action: r.action,
  reasons: r.reasons.join(",")
})));
console.log("Wrote outputs/goblin-shadow-report.json");
