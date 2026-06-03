const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = [
  "outputs/high-probability-boards-latest.json",
  `outputs/high-probability-boards-${DATE}.json`,
  "outputs/production-candidates.json",
  "outputs/lean-final-slips.json",
  `outputs/lean-final-slips-${DATE}.json`
];

const OUT_JSON = `outputs/unpriced-unknown-book-support-audit-${DATE}.json`;
const OUT_TXT = `outputs/unpriced-unknown-book-support-audit-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/unpriced-unknown-book-support-audit-latest.json";
const OUT_LATEST_TXT = "outputs/unpriced-unknown-book-support-audit-latest.txt";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeTxt(file, lines) {
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normMarket(market) {
  const m = norm(market);
  if (m === "total_bases") return "bases";
  if (m === "rbis" || m === "rbi") return "rbis";
  if (m === "earned_runs") return "earned_runs_allowed";
  if (m === "hits_allowed") return "hits_allowed";
  if (m === "walks_allowed") return "walks_allowed";
  if (m === "runs_allowed") return "runs_allowed";
  if (m === "hitter_fantasy_score") return "hitter_fantasy_score";
  if (m === "pitcher_fantasy_score") return "pitcher_fantasy_score";
  return m;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getPlayer(row) {
  return (
    row?.player ||
    row?.playerName ||
    row?.name ||
    row?.athleteName ||
    row?.description ||
    ""
  );
}

function getMarket(row) {
  return row?.market || row?.statType || row?.type || row?.propType || "";
}

function getSide(row) {
  return String(row?.side || row?.direction || row?.pick || "").toUpperCase();
}

function getLine(row) {
  return num(row?.line ?? row?.threshold ?? row?.target ?? row?.value);
}

function getProb(row) {
  return num(row?.prob ?? row?.probability ?? row?.p ?? row?.hitProbability);
}

function getEdge(row) {
  return num(row?.edge ?? row?.evEdge ?? row?.edgePct);
}

function getTier(row) {
  return String(row?.tier || row?.oddsTier || row?.projectionType || "standard").toLowerCase();
}

function getGrade(row) {
  return String(row?.grade || row?.finalGrade || row?.bookGrade || "UNKNOWN").toUpperCase();
}

function getSupport(row) {
  return String(row?.support || row?.bookSupport || row?.pricingSupport || row?.supportStatus || "").toUpperCase();
}

function getBooks(row) {
  const candidates = [
    row?.books,
    row?.bookCount,
    row?.numBooks,
    row?.matchedBooks,
    row?.pricing?.books,
    row?.pricing?.bookCount
  ];
  for (const v of candidates) {
    const n = num(v);
    if (n !== null) return n;
  }
  if (Array.isArray(row?.sportsbooks)) return row.sportsbooks.length;
  if (Array.isArray(row?.booksMatched)) return row.booksMatched.length;
  return 0;
}

function getSideBias(row) {
  const raw =
    row?.sideBias ||
    row?.sideBiasLabel ||
    row?.marketSideBias ||
    row?.bias ||
    row?.sideBias?.label ||
    row?.sideBias?.bucket ||
    "";
  if (raw && typeof raw === "object") {
    return String(raw.label || raw.bucket || raw.status || raw.sideBias || "UNKNOWN").toUpperCase();
  }
  return String(raw || "UNKNOWN").toUpperCase();
}

function getClass(row) {
  return String(
    row?.class ||
    row?.candidateClass ||
    row?.bucket ||
    row?.status ||
    row?.decision ||
    row?.recommendation ||
    ""
  ).toUpperCase();
}

function flatten(payload, out = []) {
  if (!payload) return out;

  if (Array.isArray(payload)) {
    for (const x of payload) flatten(x, out);
    return out;
  }

  if (typeof payload !== "object") return out;

  const directKeys = [
    "all",
    "rows",
    "candidates",
    "actionableHighProbability",
    "goblinActionableWatch",
    "goblinFantasyResearch",
    "hrrMoreResearch",
    "researchHighProbabilityNonHrrNonFantasy",
    "shadowHighProbability",
    "blockedHighProbability",
    "core",
    "lean",
    "watchlist",
    "research",
    "blocked",
    "shadowBlocked",
    "shadow_blocked",
    "highProbabilityWatch",
    "high_probability_watch"
  ];

  let usedDirect = false;
  for (const key of directKeys) {
    if (Array.isArray(payload[key])) {
      usedDirect = true;
      for (const x of payload[key]) flatten(x, out);
    }
  }

  const looksLikeProp =
    getPlayer(payload) &&
    getMarket(payload) &&
    getSide(payload) &&
    getLine(payload) !== null;

  if (looksLikeProp) out.push(payload);

  if (!usedDirect && !looksLikeProp) {
    for (const v of Object.values(payload)) {
      if (Array.isArray(v)) flatten(v, out);
    }
  }

  return out;
}

function keyOf(row) {
  return [
    norm(getPlayer(row)),
    normMarket(getMarket(row)),
    getSide(row),
    getLine(row)
  ].join("|");
}

function reason(row) {
  const market = normMarket(getMarket(row));
  const side = getSide(row);
  const tier = getTier(row);
  const grade = getGrade(row);
  const support = getSupport(row);
  const books = getBooks(row);
  const sideBias = getSideBias(row);
  const cls = getClass(row);

  const reasons = [];

  if (support === "PHASE8_UNPRICED") reasons.push("PHASE8_UNPRICED");
  if (books <= 0) reasons.push("NO_BOOK_SUPPORT");
  if (grade === "UNKNOWN") reasons.push("UNKNOWN_GRADE");
  if (support === "LOW_BOOK_SUPPORT") reasons.push("LOW_BOOK_SUPPORT");
  if (grade === "FADE") reasons.push("FADE_GRADE");
  if (sideBias.includes("NEGATIVE")) reasons.push("NEGATIVE_SIDE_BIAS");
  if (cls.includes("SHADOW")) reasons.push("SHADOW_ONLY");
  if (cls.includes("BLOCKED")) reasons.push("BLOCKED");
  if (cls.includes("RESEARCH")) reasons.push("RESEARCH_ONLY");
  if (tier === "goblin") reasons.push("GOBLIN");
  if (market === "hrr" && side === "MORE") reasons.push("HRR_MORE_RESEARCH");
  if (market.includes("fantasy")) reasons.push("FANTASY_MARKET");

  return reasons;
}

function fixPath(row) {
  const market = normMarket(getMarket(row));
  const side = getSide(row);
  const tier = getTier(row);
  const grade = getGrade(row);
  const support = getSupport(row);
  const books = getBooks(row);
  const cls = getClass(row);

  if (market.includes("fantasy")) {
    return "Keep research until fantasy market has validated pricing/grade rules.";
  }

  if (market === "hrr" && side === "MORE") {
    return "Keep separate HRR MORE research until approved promotion rules exist.";
  }

  if (cls.includes("SHADOW")) {
    return "Do not auto-promote; inspect why shadow rule fired, then approve bucket manually if validated.";
  }

  if (cls.includes("BLOCKED")) {
    return "Respect block unless specific block reason is repaired by pricing/grade/side-bias validation.";
  }

  if (support === "PHASE8_UNPRICED" || books <= 0) {
    return "Repair sportsbook matcher if this market exists at books; otherwise keep unpriced/research.";
  }

  if (grade === "UNKNOWN") {
    return "Build or backfill validation bucket; promote only after minimum sample clears.";
  }

  if (tier === "goblin") {
    return "Goblin requires separate promotion rule; do not mix with standard actionable board.";
  }

  return "No obvious blocker; inspect threshold rules.";
}

const rowsByKey = new Map();

for (const file of FILES) {
  const payload = readJson(file, null);
  if (!payload) continue;
  for (const row of flatten(payload)) {
    const key = keyOf(row);
    if (!key || key.includes("||")) continue;
    const existing = rowsByKey.get(key) || {};
    rowsByKey.set(key, { ...existing, ...row, _sources: [...(existing._sources || []), file] });
  }
}

const rows = [...rowsByKey.values()]
  .map(row => ({
    player: getPlayer(row),
    market: normMarket(getMarket(row)),
    side: getSide(row),
    line: getLine(row),
    tier: getTier(row),
    prob: getProb(row),
    edge: getEdge(row),
    books: getBooks(row),
    support: getSupport(row) || "UNKNOWN",
    grade: getGrade(row),
    sideBias: getSideBias(row),
    class: getClass(row) || "UNKNOWN",
    reasons: reason(row),
    fixPath: fixPath(row),
    sources: row._sources || []
  }))
  .sort((a, b) => (b.prob || 0) - (a.prob || 0));

const problemRows = rows.filter(r =>
  r.reasons.includes("PHASE8_UNPRICED") ||
  r.reasons.includes("NO_BOOK_SUPPORT") ||
  r.reasons.includes("UNKNOWN_GRADE")
);

const byReason = {};
for (const r of problemRows) {
  for (const reason of r.reasons) {
    byReason[reason] = (byReason[reason] || 0) + 1;
  }
}

const byMarket = {};
for (const r of problemRows) {
  const key = `${r.market}|${r.side}|${r.tier}`;
  byMarket[key] = (byMarket[key] || 0) + 1;
}

const output = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  totalRows: rows.length,
  problemRows: problemRows.length,
  byReason,
  byMarket,
  rows: problemRows
};

const lines = [];
lines.push("UNPRICED / UNKNOWN / NO-BOOK SUPPORT AUDIT");
lines.push("==========================================");
lines.push(`date: ${DATE}`);
lines.push(`totalRows: ${rows.length}`);
lines.push(`problemRows: ${problemRows.length}`);
lines.push("");
lines.push("BY REASON");
lines.push("---------");
for (const [k, v] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("BY MARKET / SIDE / TIER");
lines.push("-----------------------");
for (const [k, v] of Object.entries(byMarket).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("TOP PROBLEM ROWS");
lines.push("----------------");
for (const [i, r] of problemRows.slice(0, 80).entries()) {
  lines.push(
    `${i + 1}. ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | prob=${r.prob === null ? "n/a" : (r.prob * 100).toFixed(2) + "%"} | edge=${r.edge === null ? "n/a" : (r.edge * 100).toFixed(2) + "%"} | books=${r.books} | support=${r.support} | grade=${r.grade} | sideBias=${r.sideBias} | class=${r.class}`
  );
  lines.push(`   reasons=${r.reasons.join(",")}`);
  lines.push(`   fix=${r.fixPath}`);
}

writeJson(OUT_JSON, output);
writeJson(OUT_LATEST_JSON, output);
writeTxt(OUT_TXT, lines);
writeTxt(OUT_LATEST_TXT, lines);

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
