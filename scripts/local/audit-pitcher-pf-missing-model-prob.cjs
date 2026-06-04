const fs = require("fs");

const date = process.argv[2] || require("child_process")
  .execSync("node scripts/local/board-slate-date.cjs")
  .toString()
  .trim();

const reportFile = `outputs/pitcher-pf-clean-report-${date}.json`;
const candidatesFile = "outputs/production-candidates.json";
const boardFile = "outputs/priced-board.json";
const outFile = `outputs/pitcher-pf-missing-model-prob-audit-${date}.json`;

function read(p, f = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return f; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const hasProp =
    v.player || v.playerName || v.name ||
    v.market || v.statType || v.stat ||
    v.side || v.line || v.prob || v.probability;

  if (hasProp) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }

  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const m = norm(v).replace(/\s+/g, "_");
  const aliases = {
    pitcher_strikeouts: "strikeouts",
    strikeouts: "strikeouts",
    hits_allowed: "hits_allowed",
    pitcher_hits_allowed: "hits_allowed",
    walks_allowed: "walks_allowed",
    pitcher_walks_allowed: "walks_allowed",
    earned_runs_allowed: "earned_runs_allowed",
    pitcher_earned_runs_allowed: "earned_runs_allowed",
    runs_allowed: "runs_allowed",
    pitcher_runs_allowed: "runs_allowed",
    pitching_outs: "pitching_outs",
    outs: "pitching_outs",
    pitches_thrown: "pitches_thrown",
    pitcher_fantasy_score: "pitcher_fantasy_score"
  };
  return aliases[m] || m;
}

function getPlayer(r) {
  return r.player || r.playerName || r.name || r.fullName || r.participantName || "";
}

function getMarket(r) {
  return marketNorm(r.market || r.statType || r.stat || r.projectionType || r.type || "");
}

function getSide(r) {
  return norm(r.side || r.pick || r.direction || r.recommendation || "");
}

function getLine(r) {
  const raw = r.line ?? r.lineScore ?? r.target ?? r.value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getProb(r) {
  const vals = [
    r.prob,
    r.probability,
    r.modelProb,
    r.modelProbability,
    r.finalProb,
    r.adjustedProb
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
  }
  return null;
}

function propKey(r) {
  return [
    norm(getPlayer(r)),
    getMarket(r),
    getSide(r),
    getLine(r)
  ].join("|");
}

function canonicalReportRows(report) {
  const sources = [
    report.rows,
    report.confirmed,
    report.allRows,
    report.primary,
    report.primaryRows
  ].filter(Array.isArray);

  let rows = sources.length ? sources.flat() : flatten(report);

  const seen = new Set();
  rows = rows.filter(r => {
    if (!r || typeof r !== "object") return false;
    if (!r.bucket) return false;
    const key = propKey(r) + "|" + String(r.bucket || "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return rows;
}

const report = read(reportFile, {});
const reportRows = canonicalReportRows(report);
const missing = reportRows.filter(r => r.bucket === "PF_CONFIRMED_MODEL_PROB_MISSING");

const candidates = flatten(read(candidatesFile, []));
const board = flatten(read(boardFile, []));

const audit = missing.map(r => {
  const player = norm(getPlayer(r));
  const market = getMarket(r);
  const side = getSide(r);
  const line = getLine(r);

  const samePlayerCandidate = candidates.filter(c => norm(getPlayer(c)) === player);
  const samePlayerMarketCandidate = samePlayerCandidate.filter(c => getMarket(c) === market);
  const samePlayerMarketSideCandidate = samePlayerMarketCandidate.filter(c => getSide(c) === side);
  const exactCandidate = samePlayerMarketSideCandidate.find(c => getLine(c) === line) || null;

  const samePlayerBoard = board.filter(b => norm(getPlayer(b)) === player);
  const samePlayerMarketBoard = samePlayerBoard.filter(b => getMarket(b) === market);
  const samePlayerMarketSideBoard = samePlayerMarketBoard.filter(b => getSide(b) === side);
  const exactBoard = samePlayerMarketSideBoard.find(b => getLine(b) === line) || null;

  let reason = "unknown";
  if (exactCandidate) reason = "exact_candidate_found_but_probability_missing";
  else if (samePlayerMarketSideCandidate.length) reason = "candidate_line_mismatch";
  else if (samePlayerMarketCandidate.length) reason = "candidate_side_mismatch";
  else if (samePlayerCandidate.length) reason = "candidate_market_missing";
  else if (exactBoard) reason = "on_board_but_not_in_production_candidates";
  else if (samePlayerBoard.length) reason = "player_on_board_but_prop_not_found";
  else reason = "player_missing_from_board_and_candidates";

  return {
    player: r.player,
    team: r.team,
    market: r.market,
    side: r.side,
    line: r.line,
    pfScore: r.pfScore,
    tier: r.tier,
    bucket: r.bucket,
    reason,
    candidateCounts: {
      samePlayer: samePlayerCandidate.length,
      samePlayerMarket: samePlayerMarketCandidate.length,
      samePlayerMarketSide: samePlayerMarketSideCandidate.length
    },
    boardCounts: {
      samePlayer: samePlayerBoard.length,
      samePlayerMarket: samePlayerMarketBoard.length,
      samePlayerMarketSide: samePlayerMarketSideBoard.length
    },
    closestCandidates: samePlayerCandidate.slice(0, 8).map(c => ({
      player: getPlayer(c),
      team: c.team,
      market: getMarket(c),
      side: getSide(c),
      line: getLine(c),
      prob: getProb(c),
      oldClass: c.oldClass || c.class || c.hardenedClass,
      tier: c.tier || c.oddsTier
    }))
  };
});

fs.writeFileSync(outFile, JSON.stringify({
  date,
  reportFile,
  candidatesFile,
  boardFile,
  reportRows: reportRows.length,
  missingModelProbRows: missing.length,
  byReason: audit.reduce((acc, r) => {
    acc[r.reason] = (acc[r.reason] || 0) + 1;
    return acc;
  }, {}),
  audit
}, null, 2));

console.log(`date=${date}`);
console.log(`reportRows=${reportRows.length}`);
console.log(`missingModelProbRows=${missing.length}`);

const byReason = {};
for (const r of audit) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
console.log("byReason=" + JSON.stringify(byReason, null, 2));

for (const r of audit.slice(0, 40)) {
  console.log(
    `${r.player} | ${r.market} ${r.side} ${r.line} | ${r.reason} | ` +
    `candidate=${JSON.stringify(r.candidateCounts)} | board=${JSON.stringify(r.boardCounts)}`
  );
}

console.log(`saved: ${outFile}`);
