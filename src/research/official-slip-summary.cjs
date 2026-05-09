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
  return String(l.market || l.stat || "unknown")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function directionKey(l) {
  return String(l.side || l.recommendedSide || l.pick || l.direction || "")
    .toUpperCase()
    .includes("LESS") ? "LESS" : "MORE";
}

function baseProb(l) {
  return clampProb(
    l.prob ??
    l.calibratedDistributionProb ??
    l.recommendedProb ??
    l.probability
  );
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
    return {
      applied: false,
      key: null,
      sample: 0,
      multiplier: 1,
      suppressed: false,
      bias: 0
    };
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
    return {
      ...l,
      learnedProb: null,
      learningAdjusted: false,
      learningSuppressed: false
    };
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
  return grade;
}

function printLeg(l, i) {
  const adj = l.learningAdjusted
    ? ` | learned=${n(l.learnedProb)} | learn=${l.learningAdjustment.key} bias=${n(l.learningAdjustment.bias)} sample=${l.learningAdjustment.sample}`
    : "";

  console.log(
    `${i + 1}. ${l.player} | ${l.team || ""} | ${l.market} ${l.side} ${l.line} | prob=${n(l.rawProb)}${adj} | edge=${n(l.edge)} | grade=${effectiveGrade(l)}`
  );
}

const learning = read("data/learning/market-learning.json", {
  byMarketDirectionBucket: {},
  byMarketDirection: {},
  byBucket: {}
});

const rows = read("outputs/final-slips-validated.json", []);

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

const greens = legs
  .filter(l => effectiveGrade(l) === "GREEN")
  .sort((a, b) => Number(b.learnedProb || 0) - Number(a.learnedProb || 0));

const neutrals = legs
  .filter(l => effectiveGrade(l) === "NEUTRAL")
  .sort((a, b) => Number(b.learnedProb || 0) - Number(a.learnedProb || 0));

const suppressed = legs
  .filter(l => effectiveGrade(l) === "SUPPRESSED")
  .sort((a, b) => Number(b.rawProb || 0) - Number(a.rawProb || 0));

console.log("OFFICIAL SLIP DECISION");
console.log("======================");
console.log(`LEARNING SOURCE: ${learning.sourceFile || "none"} | rows=${learning.usableRows || 0}`);
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
