const fs = require("fs");

const BOARD = process.env.BOARD || "outputs/priced-board.json";
const OUT = "outputs/less-batter-prop-audit.json";
const TXT = "outputs/less-batter-prop-audit.txt";

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
function overProb(r) { return n(r.overProb); }
function underProb(r) { return n(r.underProb); }
function mainProb(r) {
  return n(r.probability ?? r.prob ?? r.calibratedProbability ?? r.modelProbability ?? r.hitProbability ?? r.winProb);
}
function confirmed(r) {
  return Boolean(r.lineupConfirmed ?? r.confirmedLineup ?? r.isConfirmedLineup);
}
function isStandard(r) {
  return !/goblin|demon/.test(tier(r));
}
function isBatterMarket(r) {
  const m = market(r);
  if (!m) return false;
  if (/allowed|pitch|strikeout|earned/.test(m)) return false;
  return /hrr|hit|base|single|double|run|rbi|walk/.test(m) && !/fantasy/.test(m);
}
function lessStatus(r) {
  const p = proj(r);
  const l = line(r);
  const under = underProb(r);
  const over = overProb(r);

  if (disabled(r)) return "disabled";
  if (p === null || l === null) return "missing_projection_or_line";
  if (under === null || over === null) return "missing_under_over_prob";

  if (p < l && under >= over) return "SAFE_LESS_PROJECTION_AND_PROB_AGREE";
  if (p >= l && under >= over) return "CONFLICT_UNDER_PROB_BUT_PROJECTION_OVER_LINE";
  if (p < l && under < over) return "CONFLICT_PROJECTION_LESS_BUT_OVER_PROB_HIGHER";
  return "not_less_candidate";
}
function scoreLess(r) {
  const under = underProb(r) || 0;
  const edge = n(r.edge) || 0;
  const ev = n(r.expectedValue) || 0;
  const order = n(r.battingOrder) || 9;
  const lineupBoost = confirmed(r) ? 20 : -50;
  const orderPenalty = order <= 4 ? -18 : order <= 6 ? -8 : 4;
  const marketPenalty =
    market(r) === "hrr" ? -6 :
    market(r) === "bases" ? -4 :
    market(r) === "hits" ? -2 :
    market(r) === "walks" ? 4 :
    0;

  return Number((
    under * 1000 +
    edge * 12 +
    ev * 15 +
    lineupBoost +
    orderPenalty +
    marketPenalty
  ).toFixed(2));
}

const board = rows(readJson(BOARD, []));
const batterRows = board.filter(r =>
  isStandard(r) &&
  isBatterMarket(r) &&
  !disabled(r) &&
  underProb(r) !== null &&
  overProb(r) !== null
);

const safeLess = [];
const conflictLess = [];
const other = [];

for (const r of batterRows) {
  const status = lessStatus(r);
  const item = {
    player: player(r),
    team: team(r),
    game: r.game || r.matchup || null,
    market: market(r),
    side: "LESS",
    line: line(r),
    projection: proj(r),
    contextAdjustedProjection: n(r.contextAdjustedProjection),
    underProb: underProb(r),
    overProb: overProb(r),
    edge: n(r.edge),
    expectedValue: n(r.expectedValue),
    battingOrder: n(r.battingOrder),
    lineupConfirmed: confirmed(r),
    status,
    score: scoreLess(r),
    mainProbability: mainProb(r)
  };

  if (status === "SAFE_LESS_PROJECTION_AND_PROB_AGREE" && item.underProb >= 0.60) {
    safeLess.push(item);
  } else if (status.includes("CONFLICT") && item.underProb >= 0.60) {
    conflictLess.push(item);
  } else {
    other.push(item);
  }
}

safeLess.sort((a, b) => b.score - a.score || b.underProb - a.underProb);
conflictLess.sort((a, b) => b.underProb - a.underProb);

const byMarket = {};
const byStatus = {};
for (const x of [...safeLess, ...conflictLess, ...other]) {
  byMarket[x.market] = (byMarket[x.market] || 0) + 1;
  byStatus[x.status] = (byStatus[x.status] || 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  mode: "read_only_less_batter_prop_audit",
  rules: {
    livePickGenerationChanged: false,
    standardOnly: true,
    excludesFantasy: true,
    safeLessThreshold: 0.60,
    safeLessRequiresProjectionBelowLine: true,
    safeLessRequiresUnderProbGreaterThanOverProb: true,
    conflictRowsAreDoNotPromote: true
  },
  totals: {
    boardRows: board.length,
    standardBatterRowsWithUnderOver: batterRows.length,
    safeLess: safeLess.length,
    conflictLess: conflictLess.length,
    other: other.length
  },
  byMarket,
  byStatus,
  safeLess,
  conflictLessTop: conflictLess.slice(0, 100),
  otherTop: other.slice(0, 80)
};

const lines = [];
lines.push("LESS BATTER PROP AUDIT");
lines.push("======================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  mode: summary.mode,
  rules: summary.rules,
  totals: summary.totals,
  byMarket: summary.byMarket,
  byStatus: summary.byStatus
}, null, 2));

lines.push("");
lines.push("SAFE LESS BATTER CANDIDATES");
lines.push("---------------------------");
if (!safeLess.length) {
  lines.push("No LESS batter props cleared safe rules.");
} else {
  safeLess.slice(0, 40).forEach((x, i) => {
    lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} LESS ${x.line} | under=${pct(x.underProb)} | over=${pct(x.overProb)} | proj=${x.projection} | score=${x.score} | order=${x.battingOrder ?? "?"} | lineup=${x.lineupConfirmed ? "confirmed" : "not_confirmed"} | ${x.status}`);
  });
}

lines.push("");
lines.push("HIGH UNDER-PROB CONFLICTS — DO NOT PROMOTE YET");
lines.push("----------------------------------------------");
if (!conflictLess.length) {
  lines.push("No high-prob LESS conflicts.");
} else {
  conflictLess.slice(0, 60).forEach((x, i) => {
    lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} LESS ${x.line} | under=${pct(x.underProb)} | over=${pct(x.overProb)} | proj=${x.projection} | order=${x.battingOrder ?? "?"} | lineup=${x.lineupConfirmed ? "confirmed" : "not_confirmed"} | ${x.status}`);
  });
}

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  byStatus: summary.byStatus,
  topSafe: safeLess.slice(0, 8).map(x => ({
    player: x.player,
    market: x.market,
    line: x.line,
    underProb: x.underProb,
    projection: x.projection,
    status: x.status
  })),
  topConflict: conflictLess.slice(0, 8).map(x => ({
    player: x.player,
    market: x.market,
    line: x.line,
    underProb: x.underProb,
    projection: x.projection,
    status: x.status
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
