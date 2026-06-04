const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const AUDIT_FILE = `outputs/unpriced-unknown-book-support-audit-${DATE}.json`;
const BOARD_FILE = "outputs/sportsbook-enriched-board.json";
const OUT_JSON = `outputs/unpriced-book-gap-classification-${DATE}.json`;
const OUT_TXT = `outputs/unpriced-book-gap-classification-${DATE}.txt`;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function playerOf(r) {
  return String(r?.player || r?.playerName || r?.name || r?.displayName || "");
}

function marketOf(r) {
  return String(r?.market || r?.statType || r?.stat_type || r?.prop || "").toLowerCase();
}

function sideOf(r) {
  return String(r?.side || r?.pick || r?.direction || "").toUpperCase();
}

function lineOf(r) {
  return r?.line ?? r?.target ?? r?.projectionLine ?? r?.propLine ?? r?.value;
}

function tierOf(r) {
  return String(r?.tier || r?.oddsTier || r?.payoutTier || "standard").toLowerCase();
}

function booksOf(r) {
  const vals = [
    r?.books,
    r?.bookCount,
    r?.bookSupport,
    r?.sportsbookBookCount,
    r?.matchedBooks,
    r?.pricing?.books,
    r?.pricing?.bookCount,
    r?.vegas?.books,
    r?.vegas?.bookCount
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Array.isArray(r?.sportsbooks)) return r.sportsbooks.length;
  if (Array.isArray(r?.bookNames)) return r.bookNames.length;
  if (Array.isArray(r?.booksMatched)) return r.booksMatched.length;
  if (Array.isArray(r?.matchedBookNames)) return r.matchedBookNames.length;
  return 0;
}

function supportOf(r) {
  return String(r?.support || r?.marketSupportFlag || r?.bookSupportStatus || r?.supportStatus || "").toUpperCase();
}

function gradeOf(r) {
  return String(r?.grade || r?.validationGrade || r?.decisionGrade || r?.qualityGrade || "").toUpperCase();
}

function flatten(v, out = [], seen = new Set()) {
  if (!v || typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out, seen);
    return out;
  }

  if (playerOf(v) && marketOf(v) && sideOf(v) && lineOf(v) !== undefined) {
    out.push(v);
  }

  for (const val of Object.values(v)) flatten(val, out, seen);
  return out;
}

function rowKey(r) {
  return [
    norm(playerOf(r)),
    norm(marketOf(r)),
    norm(sideOf(r)),
    String(lineOf(r) ?? "").trim()
  ].join("|");
}

function looseKey(r) {
  return [
    norm(playerOf(r)),
    norm(marketOf(r)),
    norm(sideOf(r))
  ].join("|");
}

function classOf(row, exact, loose) {
  const market = norm(marketOf(row));
  const tier = tierOf(row);
  const cls = String(row.class || row.candidateClass || "").toUpperCase();
  const support = supportOf(row);
  const grade = gradeOf(row);

  if (market.includes("fantasy")) {
    if (support === "SYNTHETIC_UNKNOWN" || grade === "SYNTHETIC_UNKNOWN") {
      return "FANTASY_SYNTHETIC_NO_COMPONENTS";
    }
    return "FANTASY_RESEARCH_ONLY";
  }

  if (market === "hrr") {
    if (exact?.books > 0) return "HRR_HAS_BOOK_SUPPORT_BUT_RESEARCH_ONLY";
    if (loose.length > 0) return "HRR_LINE_OR_TIER_NOT_SUPPORTED";
    return "HRR_NO_BOOK_ROW";
  }

  if (cls.includes("SHADOW") || cls.includes("BLOCKED")) {
    if (exact?.books > 0) return "SHADOW_BLOCKED_HAS_SUPPORT";
    if (loose.length > 0) return "SHADOW_BLOCKED_LINE_OR_TIER_NOT_SUPPORTED";
    return "SHADOW_BLOCKED_NO_BOOK_ROW";
  }

  if (exact?.books > 0) return "MATCHER_MISSED_EXACT_SUPPORTED_ROW";
  if (loose.length > 0) return "LINE_OR_TIER_NOT_SUPPORTED_AT_BOOKS";
  if (tier === "goblin" || tier === "demon") return "SPECIAL_TIER_NO_BOOK_ROW";
  return "NO_LOCAL_SPORTSBOOK_SOURCE_ROW";
}

