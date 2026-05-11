const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function gradeOf(x) {
  return String(x.qualityGrade || x.validationGrade || x.grade || "UNKNOWN").toUpperCase();
}

function modelProb(x) {
  return n(x.calibratedDistributionProb ?? x.recommendedProb ?? x.probability ?? x.prob);
}

function sportsbookEdge(x) {
  return n(x.sportsbookAdjustedEdge ?? x.sportsbookEdge ?? x.edge);
}

function savantSignal(x) {
  const g = String(x.savantReportGrade || x.savantGradeReport || x.savantGrade || "").toUpperCase();
  if (g.includes("BOOST") || g.includes("UPGRADE")) return "POSITIVE";
  if (g.includes("DOWNGRADE")) return "NEGATIVE";
  return "NEUTRAL";
}

function confidenceBand(p) {
  if (p == null) return "UNKNOWN";
  if (p >= 0.70) return "HIGH";
  if (p >= 0.60) return "MEDIUM";
  if (p >= 0.52) return "LOW";
  return "WEAK";
}

function agreementLabel(x) {
  const p = modelProb(x);
  const edge = sportsbookEdge(x);
  const grade = gradeOf(x);
  const savant = savantSignal(x);

  const modelStrong = p != null && p >= 0.60;
  const modelPlayable = p != null && p >= 0.52;
  const marketStrong = edge != null && edge >= 0.05;
  const marketPlayable = edge != null && edge > 0;
  const green = grade === "GREEN";

  if (green && modelStrong && marketStrong && savant !== "NEGATIVE") return "MODEL_AGREEMENT";
  if (green && marketStrong && !modelPlayable) return "MARKET_ONLY";
  if (modelStrong && !marketPlayable) return "MODEL_ONLY";
  if (modelPlayable && marketPlayable && savant === "NEGATIVE") return "DISAGREEMENT";
  if (green || marketPlayable || modelPlayable) return "LOW_CONFIDENCE";
  return "PASS";
}

function score(x) {
  const p = modelProb(x) ?? 0;
  const edge = sportsbookEdge(x) ?? 0;
  const gradeBonus = gradeOf(x) === "GREEN" ? 0.03 : gradeOf(x) === "NEUTRAL" ? 0.01 : -0.05;
  const sav = savantSignal(x);
  const savBonus = sav === "POSITIVE" ? 0.015 : sav === "NEGATIVE" ? -0.025 : 0;
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);
  const bookBonus = books >= 3 ? 0.02 : books === 2 ? 0.01 : -0.02;
  return Number((edge + p * 0.25 + gradeBonus + savBonus + bookBonus).toFixed(4));
}

const priced = read("outputs/slips-priced.json", []);
const rows = priced.map(x => ({
  player: x.player,
  team: x.team,
  game: x.game || x.resolvedGame,
  market: x.market || x.stat,
  side: x.side || x.recommendedSide,
  line: x.line,
  grade: gradeOf(x),
  modelProb: modelProb(x),
  sportsbookEdge: sportsbookEdge(x),
  books: x.sportsbookBookCount ?? x.books ?? 0,
  sportsbookMatch: !!x.sportsbookMatch,
  savant: savantSignal(x),
  agreement: agreementLabel(x),
  ensembleScore: score(x)
})).sort((a, b) => b.ensembleScore - a.ensembleScore);

const counts = {};
for (const r of rows) counts[r.agreement] = (counts[r.agreement] || 0) + 1;

fs.writeFileSync("outputs/ensemble-diagnostics.json", JSON.stringify(rows, null, 2) + "\n");

console.log("ENSEMBLE DIAGNOSTICS");
console.log("====================");
console.log(`Rows: ${rows.length}`);
console.log("Agreement counts:");
console.table(counts);
console.log("Top ensemble legs:");
console.table(rows.slice(0, 25).map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  grade: x.grade,
  prob: x.modelProb,
  edge: x.sportsbookEdge,
  books: x.books,
  savant: x.savant,
  agreement: x.agreement,
  score: x.ensembleScore
})));
console.log("Wrote outputs/ensemble-diagnostics.json");
