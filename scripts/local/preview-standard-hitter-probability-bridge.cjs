const fs = require("fs");

const BOARD = process.env.BOARD || "outputs/priced-board.json";
const OUT = "outputs/standard-hitter-probability-bridge-preview.json";
const TXT = "outputs/standard-hitter-probability-bridge-preview.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function rows(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.rows)) return v.rows;
  if (v && Array.isArray(v.props)) return v.props;
  if (v && Array.isArray(v.projections)) return v.projections;
  return [];
}
function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function pct(v) {
  const x = n(v);
  return x === null ? "?" : `${(x * 100).toFixed(1)}%`;
}
function market(r) {
  return s(r.market || r.statType || r.projectionType || r.type).toLowerCase();
}
function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}
function team(r) {
  return s(r.team || r.resolvedTeam || r.rawTeam || r.abbrev);
}
function tier(r) {
  return s(r.tier || r.oddsTier || r.projectionTier || r.payoutType || "standard").toLowerCase();
}
function disabled(r) {
  return s(r.disabledReason || r.reason || r.blockReason || r.excludedReason || r.rejectReason);
}
function proj(r) {
  return n(r.projection ?? r.projected ?? r.mean ?? r.modelProjection ?? r.proj ?? r.median);
}
function line(r) {
  return n(r.line ?? r.target ?? r.value ?? r.statValue);
}
function mainProb(r) {
  return n(r.probability ?? r.prob ?? r.calibratedProbability ?? r.modelProbability ?? r.hitProbability ?? r.winProb);
}
function overProb(r) { return n(r.overProb); }
function underProb(r) { return n(r.underProb); }
function isStandard(r) {
  return !/goblin|demon/.test(tier(r));
}
function isHitter(r) {
  const m = market(r);
  if (!m) return false;
  if (/allowed|pitch|strikeout|earned/.test(m)) return false;
  return /hrr|hit|base|single|double|run|rbi|walk/.test(m) && !/fantasy/.test(m);
}
function confirmed(r) {
  return Boolean(r.lineupConfirmed ?? r.confirmedLineup ?? r.isConfirmedLineup);
}
function chooseSide(r) {
  const p = proj(r);
  const l = line(r);
  const over = overProb(r);
  const under = underProb(r);

  if (p === null || l === null || over === null || under === null) {
    return { side: null, probability: null, reason: "missing_inputs" };
  }

  const moreSane = p > l && over >= under;
  const lessSane = p < l && under >= over;

  if (moreSane) return { side: "MORE", probability: over, reason: "projection_and_prob_agree_more" };
  if (lessSane) return { side: "LESS", probability: under, reason: "projection_and_prob_agree_less" };

  return {
    side: over >= under ? "MORE" : "LESS",
    probability: Math.max(over, under),
    reason: "prob_projection_conflict_do_not_promote"
  };
}
function scoreCandidate(r, chosen) {
  const probability = chosen.probability || 0;
  const edge = n(r.edge) || 0;
  const ev = n(r.expectedValue) || 0;
  const order = n(r.battingOrder) || 9;
  const lineupBoost = confirmed(r) ? 20 : -40;
  const orderBoost = order <= 4 ? 12 : order <= 6 ? 6 : 0;
  const marketBoost =
    market(r) === "hrr" ? 10 :
    market(r) === "hits" ? 5 :
    market(r) === "bases" ? 4 :
    market(r) === "singles" ? 1 :
    0;

  return Number((
    probability * 1000 +
    edge * 20 +
    ev * 25 +
    lineupBoost +
    orderBoost +
    marketBoost
  ).toFixed(2));
}

const board = rows(readJson(BOARD, []));
const baseRows = board.filter(r =>
  isStandard(r) &&
  isHitter(r) &&
  !disabled(r) &&
  mainProb(r) === null &&
  overProb(r) !== null &&
  underProb(r) !== null
);

const preview = [];
const rejected = [];

