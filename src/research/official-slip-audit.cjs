const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function n(x, d = 4) {
  const v = Number(x);
  return Number.isFinite(v) ? v.toFixed(d) : "n/a";
}

function gradeOf(l) {
  return l.qualityGrade || l.validationGrade || l.grade || "UNKNOWN";
}

function probOf(l) {
  return l.calibratedDistributionProb ?? l.recommendedProb ?? l.probability ?? l.prob ?? null;
}

function edgeOf(l) {
  return l.sportsbookEdge ?? l.edge ?? l.adjustedEdge ?? null;
}

function booksOf(l) {
  return l.sportsbookBookCount ?? l.books ?? 0;
}

function matchTypeOf(l) {
  return l.sportsbookMatchType || (l.sportsbookExactLine ? "EXACT_LINE" : "UNKNOWN");
}

function riskLabel(l) {
  const books = Number(booksOf(l));
  const edge = Number(edgeOf(l));
  const matchType = matchTypeOf(l);
  const market = String(l.market || "").toLowerCase();

  const notes = [];

  if (books < 2) notes.push("low book support");
  if (matchType === "NEAREST_LINE") notes.push("nearest-line price");
  if (market === "hrr") notes.push("volatile HRR market");
  if (market.includes("home")) notes.push("volatile HR market");
  if (Number.isFinite(edge) && edge < 0.05) notes.push("thin edge");

  if (!notes.length) return "clean";
  return notes.join("; ");
}

function slipScore(slip) {
  const legs = slip.legs || [];
  const avgEdge = legs.reduce((sum, l) => sum + Number(edgeOf(l) || 0), 0) / Math.max(1, legs.length);
  const avgProb = legs.reduce((sum, l) => sum + Number(probOf(l) || 0), 0) / Math.max(1, legs.length);
  const green = legs.filter(l => String(gradeOf(l)).toUpperCase() === "GREEN").length;
  return avgEdge + avgProb * 0.25 + green * 0.01;
}

const official = read("outputs/official-slip.json", []);
const playable = read("outputs/playable-final-slips.json", []);
const priced = read("outputs/slips-priced.json", []);

console.log("OFFICIAL SLIP AUDIT");
console.log("===================");

if (!official.length) {
  console.log("STATUS: PASS");
  console.log("Reason: no official playable slips found.");
  process.exit(0);
}

const ranked = official
  .slice()
  .map(s => ({ ...s, auditScore: slipScore(s) }))
  .sort((a, b) => b.auditScore - a.auditScore);

const best = ranked[0];

console.log(`STATUS: PLAYABLE`);
console.log(`Best slip: ${best.name || best.type || "SLIP"}`);
console.log(`Legs: ${(best.legs || []).length}`);
console.log(`Audit score: ${n(best.auditScore)}`);
console.log("");

console.log("BEST SLIP LEGS");
console.log("--------------");

for (const [i, l] of (best.legs || []).entries()) {
  console.log(`${i + 1}. ${l.player} | ${l.team || ""} | ${l.game || l.resolvedGame || ""}`);
  console.log(`   Pick: ${l.market} ${l.side || l.recommendedSide} ${l.line}`);
  console.log(`   Grade: ${gradeOf(l)} | Prob: ${n(probOf(l))} | Edge: ${n(edgeOf(l))} | Books: ${booksOf(l)}`);
  console.log(`   Match: ${matchTypeOf(l)} | Book line: ${l.sportsbookMatchedLine ?? "n/a"} | Risk: ${riskLabel(l)}`);
  if (l.staleInputGame) console.log(`   Fixed stale game: ${l.staleInputGame} -> ${l.game}`);
}

console.log("");
console.log("ALL OFFICIAL SLIPS");
console.log("------------------");

for (const [i, slip] of ranked.entries()) {
  const legs = slip.legs || [];
  const green = legs.filter(l => String(gradeOf(l)).toUpperCase() === "GREEN").length;
  const avgEdge = legs.reduce((sum, l) => sum + Number(edgeOf(l) || 0), 0) / Math.max(1, legs.length);
  console.log(`${i + 1}. ${slip.name || "SLIP"} | legs=${legs.length} | green=${green} | avgEdge=${n(avgEdge)} | score=${n(slip.auditScore)}`);
}

console.log("");
console.log("PRICING COVERAGE");
console.log("----------------");
console.log(`Priced legs: ${priced.length}`);
console.log(`Matched: ${priced.filter(x => x.sportsbookMatch).length}`);
console.log(`Unmatched: ${priced.filter(x => !x.sportsbookMatch).length}`);
console.log(`GREEN: ${priced.filter(x => String(gradeOf(x)).toUpperCase() === "GREEN").length}`);
console.log(`NEUTRAL: ${priced.filter(x => String(gradeOf(x)).toUpperCase() === "NEUTRAL").length}`);
console.log(`FADE: ${priced.filter(x => String(gradeOf(x)).toUpperCase() === "FADE").length}`);
