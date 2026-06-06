const fs = require("fs");

const BOARD = process.env.BOARD || "outputs/priced-board.json";
const FINAL = "outputs/final-slips.json";
const OUT = "outputs/standard-hitter-rejection-audit.json";
const TXT = "outputs/standard-hitter-rejection-audit.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function arr(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.rows)) return v.rows;
  if (v && Array.isArray(v.projections)) return v.projections;
  if (v && Array.isArray(v.props)) return v.props;
  return [];
}

function norm(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function market(row) {
  return String(row.market || row.statType || row.projectionType || row.type || "").trim();
}

function player(row) {
  return String(row.player || row.playerName || row.name || row.athleteName || "").trim();
}

function team(row) {
  return String(row.team || row.resolvedTeam || row.rawTeam || row.abbrev || "").trim();
}

function tier(row) {
  return String(row.tier || row.oddsTier || row.projectionTier || row.payoutType || "standard").toLowerCase();
}

function side(row) {
  return String(row.side || row.pick || row.direction || row.recommendation || "").toUpperCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isStandard(row) {
  const t = tier(row);
  return !/goblin|demon/.test(t);
}

function isHitterMarket(row) {
  const m = market(row).toLowerCase();
  if (!m) return false;
  if ([
    "hits",
    "bases",
    "hrr",
    "runs",
    "rbis",
    "rbi",
    "singles",
    "doubles",
    "walks",
    "hitter_fantasy_score",
    "fantasy"
  ].includes(m)) return true;

  return /hit|base|hrr|run|rbi|single|double|walk|hitter/.test(m)
    && !/allowed|pitch|strikeout|earned/.test(m);
}

function projection(row) {
  return num(
    row.projection ??
    row.projected ??
    row.mean ??
    row.modelProjection ??
    row.proj ??
    row.median ??
    null
  );
}

function line(row) {
  return num(row.line ?? row.target ?? row.value ?? row.statValue ?? null);
}

function probability(row) {
  return num(
    row.probability ??
    row.prob ??
    row.calibratedProbability ??
    row.modelProbability ??
    row.hitProbability ??
    row.winProb ??
    null
  );
}

function score(row) {
  return num(row.finalScore ?? row.score ?? row.edgeScore ?? row.rankScore ?? null);
}

function disabledReason(row) {
  return String(
    row.disabledReason ||
    row.reason ||
    row.blockReason ||
    row.excludedReason ||
    row.rejectReason ||
    ""
  ).trim();
}

function hasRankedSide(row) {
  return Boolean(
    side(row) ||
    row.rankEligible === true ||
    row.isFinalCandidate === true ||
    row.finalCandidate === true ||
    row.selected === true
  );
}

function key(row) {
  return [norm(player(row)), norm(team(row)), norm(market(row)), String(line(row) ?? "")].join("|");
}

function classify(row, finalKeys) {
  const reasons = [];
  const dis = disabledReason(row);
  const proj = projection(row);
  const ln = line(row);
  const prob = probability(row);
  const sc = score(row);
  const sd = side(row);

  if (finalKeys.has(key(row))) reasons.push("survived_final_slips");
  if (dis) reasons.push(`disabled:${dis}`);
  if (!player(row)) reasons.push("missing_player");
  if (!team(row)) reasons.push("missing_team");
  if (!market(row)) reasons.push("missing_market");
  if (ln === null) reasons.push("missing_line");
  if (proj === null || proj === 0) reasons.push("missing_or_zero_projection");
  if (proj !== null && ln !== null && proj === ln) reasons.push("projection_equals_line");
  if (prob === null) reasons.push("missing_probability");
  if (sc === null) reasons.push("missing_final_score");
  if (!sd) reasons.push("missing_ranked_side");
  if (prob !== null && prob < 0.55) reasons.push("probability_below_55");
  if (prob !== null && prob >= 0.55 && prob < 0.62) reasons.push("probability_55_to_62");
  if (prob !== null && prob >= 0.62) reasons.push("probability_62_plus_but_not_final");

  const m = market(row).toLowerCase();
  if (/fantasy/.test(m) && /fantasy scale not verified/i.test(dis)) {
    reasons.push("intentional_fantasy_block");
  }

  if (!reasons.length) reasons.push("unknown_not_ranked");

  return reasons;
}

const boardRaw = readJson(BOARD, []);
const boardRows = arr(boardRaw);

const finalRaw = readJson(FINAL, []);
const finalRows = [];
(function flatten(v) {
  if (!v) return;
  if (Array.isArray(v)) return v.forEach(flatten);
  if (typeof v !== "object") return;
  if (player(v) || market(v) || v.legs) finalRows.push(v);
  Object.values(v).forEach(flatten);
})(finalRaw);

const finalKeys = new Set(finalRows.map(key));

const standardHitters = boardRows.filter(r => isStandard(r) && isHitterMarket(r));

const buckets = {};
const examples = {};
const marketBuckets = {};
const teamBuckets = {};
const survived = [];

function inc(obj, k) {
  obj[k] = (obj[k] || 0) + 1;
}

for (const row of standardHitters) {
  const reasons = classify(row, finalKeys);
  const mk = market(row).toLowerCase() || "unknown";
  const tm = team(row) || "UNKNOWN";

  inc(marketBuckets, mk);
  inc(teamBuckets, tm);

  if (reasons.includes("survived_final_slips")) survived.push(row);

  for (const r of reasons) {
    inc(buckets, r);
    examples[r] ||= [];
    if (examples[r].length < 12) {
      examples[r].push({
        player: player(row),
        team: team(row),
        market: market(row),
        side: side(row) || null,
        line: line(row),
        projection: projection(row),
        probability: probability(row),
        finalScore: score(row),
        tier: tier(row),
        disabledReason: disabledReason(row) || null
      });
    }
  }
}

const noDisabled = standardHitters.filter(r => !disabledReason(r));
const withProjectionNoProb = standardHitters.filter(r =>
  !disabledReason(r) &&
  projection(r) !== null &&
  projection(r) !== 0 &&
  probability(r) === null
);
const withProbNoFinalScore = standardHitters.filter(r =>
  !disabledReason(r) &&
  probability(r) !== null &&
  score(r) === null
);
const withProbNoRankedSide = standardHitters.filter(r =>
  !disabledReason(r) &&
  probability(r) !== null &&
  !side(r) &&
  !finalKeys.has(key(r))
);

const summary = {
  generatedAt: new Date().toISOString(),
  board: BOARD,
  final: FINAL,
  totals: {
    boardRows: boardRows.length,
    standardHitterRows: standardHitters.length,
    disabled: standardHitters.filter(r => disabledReason(r)).length,
    noDisabledReason: noDisabled.length,
    withProjectionNoProbability: withProjectionNoProb.length,
    withProbabilityNoFinalScore: withProbNoFinalScore.length,
    withProbabilityNoRankedSide: withProbNoRankedSide.length,
    survivedFinalSlips: survived.length
  },
  byReason: Object.fromEntries(Object.entries(buckets).sort((a,b) => b[1] - a[1])),
  byMarket: Object.fromEntries(Object.entries(marketBuckets).sort((a,b) => b[1] - a[1])),
  byTeam: Object.fromEntries(Object.entries(teamBuckets).sort((a,b) => b[1] - a[1])),
  examples
};

const lines = [];
lines.push("STANDARD HITTER REJECTION AUDIT");
lines.push("================================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  byReason: summary.byReason,
  byMarket: summary.byMarket
}, null, 2));

