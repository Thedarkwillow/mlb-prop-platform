const fs = require("fs");

const BOARD = process.env.BOARD || "outputs/priced-board.json";
const OUT = "outputs/standard-hitter-bridge-watchlist.json";
const TXT = "outputs/standard-hitter-bridge-watchlist.txt";

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
function confirmed(r) {
  return Boolean(r.lineupConfirmed ?? r.confirmedLineup ?? r.isConfirmedLineup);
}
function isStandard(r) {
  return !/goblin|demon/.test(tier(r));
}
function isHitter(r) {
  const m = market(r);
  if (!m) return false;
  if (/allowed|pitch|strikeout|earned/.test(m)) return false;
  return /hrr|hit|base|single|double|run|rbi|walk/.test(m) && !/fantasy/.test(m);
}
function chooseSide(r) {
  const p = proj(r);
  const l = line(r);
  const over = overProb(r);
  const under = underProb(r);

  if (p === null || l === null || over === null || under === null) {
    return { side: null, probability: null, reason: "missing_inputs", safe: false };
  }

  if (p > l && over >= under) {
    return { side: "MORE", probability: over, reason: "projection_and_prob_agree_more", safe: true };
  }

  if (p < l && under >= over) {
    return { side: "LESS", probability: under, reason: "projection_and_prob_agree_less", safe: true };
  }

  return {
    side: over >= under ? "MORE" : "LESS",
    probability: Math.max(over, under),
    reason: "prob_projection_conflict_do_not_promote",
    safe: false
  };
}
function scoreCandidate(r, chosen) {
  const probability = chosen.probability || 0;
  const edge = n(r.edge) || 0;
  const ev = n(r.expectedValue) || 0;
  const order = n(r.battingOrder) || 9;
  const lineupBoost = confirmed(r) ? 30 : -75;
  const orderBoost = order <= 4 ? 14 : order <= 6 ? 7 : 0;
  const marketBoost =
    market(r) === "hrr" ? 14 :
    market(r) === "bases" ? 5 :
    market(r) === "hits" ? 4 :
    market(r) === "walks" ? -4 :
    market(r) === "singles" ? -6 :
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

const candidates = [];
const rejected = [];

for (const r of baseRows) {
  const chosen = chooseSide(r);
  const probability = chosen.probability ?? 0;
  const isConfirmed = confirmed(r);
  const strong = chosen.safe && isConfirmed && probability >= 0.65;
  const watch = chosen.safe && isConfirmed && probability >= 0.60;
  const unconfirmedWatch = chosen.safe && !isConfirmed && probability >= 0.70;

  const item = {
    player: player(r),
    team: team(r),
    game: r.game || r.matchup || null,
    market: market(r),
    side: chosen.side,
    line: line(r),
    projection: proj(r),
    contextAdjustedProjection: n(r.contextAdjustedProjection),
    probability,
    overProb: overProb(r),
    underProb: underProb(r),
    edge: n(r.edge),
    expectedValue: n(r.expectedValue),
    finalScorePreview: scoreCandidate(r, chosen),
    battingOrder: n(r.battingOrder),
    lineupConfirmed: isConfirmed,
    reason: chosen.reason,
    bridgeStatus: strong ? "STRONG_WATCHLIST" :
      watch ? "WATCHLIST" :
      unconfirmedWatch ? "UNCONFIRMED_WATCHLIST" :
      "DO_NOT_PROMOTE",
    rankEligiblePreview: strong || watch || unconfirmedWatch
  };

  if (item.rankEligiblePreview) candidates.push(item);
  else rejected.push(item);
}

candidates.sort((a, b) =>
  b.finalScorePreview - a.finalScorePreview ||
  b.probability - a.probability
);
rejected.sort((a, b) =>
  (b.probability || 0) - (a.probability || 0)
);

const byStatus = {};
const byMarket = {};
for (const x of candidates) {
  byStatus[x.bridgeStatus] = (byStatus[x.bridgeStatus] || 0) + 1;
  byMarket[x.market] = (byMarket[x.market] || 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  mode: "read_only_standard_hitter_bridge_watchlist",
  rules: {
    livePickGenerationChanged: false,
    excludesFantasy: true,
    excludesDisabledRows: true,
    requiresOverUnderProb: true,
    requiresProjectionAndProbabilityAgreement: true,
    confirmedStrongThreshold: 0.65,
    confirmedWatchThreshold: 0.60,
    unconfirmedWatchThreshold: 0.70,
    note: "This is a watchlist/report only. It does not inject rows into final-slips."
  },
  totals: {
    boardRows: board.length,
    bridgeRowsReviewed: baseRows.length,
    candidates: candidates.length,
    strongWatchlist: candidates.filter(x => x.bridgeStatus === "STRONG_WATCHLIST").length,
    watchlist: candidates.filter(x => x.bridgeStatus === "WATCHLIST").length,
    unconfirmedWatchlist: candidates.filter(x => x.bridgeStatus === "UNCONFIRMED_WATCHLIST").length,
    rejected: rejected.length
  },
  byStatus,
  byMarket,
  candidates,
  rejectedTop: rejected.slice(0, 80)
};

const lines = [];
lines.push("STANDARD HITTER BRIDGE WATCHLIST");
lines.push("================================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  mode: summary.mode,
  rules: summary.rules,
  totals: summary.totals,
  byStatus: summary.byStatus,
  byMarket: summary.byMarket
}, null, 2));

lines.push("");
lines.push("TOP STANDARD HITTER BRIDGE CANDIDATES");
lines.push("-------------------------------------");
if (!candidates.length) {
  lines.push("No candidates cleared safe bridge watchlist rules.");
} else {
  candidates.forEach((x, i) => {
    lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.side} ${x.line} | ${x.bridgeStatus} | prob=${pct(x.probability)} | proj=${x.projection} | over=${pct(x.overProb)} | under=${pct(x.underProb)} | score=${x.finalScorePreview} | order=${x.battingOrder ?? "?"} | lineup=${x.lineupConfirmed ? "confirmed" : "not_confirmed"}`);
  });
}

lines.push("");
lines.push("TOP REJECTED / DO NOT PROMOTE");
lines.push("-----------------------------");
rejected.slice(0, 35).forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.side || "?"} ${x.line} | ${x.bridgeStatus} | prob=${pct(x.probability)} | proj=${x.projection} | over=${pct(x.overProb)} | under=${pct(x.underProb)} | ${x.reason}`);
});

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  top: candidates.slice(0, 8).map(x => ({
    player: x.player,
    market: x.market,
    side: x.side,
    line: x.line,
    status: x.bridgeStatus,
    probability: x.probability,
    score: x.finalScorePreview
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
