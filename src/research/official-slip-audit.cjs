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

function riskNotes(l) {
  const books = Number(booksOf(l));
  const edge = Number(edgeOf(l));
  const prob = Number(probOf(l));
  const matchType = matchTypeOf(l);
  const market = String(l.market || "").toLowerCase();

  const notes = [];

  if (books < 2) notes.push("low book support");
  if (matchType === "NEAREST_LINE") notes.push("nearest-line price");
  if (market === "hrr") notes.push("volatile HRR market");
  if (market.includes("home")) notes.push("volatile HR market");
  if (Number.isFinite(edge) && edge < 0.05) notes.push("thin edge");
  if (Number.isFinite(prob) && prob < 0.55) notes.push("low model probability");
  if (String(l.side || l.recommendedSide || "").toUpperCase() === "LESS") notes.push("LESS leg");

  return notes;
}

function riskLabel(l) {
  const notes = riskNotes(l);
  return notes.length ? notes.join("; ") : "clean";
}

function slipRisk(slip) {
  const legs = slip.legs || [];
  const allNotes = legs.flatMap(riskNotes);
  const avgEdge = avg(legs, edgeOf);
  const minBooks = Math.min(...legs.map(x => Number(booksOf(x) || 0)));

  if (legs.length <= 2 && minBooks >= 2 && avgEdge >= 0.15 && allNotes.length <= 1) {
    return "LOW";
  }

  if (legs.length <= 3 && minBooks >= 2 && avgEdge >= 0.08) {
    return "MEDIUM";
  }

  return "HIGH";
}

function bankrollLabel(slip) {
  const risk = slipRisk(slip);
  const legs = slip.legs || [];
  const avgEdge = avg(legs, edgeOf);

  if (risk === "LOW" && avgEdge >= 0.15) return "STANDARD PLAY";
  if (risk === "MEDIUM") return "SMALL PLAY";
  return "WATCHLIST / TINY ONLY";
}

function avg(legs, fn) {
  return legs.reduce((sum, l) => sum + Number(fn(l) || 0), 0) / Math.max(1, legs.length);
}

function slipScore(slip) {
  const legs = slip.legs || [];
  const avgEdge = avg(legs, edgeOf);
  const avgProb = avg(legs, probOf);
  const green = legs.filter(l => String(gradeOf(l)).toUpperCase() === "GREEN").length;
  const riskPenalty = slipRisk(slip) === "LOW" ? 0 : slipRisk(slip) === "MEDIUM" ? 0.035 : 0.075;
  return avgEdge + avgProb * 0.25 + green * 0.01 - riskPenalty;
}

function whyLegIncluded(l) {
  const reasons = [];
  const grade = String(gradeOf(l)).toUpperCase();
  const edge = Number(edgeOf(l));
  const prob = Number(probOf(l));
  const books = Number(booksOf(l));

  if (grade === "GREEN") reasons.push("GREEN validation grade");
  if (books >= 2) reasons.push(`${books}-book support`);
  if (Number.isFinite(edge) && edge >= 0.10) reasons.push("strong sportsbook edge");
  if (Number.isFinite(prob) && prob >= 0.65) reasons.push("strong model probability");
  if (Number.isFinite(prob) && prob < 0.55 && Number.isFinite(edge) && edge >= 0.10) {
    reasons.push("market-edge driven despite lower model probability");
  }
  if (String(l.savantReportGrade || l.savant || "").toUpperCase().includes("BOOST")) {
    reasons.push("Savant boost");
  }

  return reasons.length ? reasons.join("; ") : "included by optimizer score";
}

function whySlipRanked(best, slip, index) {
  if (index === 0) return "best blend of edge, probability, green count, and risk";

  const bestLegs = best.legs || [];
  const legs = slip.legs || [];

  const reasons = [];
  if (legs.length > bestLegs.length) reasons.push("more legs increases payout variance");
  if (avg(legs, edgeOf) < avg(bestLegs, edgeOf)) reasons.push("lower average edge");
  if (slipRisk(slip) !== "LOW") reasons.push(`${slipRisk(slip).toLowerCase()} risk profile`);
  if (!reasons.length) reasons.push("lower audit score");

  return reasons.join("; ");
}

const official = read("outputs/official-slip.json", []);
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
  .map(s => ({ ...s, auditScore: slipScore(s), auditRisk: slipRisk(s), bankroll: bankrollLabel(s) }))
  .sort((a, b) => b.auditScore - a.auditScore);

const best = ranked[0];

console.log("STATUS: PLAYABLE");
console.log(`Best slip: ${best.name || best.type || "SLIP"}`);
console.log(`Legs: ${(best.legs || []).length}`);
console.log(`Audit score: ${n(best.auditScore)}`);
console.log(`Risk: ${best.auditRisk}`);
console.log(`Bankroll label: ${best.bankroll}`);
console.log(`Why this slip: ${whySlipRanked(best, best, 0)}`);
console.log("");

console.log("BEST SLIP LEGS");
console.log("--------------");

for (const [i, l] of (best.legs || []).entries()) {
  console.log(`${i + 1}. ${l.player} | ${l.team || ""} | ${l.game || l.resolvedGame || ""}`);
  console.log(`   Pick: ${l.market} ${l.side || l.recommendedSide} ${l.line}`);
  console.log(`   Grade: ${gradeOf(l)} | Prob: ${n(probOf(l))} | Edge: ${n(edgeOf(l))} | Books: ${booksOf(l)}`);
  console.log(`   Match: ${matchTypeOf(l)} | Book line: ${l.sportsbookMatchedLine ?? "n/a"} | Risk: ${riskLabel(l)}`);
  console.log(`   Why included: ${whyLegIncluded(l)}`);
  if (l.staleInputGame) console.log(`   Fixed stale game: ${l.staleInputGame} -> ${l.game}`);
}

console.log("");
console.log("ALL OFFICIAL SLIPS");
console.log("------------------");

for (const [i, slip] of ranked.entries()) {
  const legs = slip.legs || [];
  const green = legs.filter(l => String(gradeOf(l)).toUpperCase() === "GREEN").length;
  const avgEdge = avg(legs, edgeOf);

  console.log(
    `${i + 1}. ${slip.name || "SLIP"} | legs=${legs.length} | green=${green} | avgEdge=${n(avgEdge)} | risk=${slip.auditRisk} | bankroll=${slip.bankroll} | score=${n(slip.auditScore)}`
  );
  console.log(`   Why ranked here: ${whySlipRanked(best, slip, i)}`);
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