lines.push("");
lines.push("MOST IMPORTANT FIX TARGETS");
lines.push("--------------------------");
lines.push(`1. missing_or_zero_projection: ${summary.byReason.missing_or_zero_projection || 0}`);
lines.push(`2. missing_probability: ${summary.byReason.missing_probability || 0}`);
lines.push(`3. missing_final_score: ${summary.byReason.missing_final_score || 0}`);
lines.push(`4. missing_ranked_side: ${summary.byReason.missing_ranked_side || 0}`);
lines.push(`5. combo/team/player resolver issues: ${
  Object.entries(summary.byReason)
    .filter(([k]) => /combo|resolver|team|mismatch/i.test(k))
    .reduce((a, [,v]) => a + v, 0)
}`);

for (const [reason, sample] of Object.entries(examples)) {
  lines.push("");
  lines.push(`REASON: ${reason}`);
  lines.push("-".repeat(8 + reason.length));
  sample.slice(0, 10).forEach((x, i) => {
    lines.push(`${i + 1}. ${x.player || "?"} | ${x.team || "?"} | ${x.market || "?"} ${x.side || ""} ${x.line ?? "?"} | proj=${x.projection ?? "?"} | prob=${x.probability ?? "?"} | score=${x.finalScore ?? "?"} | disabled=${x.disabledReason || "none"}`);
  });
}

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  topReasons: Object.entries(summary.byReason).slice(0, 10)
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
