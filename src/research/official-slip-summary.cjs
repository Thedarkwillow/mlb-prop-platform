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
  return Number.isFinite(v) ? v.toFixed(4) : "n/a";
}

function clampProb(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return null;
  return Math.max(0.01, Math.min(0.99, x));
}

function probBucket(prob) {
  const p = clampProb(prob);
  if (p == null) return null;
  const low = Math.floor(p * 20) / 20;
  const high = low + 0.05;
  return `${low.toFixed(2)}-${high.toFixed(2)}`;
}

function marketKey(l) {
  return String(l.market || l.stat || "unknown").toLowerCase().replace(/\s+/g, "_").trim();
}

function directionKey(l) {
  return String(l.side || l.recommendedSide || l.pick || l.direction || "").toUpperCase().includes("LESS") ? "LESS" : "MORE";
}

function baseProb(l) {
  return clampProb(l.prob ?? l.calibratedDistributionProb ?? l.recommendedProb ?? l.probability);
}

function getLearningAdjustment(l, prob, learning) {
  const market = marketKey(l);
  const direction = directionKey(l);
  const bucket = probBucket(prob);
  const exactKey = `${market}_${direction}_${bucket}`;
  const mdKey = `${market}_${direction}`;

  const exact = learning.byMarketDirectionBucket?.[exactKey];
  const md = learning.byMarketDirection?.[mdKey];
  const bucketOnly = learning.byBucket?.[bucket];

  const chosen =
    exact && exact.sample >= 50 ? exact :
    md && md.sample >= 100 ? md :
    bucketOnly && bucketOnly.sample >= 150 ? bucketOnly :
    null;

  if (!chosen) {
    return { applied: false, key: null, sample: 0, multiplier: 1, suppressed: false, bias: 0 };
  }

  return {
    applied: true,
    key: chosen === exact ? exactKey : chosen === md ? mdKey : bucket,
    sample: Number(chosen.sample || 0),
    multiplier: Number(chosen.adjustmentMultiplier || 1),
    suppressed: Boolean(chosen.suppressed),
    bias: Number(chosen.bias || 0),
    actual: chosen.actual,
    predicted: chosen.predicted
  };
}

function applyLearning(l, learning) {
  const rawProb = baseProb(l);
  if (rawProb == null) {
    return { ...l, learnedProb: null, learningAdjusted: false, learningSuppressed: false };
  }

  const adj = getLearningAdjustment(l, rawProb, learning);
  const learnedProb = clampProb(rawProb * adj.multiplier);

  return {
    ...l,
    rawProb,
    learnedProb,
    learningAdjusted: adj.applied,
    learningSuppressed: adj.suppressed,
    learningAdjustment: adj
  };
}

function effectiveGrade(l) {
  const grade = l.validationGrade || l.grade;
  if (l.learningSuppressed) return "SUPPRESSED";
  return grade || "UNKNOWN";
}

function printLeg(l, i) {
  const adj = l.learningAdjusted
    ? ` | learned=${n(l.learnedProb)} | learn=${l.learningAdjustment.key} bias=${n(l.learningAdjustment.bias)} sample=${l.learningAdjustment.sample}`
    : "";

  console.log(
    `${i + 1}. ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | prob=${n(l.rawProb)}${adj} | edge=${n(l.edge)} | grade=${effectiveGrade(l)}`
  );
}

function printObject(title, obj) {
  console.log(title);
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    console.log("  none");
    return;
  }
  for (const [k, v] of entries) console.log(`  ${k}: ${v}`);
}

function gradeCounts(legs) {
  const out = {};
  for (const l of legs) {
    const g = effectiveGrade(l);
    out[g] = (out[g] || 0) + 1;
  }
  return out;
}

