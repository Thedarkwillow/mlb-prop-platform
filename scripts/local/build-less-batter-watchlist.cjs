const fs = require("fs");

const BOARD = process.env.BOARD || "outputs/priced-board.json";
const OUT = "outputs/less-batter-watchlist.json";
const TXT = "outputs/less-batter-watchlist.txt";

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
function lessType(r) {
  const p = proj(r);
  const l = line(r);
  const under = underProb(r);
  const over = overProb(r);

  if (p === null || l === null || under === null || over === null) return "MISSING_INPUTS";
  if (p < l && under >= over) return "STRICT_LESS";
  if (p >= l && under >= over) return "DISTRIBUTION_SKEW_LESS";
  if (p < l && under < over) return "PROJECTION_LESS_BUT_PROB_MORE";
  return "NOT_LESS";
}
function scoreLess(r, type) {
  const under = underProb(r) || 0;
  const edge = n(r.edge) || 0;
  const ev = n(r.expectedValue) || 0;
  const order = n(r.battingOrder) || 9;
  const lineupBoost = confirmed(r) ? 30 : -80;

  // For LESS batter props, lower-order hitters are generally safer than top-order hitters.
  const orderAdj = order >= 7 ? 14 : order >= 5 ? 5 : order >= 1 && order <= 3 ? -18 : -8;

  const typeAdj =
    type === "STRICT_LESS" ? 35 :
    type === "DISTRIBUTION_SKEW_LESS" ? 10 :
    -80;

  const marketAdj =
    market(r) === "hits" ? 8 :
    market(r) === "bases" ? 6 :
    market(r) === "runs" ? 4 :
    market(r) === "walks" ? 2 :
    market(r) === "hrr" ? -4 :
    market(r) === "singles" ? -6 :
    0;

  return Number((
    under * 1000 +
    edge * 8 +
    ev * 8 +
    lineupBoost +
    orderAdj +
    typeAdj +
    marketAdj
  ).toFixed(2));
}

const board = rows(readJson(BOARD, []));
const baseRows = board.filter(r =>
  isStandard(r) &&
  isBatterMarket(r) &&
  !disabled(r) &&
  underProb(r) !== null &&
  overProb(r) !== null
);

const candidates = [];
const rejected = [];

for (const r of baseRows) {
  const type = lessType(r);
  const under = underProb(r) || 0;
  const isConfirmed = confirmed(r);
  const order = n(r.battingOrder);

  const strictStrong = type === "STRICT_LESS" && isConfirmed && under >= 0.60;
  const skewStrong = type === "DISTRIBUTION_SKEW_LESS" && isConfirmed && under >= 0.65;
  const skewWatch = type === "DISTRIBUTION_SKEW_LESS" && isConfirmed && under >= 0.60 && under < 0.65;

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
    battingOrder: order,
    lineupConfirmed: isConfirmed,
    lessType: type,
    lessWatchStatus:
      strictStrong ? "STRICT_STRONG_WATCHLIST" :
      skewStrong ? "SKEW_STRONG_WATCHLIST" :
      skewWatch ? "SKEW_WATCHLIST" :
      "DO_NOT_PROMOTE",
    finalScorePreview: scoreLess(r, type)
  };

  if (item.lessWatchStatus !== "DO_NOT_PROMOTE") candidates.push(item);
  else rejected.push(item);
}

candidates.sort((a, b) =>
  b.finalScorePreview - a.finalScorePreview ||
  b.underProb - a.underProb
);
rejected.sort((a, b) =>
  (b.underProb || 0) - (a.underProb || 0)
);

const byStatus = {};
const byMarket = {};
const byType = {};
for (const x of [...candidates, ...rejected]) {
  byType[x.lessType] = (byType[x.lessType] || 0) + 1;
  byMarket[x.market] = (byMarket[x.market] || 0) + 1;
  byStatus[x.lessWatchStatus] = (byStatus[x.lessWatchStatus] || 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  mode: "read_only_distribution_aware_less_batter_watchlist",
  rules: {
    livePickGenerationChanged: false,
    standardOnly: true,
    excludesFantasy: true,
    excludesDisabledRows: true,
    strictLess: "projection < line and underProb >= overProb; confirmed lineup; underProb >= 0.60",
    skewLess: "projection >= line but underProb >= overProb; confirmed lineup; strong if underProb >= 0.65",
    note: "Distribution-skew LESS is not automatically bad. It means probability favors LESS even though mean projection is over the line."
  },
  totals: {
    boardRows: board.length,
    rowsReviewed: baseRows.length,
    candidates: candidates.length,
    strictStrong: candidates.filter(x => x.lessWatchStatus === "STRICT_STRONG_WATCHLIST").length,
    skewStrong: candidates.filter(x => x.lessWatchStatus === "SKEW_STRONG_WATCHLIST").length,
    skewWatch: candidates.filter(x => x.lessWatchStatus === "SKEW_WATCHLIST").length,
    rejected: rejected.length
  },
  byStatus,
  byType,
  byMarket,
  candidates,
  rejectedTop: rejected.slice(0, 100)
};

const lines = [];
lines.push("DISTRIBUTION-AWARE LESS BATTER WATCHLIST");
lines.push("========================================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  mode: summary.mode,
  rules: summary.rules,
  totals: summary.totals,
  byStatus: summary.byStatus,
  byType: summary.byType,
  byMarket: summary.byMarket
}, null, 2));

lines.push("");
lines.push("LESS BATTER WATCHLIST CANDIDATES");
lines.push("--------------------------------");
if (!candidates.length) {
  lines.push("No LESS batter candidates cleared distribution-aware rules.");
} else {
  candidates.forEach((x, i) => {
    lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} LESS ${x.line} | ${x.lessWatchStatus} | type=${x.lessType} | under=${pct(x.underProb)} | over=${pct(x.overProb)} | proj=${x.projection} | score=${x.finalScorePreview} | order=${x.battingOrder ?? "?"} | lineup=${x.lineupConfirmed ? "confirmed" : "not_confirmed"}`);
  });
}

lines.push("");
lines.push("TOP REJECTED");
lines.push("------------");
rejected.slice(0, 50).forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} LESS ${x.line} | ${x.lessWatchStatus} | type=${x.lessType} | under=${pct(x.underProb)} | over=${pct(x.overProb)} | proj=${x.projection} | order=${x.battingOrder ?? "?"} | lineup=${x.lineupConfirmed ? "confirmed" : "not_confirmed"}`);
});

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  byStatus: summary.byStatus,
  byType: summary.byType,
  top: candidates.slice(0, 10).map(x => ({
    player: x.player,
    market: x.market,
    line: x.line,
    status: x.lessWatchStatus,
    type: x.lessType,
    underProb: x.underProb,
    projection: x.projection,
    score: x.finalScorePreview
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
