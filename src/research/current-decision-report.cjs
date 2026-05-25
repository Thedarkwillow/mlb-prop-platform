const fs = require("fs");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(2)}%` : "n/a";
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function key(row) {
  return [
    row.player || "",
    row.market || "",
    row.side || "",
    String(row.line ?? "")
  ].join("|");
}

function compactPick(row) {
  return `${row.market || "?"} ${row.side || "?"} ${row.line ?? "?"}`;
}

function getSideBias(row) {
  if (row.fullBoardSideBias || row.sideBias) return row.fullBoardSideBias || row.sideBias || {};

  const market = String(row.market || "").trim();
  const side = String(row.side || "").trim().toUpperCase();
  const bucket = `${market} ${side}`;
  const rec = fullBoardByMarketSide[bucket];

  if (!rec || typeof rec !== "object") return {};

  const roi = num(rec.roi, null);
  const hitRate = num(rec.hitRate, null);
  const count = num(rec.count, 0);

  let tier = "NEUTRAL";
  if (count >= 50 && roi >= 0.15 && hitRate >= 0.58) tier = "STRONG_POSITIVE";
  else if (count >= 25 && roi > 0) tier = "POSITIVE";
  else if (count >= 25 && roi < 0) tier = "NEGATIVE";

  return {
    key: bucket,
    count,
    hitRate,
    roi,
    tier
  };
}

function isNegativeMoreSide(row) {
  const side = String(row.side || "").toUpperCase();
  const sideBias = getSideBias(row);
  return side === "MORE" && (
    sideBias.tier === "NEGATIVE" ||
    Number(sideBias.roi) < 0 ||
    (Array.isArray(row.leanNotes) && row.leanNotes.some(n => String(n).includes("negative_full_board_more_side")))
  );
}

function isFade(row) {
  return String(row.grade || row.qualityGrade || "").toUpperCase() === "FADE";
}

function isShadowPromotedLean(row) {
  const promotedBuckets = Array.isArray(shadowPromotionAudit.promoted)
    ? shadowPromotionAudit.promoted.map(r => String(r.bucket || ""))
    : [];

  const bucket = `${row.oddsTier || "standard"} | ${row.market || ""} ${String(row.side || "").toUpperCase()}`;

  if (!promotedBuckets.includes(bucket)) return false;

  const prob = num(row.calibratedDistributionProb ?? row.prob ?? row.recommendedProb, null);
  const edge = num(row.sportsbookAdjustedEdge ?? row.sportsbookEdge ?? row.edge, null);
  const support = String(row.marketSupportFlag || row.support || "").toUpperCase();
  const grade = String(row.qualityGrade || row.grade || "").toUpperCase();

  if (prob === null || edge === null) return false;
  if (prob < 0.58) return false;
  if (edge <= 0) return false;
  if (support !== "OK") return false;
  if (grade === "FADE") return false;

  return true;
}

function normalizeShadowRow(row) {
  return {
    ...row,
    prob: row.calibratedDistributionProb ?? row.prob ?? row.recommendedProb,
    edge: row.sportsbookAdjustedEdge ?? row.sportsbookEdge ?? row.edge,
    books: row.sportsbookBookCount ?? row.books,
    support: row.marketSupportFlag ?? row.support,
    grade: row.qualityGrade ?? row.grade,
    fullBoardSideBias: getSideBias(row),
    shadowPromotion: true
  };
}

function isActionableLean(row) {
  const prob = num(row.prob);
  const edge = num(row.edge);
  const books = num(row.books ?? row.sportsbookBookCount, 0);
  const support = String(row.support || row.marketSupportFlag || "").toUpperCase();
  const sideBias = getSideBias(row);
  const sideBiasTier = String(sideBias.tier || "").toUpperCase();
  const sideBiasRoi = num(sideBias.roi, null);

  if (prob === null || edge === null) return false;
  if (isFade(row)) return false;
  if (isNegativeMoreSide(row)) return false;

  const supportOk = support === "OK" || books >= 2;
  const sideBiasOk =
    sideBiasTier === "STRONG_POSITIVE" ||
    sideBiasTier === "POSITIVE" ||
    sideBiasTier === "NEUTRAL" ||
    sideBiasTier === "" ||
    sideBiasRoi === null ||
    sideBiasRoi >= 0;

  if (!supportOk || !sideBiasOk) return false;

  if (prob >= 0.54 && edge >= 0.05) return true;
  if (prob >= 0.53 && edge >= 0.075 && sideBiasTier.includes("POSITIVE")) return true;

  return false;
}

function printLeg(row, prefix = "-") {
  const sideBias = getSideBias(row);
  const grade = row.grade || row.qualityGrade || "n/a";
  const support = row.support || row.marketSupportFlag || "n/a";
  const books = row.books ?? row.sportsbookBookCount ?? "n/a";

  console.log(
    `${prefix} ${row.player} | ${row.team || ""} | ${compactPick(row)} | ` +
    `${row.oddsTier || "standard"} | prob=${pct(row.prob)} | edge=${pct(row.edge)} | ` +
    `books=${books} | support=${support} | grade=${grade} | ` +
    `sideBias=${sideBias.tier || "n/a"} | sideROI=${pct(sideBias.roi)}`
  );

  if (Array.isArray(row.leanNotes) && row.leanNotes.length) {
    console.log(`  notes: ${row.leanNotes.join(", ")}`);
  }

  if (row.reason || row.disabledReason) {
    console.log(`  blockedReason: ${row.reason || row.disabledReason}`);
  }
}

const official = readJson("outputs/playable-final-slips.json", []);
const leanReport = readJson("outputs/lean-final-slips.json", {});
const blockedRaw = readJson("outputs/blocked-final-candidates.json", []);
const enriched = readJson("outputs/slips-distribution-enriched.json", []);
const fullBoardLearning = readJson("data/learning/full-board-market-learning.json", {});
const fullBoardByMarketSide = fullBoardLearning.byMarketSide || {};
const shadowPromotionAudit = readJson("outputs/shadow-promotion-audit-latest.json", {});
const sportsBookEnrichedBoard = readJson("outputs/sportsbook-enriched-board.json", []);

const enrichedByKey = new Map(enriched.map(row => [key(row), row]));

const leans = Array.isArray(leanReport.leans) ? leanReport.leans : [];

const blocked = blockedRaw.map(row => {
  const e = enrichedByKey.get(key(row)) || {};
  return {
    ...e,
    ...row,
    team: e.team ?? row.team,
    game: e.game ?? row.game,
    oddsTier: e.oddsTier ?? row.oddsTier,
    prob: row.prob ?? e.calibratedDistributionProb ?? e.prob ?? e.recommendedProb,
    edge: row.edge ?? e.sportsbookAdjustedEdge ?? e.sportsbookEdge,
    books: e.sportsbookBookCount ?? row.books,
    support: e.marketSupportFlag ?? row.support,
    grade: e.qualityGrade ?? row.grade,
    fullBoardSideBias: e.fullBoardSideBias ?? row.fullBoardSideBias,
    projection: e.projection ?? row.projection,
    contextAdjustedProjection: e.contextAdjustedProjection ?? row.contextAdjustedProjection
  };
});

const shadowPromotedLeans = sportsBookEnrichedBoard
  .filter(isShadowPromotedLean)
  .map(normalizeShadowRow)
  .filter((row, idx, arr) => arr.findIndex(x => key(x) === key(row)) === idx)
  .sort((a, b) =>
    (num(b.prob, 0) - num(a.prob, 0)) ||
    (num(b.edge, 0) - num(a.edge, 0))
  );

const actionableLeans = [
  ...leans,
  ...blocked.filter(isActionableLean),
  ...shadowPromotedLeans
]
  .filter((row, idx, arr) => arr.findIndex(x => key(x) === key(row)) === idx)
  .sort((a, b) =>
    (num(b.prob, 0) - num(a.prob, 0)) ||
    (num(b.edge, 0) - num(a.edge, 0))
  );

const highProbAvoids = blocked
  .filter(row => num(row.prob, 0) >= 0.62 && (isFade(row) || isNegativeMoreSide(row)))
  .sort((a, b) =>
    (num(b.prob, 0) - num(a.prob, 0)) ||
    (num(b.edge, 0) - num(a.edge, 0))
  );

const topBlocked = blocked
  .sort((a, b) =>
    (num(b.prob, 0) - num(a.prob, 0)) ||
    (num(b.edge, 0) - num(a.edge, 0))
  );

console.log("CURRENT MLB PROP DECISION");
console.log("=========================");
console.log(`official slips: ${official.length}`);
console.log(`actionable leans: ${actionableLeans.length}`);
console.log(`shadow-promoted leans: ${shadowPromotedLeans.length}`);
console.log(`high-probability avoids: ${highProbAvoids.length}`);
console.log("");

console.log("OFFICIAL PLAYS");
console.log("--------------");
if (official.length) {
  for (const slip of official) {
    console.log(`${slip.name || "slip"} | ${slip.status || ""} | EV=${slip.trueEVPct ?? "n/a"}`);
    for (const leg of slip.legs || []) {
      printLeg(leg, "-");
    }
  }
} else {
  console.log("none");
}

console.log("");
console.log("ACTIONABLE LEANS");
console.log("----------------");
if (actionableLeans.length) {
  for (const row of actionableLeans.slice(0, 8)) {
    printLeg(row, "-");
  }
} else {
  console.log("none");
}

console.log("");
console.log("SHADOW-PROMOTED LEANS");
console.log("---------------------");
if (shadowPromotedLeans.length) {
  for (const row of shadowPromotedLeans.slice(0, 8)) {
    printLeg(row, "-");
  }
} else {
  console.log("none");
}

console.log("");
console.log("HIGH-PROBABILITY AVOIDS");
console.log("-----------------------");
if (highProbAvoids.length) {
  for (const row of highProbAvoids.slice(0, 8)) {
    printLeg(row, "-");
  }
} else {
  console.log("none");
}

console.log("");
console.log("TOP BLOCKED");
console.log("-----------");
if (topBlocked.length) {
  for (const row of topBlocked.slice(0, 10)) {
    printLeg(row, "-");
  }
} else {
  console.log("none");
}