const audit = readJson(AUDIT_FILE, {});
const board = readJson(BOARD_FILE, []);
const problemRows =
  audit.problemRowsList ||
  audit.problems ||
  audit.rows ||
  audit.problemRowsDetailed ||
  audit.topProblemRows ||
  [];

const boardRows = flatten(board);

const exactIndex = new Map();
const looseIndex = new Map();

for (const r of boardRows) {
  const exactKey = rowKey(r);
  const loose = looseKey(r);
  const rec = {
    player: playerOf(r),
    market: marketOf(r),
    side: sideOf(r),
    line: lineOf(r),
    tier: tierOf(r),
    books: booksOf(r),
    support: supportOf(r),
    grade: gradeOf(r),
    sportsbookMatch: Boolean(r.sportsbookMatch),
    matchedLine: r.sportsbookMatchedLine ?? r.sportsbookMatchedLine ?? r.sportsbookMatchedLine,
  };

  if (!exactIndex.has(exactKey) || rec.books > exactIndex.get(exactKey).books) {
    exactIndex.set(exactKey, rec);
  }

  if (!looseIndex.has(loose)) looseIndex.set(loose, []);
  looseIndex.get(loose).push(rec);
}

const classified = [];
const byClass = {};
const byMarket = {};

for (const row of problemRows) {
  const exact = exactIndex.get(rowKey(row)) || null;
  const loose = (looseIndex.get(looseKey(row)) || [])
    .sort((a, b) => (b.books || 0) - (a.books || 0))
    .slice(0, 8);

  const classification = classOf(row, exact, loose);
  byClass[classification] = (byClass[classification] || 0) + 1;

  const mk = `${marketOf(row)}|${sideOf(row)}|${tierOf(row)}`;
  byMarket[mk] = (byMarket[mk] || 0) + 1;

  classified.push({
    player: playerOf(row),
    market: marketOf(row),
    side: sideOf(row),
    line: lineOf(row),
    tier: tierOf(row),
    class: row.class || row.candidateClass || "",
    books: booksOf(row),
    support: supportOf(row),
    grade: gradeOf(row),
    classification,
    exactBookRow: exact,
    looseBookRows: loose
  });
}

classified.sort((a, b) => {
  const c = String(a.classification).localeCompare(String(b.classification));
  if (c) return c;
  return String(a.market).localeCompare(String(b.market));
});

const report = {
  date: DATE,
  auditFile: AUDIT_FILE,
  boardFile: BOARD_FILE,
  auditProblemRows: audit.problemRows ?? null,
  classifiedRows: classified.length,
  byClass,
  byMarket,
  rows: classified
};

const lines = [];
lines.push("UNPRICED BOOK GAP CLASSIFICATION");
lines.push("================================");
lines.push(`date: ${DATE}`);
lines.push(`auditProblemRows: ${audit.problemRows ?? "unknown"}`);
lines.push(`classifiedRows: ${classified.length}`);
lines.push("");
lines.push("BY CLASS");
lines.push("--------");
for (const [k, v] of Object.entries(byClass).sort((a,b) => b[1]-a[1])) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("BY MARKET / SIDE / TIER");
lines.push("-----------------------");
for (const [k, v] of Object.entries(byMarket).sort((a,b) => b[1]-a[1])) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("TOP ROWS");
lines.push("--------");
classified.slice(0, 80).forEach((r, i) => {
  lines.push(`${i + 1}. ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | ${r.classification}`);
  lines.push(`   current books=${r.books || 0} support=${r.support || "UNKNOWN"} grade=${r.grade || "UNKNOWN"} class=${r.class || ""}`);
  if (r.exactBookRow) {
    lines.push(`   exact=${r.exactBookRow.books} books | support=${r.exactBookRow.support || "UNKNOWN"} | grade=${r.exactBookRow.grade || "UNKNOWN"}`);
  } else if (r.looseBookRows.length) {
    lines.push(`   loose lines=${r.looseBookRows.map(x => `${x.line}:${x.books || 0}b:${x.support || "UNK"}`).join(", ")}`);
  } else {
    lines.push("   no local sportsbook source row found; not repairable without new odds data");
  }
});

writeJson(OUT_JSON, report);
writeText(OUT_TXT, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
