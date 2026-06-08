const fs = require("fs");
const path = require("path");

function argDate() {
  const eq = process.argv.find(x => x.startsWith("--date="));
  if (eq) return eq.split("=")[1];
  const plain = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return plain || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const CARD = "outputs/goblin-recommended-card.json";
const BOARD = "outputs/priced-board.json";
const OUT = CARD;
const REPORT = "outputs/goblin-current-card-filter-report.txt";
const JSON_REPORT = "outputs/goblin-current-card-filter-report.json";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.statType || v.line) out.push(v);
  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flat(x, out);
  }
  return out;
}

function s(v) {
  return String(v ?? "").trim();
}

function norm(v) {
  return s(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}

function team(r) {
  return s(r.team || r.teamAbbr || r.playerTeam);
}

function market(r) {
  return norm(r.market || r.statType || r.projectionType || r.stat);
}

function side(r) {
  return s(r.side || r.pickSide || r.recommendation).toUpperCase();
}

function line(r) {
  const n = Number(r.line ?? r.targetLine ?? r.projectionLine);
  return Number.isFinite(n) ? n : null;
}

function game(r) {
  return s(r.game || r.matchup || r.gameText);
}

function tier(r) {
  return norm(r.tier || r.oddsTier || r.projectionTypeTier || r.type || r.payoutType);
}

function isGoblinLike(r) {
  const t = tier(r);
  const txt = [
    r.tier,
    r.oddsTier,
    r.type,
    r.source,
    r.sourceType,
    r.label,
    r.payoutType,
    r.riskStatus,
    r.sampleStatus
  ].map(s).join(" ").toLowerCase();

  return t.includes("goblin") || txt.includes("goblin");
}

function key(r) {
  return [
    norm(player(r)),
    norm(team(r)),
    norm(game(r)),
    market(r),
    side(r),
    String(line(r))
  ].join("|");
}

function looseKey(r) {
  return [
    norm(player(r)),
    market(r),
    side(r),
    String(line(r))
  ].join("|");
}

function cleanProb(r) {
  const n = Number(r.probability ?? r.prob ?? r.projectedProbability ?? r.winProbability);
  return Number.isFinite(n) ? n : 0;
}

const cardRaw = readJson(CARD, []);
const boardRaw = readJson(BOARD, []);
const cardRows = flat(cardRaw);
const boardRows = flat(boardRaw);

const boardExact = new Map();
const boardLoose = new Map();
for (const r of boardRows) {
  const p = player(r);
  const m = market(r);
  const sd = side(r);
  const ln = line(r);
  if (!p || !m || !sd || ln === null) continue;

  const exact = key(r);
  const loose = looseKey(r);

  if (!boardExact.has(exact)) boardExact.set(exact, []);
  boardExact.get(exact).push(r);

  if (!boardLoose.has(loose)) boardLoose.set(loose, []);
  boardLoose.get(loose).push(r);
}

const kept = [];
const blocked = [];
const seen = new Map();

for (const r of cardRows) {
  const p = player(r);
  const m = market(r);
  const sd = side(r);
  const ln = line(r);
  const g = game(r);

  const reasons = [];

  if (!p) reasons.push("missing_player");
  if (!m) reasons.push("missing_market");
  if (!sd) reasons.push("missing_side");
  if (ln === null) reasons.push("missing_line");

  if (sd && sd !== "MORE") reasons.push("goblin_must_be_more_only");

  const exactMatches = boardExact.get(key(r)) || [];
  const looseMatches = boardLoose.get(looseKey(r)) || [];

  let match = null;
  let matchType = "none";

  if (exactMatches.length === 1) {
    match = exactMatches[0];
    matchType = "exact_current_board";
  } else if (exactMatches.length > 1) {
    match = exactMatches[0];
    matchType = "exact_current_board_multi";
  } else if (looseMatches.length === 1) {
    match = looseMatches[0];
    matchType = "loose_current_board";
  } else if (looseMatches.length > 1) {
    reasons.push("ambiguous_current_board_match");
  } else {
    reasons.push("not_on_current_priced_board");
  }

  if (match && !isGoblinLike(match) && !isGoblinLike(r)) {
    reasons.push("not_confirmed_goblin_tier");
  }

  const dedupeKey = [
    norm(p),
    norm(team(match || r)),
    norm(game(match || r)),
    m,
    sd,
    String(ln)
  ].join("|");

  if (seen.has(dedupeKey)) {
    const prev = seen.get(dedupeKey);
    if (cleanProb(r) > cleanProb(prev.row)) {
      prev.row = r;
      prev.match = match;
      prev.matchType = matchType;
    }
    reasons.push("duplicate_card_row");
  }

  if (reasons.length) {
    blocked.push({
      ...r,
      slateDate: DATE,
      currentBoardVerified: Boolean(match),
      currentBoardMatchType: matchType,
      blockReasons: reasons
    });
    continue;
  }

  if (!seen.has(dedupeKey)) {
    const enriched = {
      ...r,
      player: p,
      team: team(match || r) || team(r),
      game: game(match || r) || g,
      market: m,
      side: sd,
      line: ln,
      slateDate: DATE,
      generatedAt: new Date().toISOString(),
      currentBoardVerified: true,
      currentBoardMatchType: matchType,
      riskStatus: r.riskStatus || "GOBLIN_GATE_REVIEW",
      sampleStatus: r.sampleStatus || "GOBLIN_SAMPLE_PENDING",
      source: r.source || "goblin_current_card_filter"
    };
    seen.set(dedupeKey, { row: enriched, match, matchType });
    kept.push(enriched);
  }
}

kept.sort((a, b) => cleanProb(b) - cleanProb(a));

writeJson(OUT, kept);

const byReason = {};
for (const r of blocked) {
  for (const reason of r.blockReasons || []) {
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  inputRows: cardRows.length,
  keptRows: kept.length,
  blockedRows: blocked.length,
  byReason,
  keptSample: kept.slice(0, 30).map(r => ({
    player: player(r),
    team: team(r),
    game: game(r),
    market: market(r),
    side: side(r),
    line: line(r),
    probability: cleanProb(r),
    riskStatus: r.riskStatus,
    sampleStatus: r.sampleStatus,
    currentBoardMatchType: r.currentBoardMatchType
  })),
  blockedSample: blocked.slice(0, 40).map(r => ({
    player: player(r),
    team: team(r),
    game: game(r),
    market: market(r),
    side: side(r),
    line: line(r),
    probability: cleanProb(r),
    reasons: r.blockReasons
  }))
};

writeJson(JSON_REPORT, report);

const lines = [];
lines.push("GOBLIN CURRENT CARD FILTER");
lines.push("==========================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`date=${DATE}`);
lines.push(`inputRows=${report.inputRows}`);
lines.push(`keptRows=${report.keptRows}`);
lines.push(`blockedRows=${report.blockedRows}`);
lines.push("");
lines.push("BLOCKED REASONS");
lines.push("---------------");
for (const [k, v] of Object.entries(byReason).sort((a,b)=>b[1]-a[1])) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("KEPT SAMPLE");
lines.push("-----------");
for (const r of report.keptSample) {
  lines.push(`${r.player} | ${r.team} | ${r.game} | ${r.market} ${r.side} ${r.line} | prob=${r.probability} | risk=${r.riskStatus} | match=${r.currentBoardMatchType}`);
}
lines.push("");
lines.push("BLOCKED SAMPLE");
lines.push("--------------");
for (const r of report.blockedSample) {
  lines.push(`${r.player} | ${r.team} | ${r.game} | ${r.market} ${r.side} ${r.line} | prob=${r.probability} | reasons=${r.reasons.join(",")}`);
}

writeText(REPORT, lines.join("\n") + "\n");

console.log({
  date: DATE,
  inputRows: report.inputRows,
  keptRows: report.keptRows,
  blockedRows: report.blockedRows,
  byReason
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${REPORT}`);