function marketCounts(legs) {
  const out = {};
  for (const l of legs) {
    const k = `${String(l.market || l.stat || "unknown").toLowerCase()}_${String(l.side || l.recommendedSide || "").toUpperCase() || "NA"}`;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function countByReason(legs) {
  const out = {};

  for (const l of legs) {
    const reasons = [];

    if (l.learningSuppressed) reasons.push("learning_suppressed");
    if (l.isFantasy || String(l.market || l.stat || "").toLowerCase().includes("fantasy")) reasons.push("fantasy_tracking_only");
    if ((l.validationGrade || l.grade) === "WATCHLIST") reasons.push("watchlist");
    if (String(l.disabledReason || "").trim()) reasons.push(String(l.disabledReason).trim());
    if (Number(l.books ?? l.sportsbookBookCount ?? 99) < 2) reasons.push("low_book_support");
    if (Number(l.edge ?? l.sportsbookEdge ?? 0) <= 0) reasons.push("non_positive_edge");
    if (l.clvFresh === false || l.stale === true) reasons.push("stale_or_bad_clv");

    if (!reasons.length) reasons.push("not_green");

    for (const r of reasons) out[r] = (out[r] || 0) + 1;
  }

  return out;
}

const learning = read("data/learning/market-learning.json", {
  byMarketDirectionBucket: {},
  byMarketDirection: {},
  byBucket: {}
});

const rows =
  read("outputs/playable-final-slips.json", null) ||
  read("outputs/final-slips-validated.json", []);
const rawLegs = rows
  .flatMap(x => Array.isArray(x.legs) ? x.legs : [x])
  .filter(l => l && l.player)
  .filter(l => (l.validationGrade || l.grade) !== "WATCHLIST")
  .map(l => applyLearning(l, learning));

const seen = new Set();
const legs = [];

for (const l of rawLegs) {
  const key = [l.player, l.team, l.market, l.side, l.line].join("|").toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  legs.push(l);
}


function playableSlipRows() {
  const data = read("outputs/playable-final-slips.json", []);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.slips)) return data.slips;
  return [];
}

function printPlayableSlips() {
  const slips = playableSlipRows();
  const playable = slips.filter(s =>
    String(s.status || "").toUpperCase() === "PLAYABLE" ||
    s.complete === true
  );

  console.log("");
  console.log("BEST PLAYABLE SLIP");
  console.log("------------------");

  if (!playable.length) {
    console.log("none");
    return;
  }

  function slipScore(s) {
    const legs = s.legs || [];
    const avg = legs.reduce((sum, l) => sum + rankValue(l), 0) / Math.max(1, legs.length);
    const green = Number(s.green ?? legs.filter(l => effectiveGrade(l) === "GREEN").length);
    const size = Number(s.size || legs.length || 0);
    const correlationPenalty = String(s.correlation || "OK") === "OK" ? 0 : 0.05;

    let sizePreference = 0;
    if (size === 3) sizePreference = 0.04;
    else if (size === 2) sizePreference = 0.015;
    else if (size === 4) sizePreference = -0.005;
    else if (size >= 5) sizePreference = -0.035;

    return avg + green * 0.01 + sizePreference - correlationPenalty;
  }

  const ranked = playable
    .slice()
    .map(s => ({ ...s, officialScore: slipScore(s) }))
    .sort((a, b) => b.officialScore - a.officialScore);

  const best = ranked[0];
  const bestLegs = best.legs || [];

  console.log(`${best.name || best.type || "SLIP"} | legs=${bestLegs.length} | green=${best.green ?? bestLegs.filter(l => effectiveGrade(l) === "GREEN").length} | correlation=${best.correlation || "OK"} | score=${n(best.officialScore)}`);
  for (const [i, l] of bestLegs.entries()) {
    console.log(`  ${i + 1}. ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | edge=${n(l.edge)} | grade=${effectiveGrade(l)} | books=${l.books ?? ""}`);
  }

  console.log("");
  console.log("ALL PLAYABLE SLIPS RANKED");
  console.log("-------------------------");

  for (const [idx, slip] of ranked.entries()) {
    const slipLegs = slip.legs || [];
    console.log(`${idx + 1}. ${slip.name || slip.type || "SLIP"} | legs=${slipLegs.length} | green=${slip.green ?? slipLegs.filter(l => effectiveGrade(l) === "GREEN").length} | correlation=${slip.correlation || "OK"} | score=${n(slip.officialScore)}`);
    for (const [i, l] of slipLegs.entries()) {
      console.log(`   ${i + 1}. ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | edge=${n(l.edge)} | grade=${effectiveGrade(l)} | books=${l.books ?? ""}`);
    }
  }
}

function rankValue(l) {
  return Number(
    l.finalScore ??
    l.score ??
    l.calibratedDistributionProb ??
    l.learnedProb ??
    l.adjustedEdge ??
    l.edge ??
    l.sportsbookAdjustedEdge ??
    l.sportsbookEdge ??
    l.rawProb ??
    0
  );
}

function rankSort(a, b) {
  return rankValue(b) - rankValue(a);
}

const greens = legs.filter(l => effectiveGrade(l) === "GREEN").sort(rankSort);
const neutrals = legs.filter(l => effectiveGrade(l) === "NEUTRAL").sort(rankSort);
const suppressed = legs.filter(l => effectiveGrade(l) === "SUPPRESSED").sort(rankSort);