for (const r of baseRows) {
  const chosen = chooseSide(r);
  const p = chosen.probability;
  const sane = !chosen.reason.includes("conflict");
  const clearsProb = p !== null && p >= 0.60;
  const clearsStrongProb = p !== null && p >= 0.65;

  const item = {
    player: player(r),
    team: team(r),
    market: market(r),
    side: chosen.side,
    line: line(r),
    projection: proj(r),
    contextAdjustedProjection: n(r.contextAdjustedProjection),
    probability: p,
    overProb: overProb(r),
    underProb: underProb(r),
    edge: n(r.edge),
    expectedValue: n(r.expectedValue),
    finalScorePreview: scoreCandidate(r, chosen),
    battingOrder: n(r.battingOrder),
    lineupConfirmed: confirmed(r),
    reason: chosen.reason,
    wouldPromote: sane && clearsProb,
    strongPromote: sane && clearsStrongProb
  };

  if (item.wouldPromote) preview.push(item);
  else rejected.push(item);
}

preview.sort((a, b) =>
  b.finalScorePreview - a.finalScorePreview ||
  b.probability - a.probability
);
rejected.sort((a, b) =>
  (b.probability || 0) - (a.probability || 0)
);

const byMarket = {};
const bySide = {};
const byRejectReason = {};
for (const x of preview) {
  byMarket[x.market] = (byMarket[x.market] || 0) + 1;
  bySide[x.side] = (bySide[x.side] || 0) + 1;
}
for (const x of rejected) {
  byRejectReason[x.reason] = (byRejectReason[x.reason] || 0) + 1;
  if ((x.probability || 0) < 0.60) byRejectReason["below_0.60_probability"] = (byRejectReason["below_0.60_probability"] || 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  board: BOARD,
  rules: {
    readOnly: true,
    promoteThreshold: 0.60,
    strongThreshold: 0.65,
    requiresNoDisabledReason: true,
    requiresProjectionAndProbabilityAgreement: true,
    excludesFantasy: true
  },
  totals: {
    boardRows: board.length,
    standardHitterBridgeRows: baseRows.length,
    wouldPromote: preview.length,
    strongPromote: preview.filter(x => x.strongPromote).length,
    rejected: rejected.length
  },
  byMarket,
  bySide,
  byRejectReason,
  candidates: preview,
  rejectedTop: rejected.slice(0, 100)
};

const out = [];
out.push("STANDARD HITTER PROBABILITY BRIDGE PREVIEW");
out.push("==========================================");
out.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  rules: summary.rules,
  totals: summary.totals,
  byMarket: summary.byMarket,
  bySide: summary.bySide,
  byRejectReason: summary.byRejectReason
}, null, 2));

out.push("");
out.push("TOP WOULD-PROMOTE STANDARD HITTERS");
out.push("----------------------------------");
if (!preview.length) {
  out.push("No standard hitters cleared bridge rules.");
} else {
  preview.slice(0, 40).forEach((x, i) => {
    out.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.side} ${x.line} | prob=${pct(x.probability)} | proj=${x.projection} | over=${pct(x.overProb)} | under=${pct(x.underProb)} | score=${x.finalScorePreview} | order=${x.battingOrder ?? "?"} | lineup=${x.lineupConfirmed ? "confirmed" : "not_confirmed"} | ${x.reason}`);
  });
}

out.push("");
out.push("TOP REJECTED / DO NOT PROMOTE");
out.push("-----------------------------");
rejected.slice(0, 40).forEach((x, i) => {
  out.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.side || "?"} ${x.line} | prob=${pct(x.probability)} | proj=${x.projection} | over=${pct(x.overProb)} | under=${pct(x.underProb)} | ${x.reason}`);
});

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, out.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  byMarket: summary.byMarket,
  byRejectReason: summary.byRejectReason,
  top: preview.slice(0, 8).map(x => ({
    player: x.player,
    market: x.market,
    side: x.side,
    line: x.line,
    probability: x.probability,
    score: x.finalScorePreview
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
