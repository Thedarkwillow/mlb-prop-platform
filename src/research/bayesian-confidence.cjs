const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normMarket(s) {
  s = String(s || "").toLowerCase().replace(/[_\s]+/g, " ").trim();
  if (s === "total bases" || s === "bases") return "bases";
  if (s === "hits+runs+rbis" || s === "hrr") return "hrr";
  if (s === "pitcher strikeouts") return "strikeouts";
  if (s === "earned runs allowed") return "earned_runs_allowed";
  if (s === "hits allowed") return "hits_allowed";
  if (s === "home runs" || s === "hr") return "home_runs";
  if (s === "rbis") return "rbis";
  if (s === "runs") return "runs";
  if (s === "hits") return "hits";
  if (s === "pitching outs") return "pitching_outs";
  return s.replace(/\s+/g, "_");
}

function sideOf(x) {
  return String(x.side || x.recommendedSide || "").toUpperCase();
}

function key(x) {
  return `${normMarket(x.market || x.stat)}_${sideOf(x)}`;
}

function legKey(x) {
  return [
    String(x.player || "").toLowerCase().trim(),
    normMarket(x.market || x.stat),
    sideOf(x),
    String(Number(x.line))
  ].join("|");
}

function probOf(x) {
  const v = Number(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
  return Number.isFinite(v) ? v : null;
}

function edgeOf(x) {
  const v = Number(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? x.edge);
  return Number.isFinite(v) ? v : 0;
}

function gradeOf(x) {
  return String(x.qualityGrade || x.validationGrade || x.grade || "UNKNOWN").toUpperCase();
}

function ensembleAgreement(x) {
  const grade = gradeOf(x);
  const prob = probOf(x);
  const edge = edgeOf(x);
  const sav = String(x.savantReportGrade || x.savantGradeReport || x.savantGrade || "").toUpperCase();

  const modelStrong = prob != null && prob >= 0.60;
  const modelPlayable = prob != null && prob >= 0.52;
  const marketStrong = edge >= 0.05;
  const marketPlayable = edge > 0;
  const savantNegative = sav.includes("DOWNGRADE");

  if (grade === "GREEN" && modelStrong && marketStrong && !savantNegative) return "MODEL_AGREEMENT";
  if (grade === "GREEN" && marketStrong && !modelPlayable) return "MARKET_ONLY";
  if (modelStrong && !marketPlayable) return "MODEL_ONLY";
  if (modelPlayable && marketPlayable && savantNegative) return "DISAGREEMENT";
  if (grade === "GREEN" || marketPlayable || modelPlayable) return "LOW_CONFIDENCE";
  return "PASS";
}

function steamAdj(label) {
  if (label === "STEAM_WITH_US") return 0.025;
  if (label === "STEAM_AGAINST_US") return -0.035;
  if (label === "REVERSE_MOVEMENT") return -0.025;
  return 0;
}

function ensembleAdj(label) {
  if (label === "MODEL_AGREEMENT") return 0.025;
  if (label === "DISAGREEMENT") return -0.04;
  if (label === "MODEL_ONLY") return -0.035;
  if (label === "MARKET_ONLY") return -0.015;
  if (label === "LOW_CONFIDENCE") return -0.01;
  return -0.02;
}

function confidenceLabel(p) {
  if (p >= 0.68) return "ELITE_DYNAMIC";
  if (p >= 0.61) return "STRONG_DYNAMIC";
  if (p >= 0.55) return "PLAYABLE_DYNAMIC";
  if (p >= 0.50) return "WATCH_DYNAMIC";
  return "PASS_DYNAMIC";
}

function clamp(x) {
  return Math.max(0.01, Math.min(0.99, x));
}

const official = read("outputs/playable-final-slips.json", []);
const steamRows = read(`outputs/steam-report-${DATE}.json`, []);
const trust = read("data/learning/market-trust.json", { byMarketDirection: {} });

const steamByKey = new Map(steamRows.map(x => [legKey(x), x]));
const unique = new Map();

for (const leg of official.flatMap(s => s.legs || [])) {
  unique.set(legKey(leg), leg);
}

const rows = [];

for (const leg of unique.values()) {
  const modelProb = probOf(leg) ?? 0.5;
  const market = trust.byMarketDirection?.[key(leg)] || null;
  const sample = Number(market?.sample || 0);
  const actual = Number(market?.actual);
  const priorWeight = Math.min(sample, 200);
  const modelWeight = 80;

  const marketPrior = Number.isFinite(actual) && sample >= 20 ? actual : 0.5;
  const bayesBase = ((modelProb * modelWeight) + (marketPrior * priorWeight)) / (modelWeight + priorWeight);

  const steam = steamByKey.get(legKey(leg));
  const steamLabel = steam?.label || "UNKNOWN";
  const ensemble = ensembleAgreement(leg);
  const edge = edgeOf(leg);

  let dynamicProb = bayesBase;
  dynamicProb += steamAdj(steamLabel);
  dynamicProb += ensembleAdj(ensemble);
  dynamicProb += Math.max(-0.02, Math.min(0.035, edge * 0.08));

  dynamicProb = clamp(dynamicProb);

  rows.push({
    player: leg.player,
    team: leg.team,
    market: normMarket(leg.market || leg.stat),
    side: sideOf(leg),
    line: leg.line,
    modelProb: Number(modelProb.toFixed(4)),
    marketSample: sample,
    marketActual: Number.isFinite(actual) ? Number(actual.toFixed(4)) : null,
    bayesBase: Number(bayesBase.toFixed(4)),
    steam: steamLabel,
    ensemble,
    edge: Number(edge.toFixed(4)),
    dynamicProb: Number(dynamicProb.toFixed(4)),
    dynamicConfidence: confidenceLabel(dynamicProb)
  });
}

rows.sort((a, b) => b.dynamicProb - a.dynamicProb);

fs.writeFileSync(`outputs/bayesian-confidence-${DATE}.json`, JSON.stringify(rows, null, 2) + "\n");

console.log(`BAYESIAN CONFIDENCE REPORT ${DATE}`);
console.log("============================");
console.log(`Legs: ${rows.length}`);
console.table(rows);
console.log(`Wrote outputs/bayesian-confidence-${DATE}.json`);