console.log("OFFICIAL SLIP DECISION");
console.log("======================");
console.log(`LEARNING SOURCE: ${learning.sourceFile || "none"} | rows=${learning.usableRows || 0}`);
console.log("");

console.log("AUDIT");
console.log("-----");
console.log(`Total legs considered: ${legs.length}`);
console.log(`GREEN: ${greens.length}`);
console.log(`NEUTRAL: ${neutrals.length}`);
console.log(`SUPPRESSED: ${suppressed.length}`);
printObject("Grade counts:", gradeCounts(legs));
printObject("Market counts:", marketCounts(legs));
printObject("Non-playable reason counts:", countByReason(legs.filter(l => effectiveGrade(l) !== "GREEN")));
console.log("");

if (greens.length >= 2) {
  console.log("STATUS: PLAYABLE");
  console.log("REASON: 2+ GREEN legs available after learning suppression");
  greens.slice(0, 2).forEach(printLeg);
} else {
  console.log("STATUS: PASS");
  console.log(`REASON: only ${greens.length} GREEN legs available after learning suppression`);
  console.log("");
  console.log("BEST NEUTRAL WATCHLIST");
  neutrals.slice(0, 5).forEach(printLeg);

  if (suppressed.length) {
    console.log("");
    console.log("SUPPRESSED BY LEARNING");
    suppressed.slice(0, 5).forEach(printLeg);
  }
}

const strikeoutWatchlist = read("outputs/strikeout-watchlist.json", []);
if (Array.isArray(strikeoutWatchlist) && strikeoutWatchlist.length) {
  console.log("");
  console.log("STRIKEOUT WATCHLIST");
  console.log("-------------------");
  strikeoutWatchlist.slice(0, 5).forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.player} | ${r.team || ""} | ${r.market} ${r.side || r.recommendedSide} ${r.line} | prob=${n(r.recommendedProb)} | EV=${n(r.expectedValue)} | conf=${r.confidenceBucket || "n/a"}`
    );
  });
}


printPlayableSlips();

const officialRows = playableSlipRows()
  .filter(s => String(s.status || "").toUpperCase() === "PLAYABLE" || s.complete === true)
  .map(s => {
    const legs = s.legs || [];
    const avg = legs.reduce((sum, l) => sum + rankValue(l), 0) / Math.max(1, legs.length);
    const green = Number(s.green ?? legs.filter(l => effectiveGrade(l) === "GREEN").length);
    const size = Number(s.size || legs.length || 0);
    const correlationPenalty = String(s.correlation || "OK") === "OK" ? 0 : 0.05;
    const sizePreference = size === 3 ? 0.12 : size === 2 ? 0.07 : size === 4 ? -0.015 : size >= 5 ? -0.035 : 0;
    const officialScore = avg + green * 0.01 + sizePreference - correlationPenalty;
    return { ...s, officialScore };
  })
  .sort((a, b) => b.officialScore - a.officialScore);
fs.writeFileSync("outputs/official-slip.json", JSON.stringify(officialRows, null, 2) + "\n");

const lines = [];
lines.push("OFFICIAL PLAYABLE SLIPS");
lines.push("=======================");
for (const slip of officialRows) {
  lines.push("");
  lines.push(`${slip.name || "SLIP"} | status=${slip.status || ""} | green=${slip.green ?? ""} | correlation=${slip.correlation || "OK"}`);
  for (const [i, l] of (slip.legs || []).entries()) {
    lines.push(`${i + 1}. ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | edge=${n(l.edge)} | grade=${effectiveGrade(l)} | books=${l.books ?? ""}`);
  }
}
fs.writeFileSync("outputs/official-slip.txt", lines.join("\n") + "\n");
console.log("");
console.log("Wrote outputs/official-slip.json");
console.log("Wrote outputs/official-slip.txt");

const today = new Date().toISOString().slice(0, 10);

if (!fs.existsSync("outputs/history")) {
  fs.mkdirSync("outputs/history", { recursive: true });
}

fs.writeFileSync(
  `outputs/history/${today}-official-slip.json`,
  JSON.stringify(officialRows, null, 2) + "\n"
);

fs.writeFileSync(
  `outputs/history/${today}-official-slip.txt`,
  lines.join("\n") + "\n"
);

console.log(`Wrote outputs/history/${today}-official-slip.json`);
console.log(`Wrote outputs/history/${today}-official-slip.txt`);
