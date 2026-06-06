const fs = require("fs");

const BOARD = process.env.BOARD || "outputs/priced-board.json";
const OUT = "outputs/standard-hitter-actionable-fixes.json";
const TXT = "outputs/standard-hitter-actionable-fixes.txt";

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
function projection(r) {
  return n(r.projection ?? r.projected ?? r.mean ?? r.modelProjection ?? r.proj ?? r.median);
}
function probability(r) {
  return n(r.probability ?? r.prob ?? r.calibratedProbability ?? r.modelProbability ?? r.hitProbability ?? r.winProb);
}
function score(r) {
  return n(r.finalScore ?? r.score ?? r.edgeScore ?? r.rankScore);
}
function line(r) {
  return n(r.line ?? r.target ?? r.value ?? r.statValue);
}
function isStandard(r) {
  return !/goblin|demon/.test(tier(r));
}
function isHitter(r) {
  const m = market(r);
  if (!m) return false;
  if (/allowed|pitch|strikeout|earned/.test(m)) return false;
  return /hitter|fantasy|hrr|hit|base|single|double|run|rbi|walk/.test(m);
}
function isFantasy(r) {
  return /fantasy/.test(market(r));
}
function bucket(r) {
  const d = disabled(r).toLowerCase();
  const proj = projection(r);
  const prob = probability(r);
  const sc = score(r);

  if (isFantasy(r) && /fantasy scale not verified/.test(d)) {
    return "intentional_fantasy_scale_block";
  }
  if (/combo player team resolver skip/.test(d)) {
    return "fix_combo_player_team_resolver";
  }
  if (/player\/team unresolved|mismatch/.test(d)) {
    return "fix_player_team_mismatch";
  }
  if (d && /missing_or_zero_projection/.test(d)) {
    return "fix_missing_projection_disabled";
  }
  if (!d && (proj === null || proj === 0)) {
    return "fix_missing_projection_no_disabled_reason";
  }
  if (!d && proj !== null && proj !== 0 && (prob === null || prob === 0)) {
    return "fix_projection_to_probability_conversion";
  }
  if (!d && prob !== null && prob > 0 && (sc === null || sc === 0)) {
    return "fix_probability_to_final_score_conversion";
  }
  if (!d && prob !== null && prob > 0 && prob < 0.55) {
    return "real_reject_low_probability";
  }
  if (!d && prob !== null && prob >= 0.55) {
    return "actionable_rank_gate_review";
  }
  if (d) {
    return `other_disabled:${d}`;
  }
  return "unknown_actionable";
}

const board = rows(readJson(BOARD, []));
const hitterRows = board.filter(r => isStandard(r) && isHitter(r));

const byBucket = {};
const examples = {};
const byMarket = {};
const actionable = [];

function inc(obj, k) { obj[k] = (obj[k] || 0) + 1; }

for (const r of hitterRows) {
  const b = bucket(r);
  inc(byBucket, b);
  inc(byMarket, market(r) || "unknown");
  examples[b] ||= [];
  const item = {
    player: player(r),
    team: team(r),
    market: market(r),
    line: line(r),
    projection: projection(r),
    probability: probability(r),
    finalScore: score(r),
    tier: tier(r),
    disabledReason: disabled(r) || null
  };
  if (examples[b].length < 20) examples[b].push(item);
  if (!b.startsWith("intentional_") && !b.startsWith("real_reject")) actionable.push({ bucket: b, ...item });
}

const priority = [
  "fix_missing_projection_disabled",
  "fix_missing_projection_no_disabled_reason",
  "fix_projection_to_probability_conversion",
  "fix_probability_to_final_score_conversion",
  "fix_player_team_mismatch",
  "fix_combo_player_team_resolver",
  "actionable_rank_gate_review"
];

const summary = {
  generatedAt: new Date().toISOString(),
  board: BOARD,
  totals: {
    boardRows: board.length,
    standardHitterRows: hitterRows.length,
    actionableRows: actionable.length
  },
  priorityOrder: priority,
  byBucket: Object.fromEntries(Object.entries(byBucket).sort((a,b) => b[1] - a[1])),
  byMarket: Object.fromEntries(Object.entries(byMarket).sort((a,b) => b[1] - a[1])),
  examples,
  actionableTop: actionable.slice(0, 100)
};

const out = [];
out.push("ACTIONABLE STANDARD HITTER FIX AUDIT");
out.push("====================================");
out.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  byBucket: summary.byBucket,
  byMarket: summary.byMarket,
  priorityOrder: summary.priorityOrder
}, null, 2));

out.push("");
out.push("WHAT THIS MEANS");
out.push("---------------");
out.push("intentional_fantasy_scale_block = leave blocked for now.");
out.push("fix_missing_projection_* = projection/data join issue.");
out.push("fix_projection_to_probability_conversion = projection exists but ranking probability was not created.");
out.push("fix_probability_to_final_score_conversion = probability exists but final score/rank was not created.");
out.push("fix_player_team_mismatch / combo resolver = name/team resolver issue.");

for (const p of priority) {
  out.push("");
  out.push(`PRIORITY: ${p} (${summary.byBucket[p] || 0})`);
  out.push("-".repeat(12 + p.length));
  (examples[p] || []).slice(0, 15).forEach((x, i) => {
    out.push(`${i + 1}. ${x.player || "?"} | ${x.team || "?"} | ${x.market || "?"} ${x.line ?? "?"} | proj=${x.projection ?? "?"} | prob=${x.probability ?? "?"} | score=${x.finalScore ?? "?"} | disabled=${x.disabledReason || "none"}`);
  });
}

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, out.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  topBuckets: Object.entries(summary.byBucket).slice(0, 12)
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
