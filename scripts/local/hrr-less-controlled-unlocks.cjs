const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const OUT_JSON = `outputs/hrr-less-controlled-unlocks-${DATE}.json`;
const OUT_LATEST = "outputs/hrr-less-controlled-unlocks-latest.json";
const OUT_TXT = `outputs/hrr-less-controlled-unlocks-${DATE}.txt`;
const OUT_TXT_LATEST = "outputs/hrr-less-controlled-unlocks-latest.txt";

const LEAN_FILES = [
  "outputs/lean-final-slips.json",
  `outputs/lean-final-slips-${DATE}.json`
];

const SOURCE_FILES = [
  "outputs/slips-priced.json",
  "outputs/slips-distribution-enriched.json",
  "outputs/final-slips.json",
  "outputs/blocked-final-candidates.json",
  "outputs/lean-watchlist-candidates.json",
  "outputs/production-candidates.json",
  `outputs/production-candidates-${DATE}.json`,
  "outputs/priced-board.json"
];

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function flat(v, out = []) {
  if (!v) return out;

  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }

  if (typeof v !== "object") return out;

  if (
    v.player || v.playerName || v.name ||
    v.market || v.stat || v.side || v.line ||
    v.prob || v.edge || v.grade || v.books
  ) {
    out.push(v);
  }

  for (const val of Object.values(v)) flat(val, out);
  return out;
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "hits runs rbis": "hrr",
    "hits run rbis": "hrr",
    "hits runs rbi": "hrr",
    "hits runs rb is": "hrr",
    "hits+runs+rbis": "hrr",
    "hrr": "hrr"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function player(r) {
  return r.player || r.playerName || r.name || null;
}

function getProb(r) {
  return num(
    r.prob ??
    r.recommendedProb ??
    r.pickProb ??
    r.adjustedProb ??
    r.winProb ??
    r.probability,
    null
  );
}

function getEdge(r) {
  return num(
    r.edge ??
    r.expectedValue ??
    r.ev ??
    r.trueEV ??
    r.trueEv ??
    r.modelEdge,
    null
  );
}

function getBooks(r) {
  return num(
    r.books ??
    r.bookCount ??
    r.supportingBooks ??
    r.marketBooks ??
    r.vegasBooks,
    0
  );
}

function getGrade(r) {
  return String(r.grade || r.marketGrade || r.vegasGrade || "UNKNOWN").toUpperCase();
}

function getTier(r) {
  return String(r.oddsTier || r.tier || "standard").toLowerCase();
}

function getSideBias(r) {
  return String(r.sideBias?.tier || r.sideBias || r.sideBiasTier || "").toUpperCase();
}

function key(r) {
  return [
    norm(player(r)),
    marketNorm(r.market || r.stat || r.statType),
    sideNorm(r.side || r.pick || r.recommendedSide),
    String(num(r.line ?? r.ppLine ?? r.prizepicksLine, ""))
  ].join("|");
}

function sourceLabel(file) {
  if (file.includes("slips-priced")) return "slipsPriced";
  if (file.includes("distribution")) return "distribution";
  if (file.includes("final-slips")) return "finalSlips";
  if (file.includes("blocked-final")) return "blockedFinal";
  if (file.includes("lean-watchlist")) return "leanWatchlist";
  if (file.includes("production")) return "production";
  if (file.includes("priced-board")) return "pricedBoard";
  return file;
}

function reasonsOf(r) {
  const all = [];
  if (Array.isArray(r.reasons)) all.push(...r.reasons);
  if (Array.isArray(r.reason)) all.push(...r.reason);
  if (typeof r.reason === "string") all.push(r.reason);
  if (typeof r.disabledReason === "string") all.push(r.disabledReason);
  if (Array.isArray(r.flags)) all.push(...r.flags);
  return all.map(x => String(x));
}

function isHrrLessCandidate(r) {
  const market = marketNorm(r.market || r.stat || r.statType);
  const side = sideNorm(r.side || r.pick || r.recommendedSide);
  const line = num(r.line ?? r.ppLine ?? r.prizepicksLine, null);
  const tier = getTier(r);

  if (!player(r)) return false;
  if (market !== "hrr") return false;
  if (side !== "LESS") return false;

  // PrizePicks rule: goblin/demon LESS is not playable.
  if (tier === "goblin" || tier === "demon") return false;

  // Start only with validated high-sample HRR LESS line buckets.
  if (![2.5, 3.5, 4.5].includes(line)) return false;

  return true;
}

function evaluate(r) {
  const prob = getProb(r);
  const edge = getEdge(r);
  const books = getBooks(r);
  const grade = getGrade(r);
  const sideBias = getSideBias(r);
  const misses = [];

  if (prob === null || prob < 0.63) misses.push("prob_below_63");
  if (edge === null || edge <= 0) misses.push("edge_not_positive");
  if (books < 2) misses.push("books_below_2");
  if (!["GREEN", "NEUTRAL", "UNKNOWN"].includes(grade)) misses.push(`grade_${grade.toLowerCase()}`);
  if (grade === "UNKNOWN" && books < 3) misses.push("unknown_grade_needs_3_books");
  if (sideBias.includes("NEGATIVE")) misses.push("negative_side_bias");

  return {
    clears: misses.length === 0,
    misses,
    prob,
    edge,
    books,
    grade,
    sideBias
  };
}

function normalizeUnlock(r, sourceSeen) {
  const evalResult = evaluate(r);
  const line = num(r.line ?? r.ppLine ?? r.prizepicksLine, null);

  return {
    date: DATE,
    class: evalResult.clears ? "CONTROLLED_HRR_LESS_LEAN" : "HRR_LESS_NO_UNLOCK",
    classification: evalResult.clears ? "CONTROLLED_HRR_LESS_LEAN" : "HRR_LESS_NO_UNLOCK",
    player: player(r),
    team: r.team || null,
    game: r.game || r.matchup || null,
    market: "hrr",
    side: "LESS",
    line,
    oddsTier: getTier(r),
    tier: getTier(r),
    prob: evalResult.prob,
    edge: evalResult.edge,
    books: evalResult.books,
    grade: evalResult.grade,
    sideBias: evalResult.sideBias || null,
    sourceSeen,
    originalReasons: reasonsOf(r),
    controlledStatus: evalResult.clears ? "CONTROLLED_LEAN_UNLOCK" : "NO_UNLOCK",
    nearMissReasons: evalResult.misses,
    officialEligible: false,
    stake: evalResult.clears ? "controlled lean / track 0.25u max" : "no bet",
    note: evalResult.clears
      ? "Controlled HRR LESS lean only. Not official until multi-slate production ROI validates."
      : "Does not clear controlled HRR LESS lean rules.",
    sourceCandidate: r
  };
}

const merged = new Map();

for (const file of SOURCE_FILES) {
  const data = read(file, null);
  if (!data) continue;

  for (const row of flat(data, [])) {
    if (!isHrrLessCandidate(row)) continue;

    const k = key(row);
    const existing = merged.get(k);
    const src = sourceLabel(file);

    if (!existing) {
      merged.set(k, {
        row,
        sourceSeen: [src]
      });
      continue;
    }

    if (!existing.sourceSeen.includes(src)) existing.sourceSeen.push(src);

    // Prefer row with more useful market support.
    const oldScore =
      (getBooks(existing.row) * 2) +
      (getGrade(existing.row) === "GREEN" ? 3 : getGrade(existing.row) === "NEUTRAL" ? 1 : 0) +
      (getProb(existing.row) || 0);

    const newScore =
      (getBooks(row) * 2) +
      (getGrade(row) === "GREEN" ? 3 : getGrade(row) === "NEUTRAL" ? 1 : 0) +
      (getProb(row) || 0);

    if (newScore > oldScore) existing.row = row;
  }
}

const rows = [...merged.values()]
  .map(x => normalizeUnlock(x.row, x.sourceSeen))
  .sort((a, b) =>
    Number(b.controlledStatus === "CONTROLLED_LEAN_UNLOCK") - Number(a.controlledStatus === "CONTROLLED_LEAN_UNLOCK") ||
    (Number(b.prob || 0) - Number(a.prob || 0)) ||
    (Number(b.edge || 0) - Number(a.edge || 0))
  );

const unlocks = rows.filter(r => r.controlledStatus === "CONTROLLED_LEAN_UNLOCK");

const report = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  rules: {
    market: "hrr",
    side: "LESS",
    allowedLines: [2.5, 3.5, 4.5],
    allowedTiers: ["standard"],
    minProb: 0.63,
    minEdge: "> 0",
    minBooks: 2,
    allowedGrades: ["GREEN", "NEUTRAL", "UNKNOWN if books >= 3"],
    officialEligible: false,
    note: "Controlled lean only. HRR LESS is promoted from research to lean/watch tracking, not official."
  },
  total: rows.length,
  controlledLeanUnlocks: unlocks.length,
  rows,
  unlocks
};

const txt = [
  "HRR LESS CONTROLLED LEAN UNLOCKS",
  "================================",
  `date: ${DATE}`,
  `total: ${rows.length}`,
  `controlledLeanUnlocks: ${unlocks.length}`,
  "",
  "CONTROLLED LEAN UNLOCKS",
  "-----------------------",
  ...(unlocks.length
    ? unlocks.map(r => `- ${r.player} | ${r.team || "?"} | HRR LESS ${r.line} | ${r.tier} | prob=${r.prob ?? "n/a"} | edge=${r.edge ?? "n/a"} | books=${r.books} | grade=${r.grade}`)
    : ["none"]),
  "",
  "TOP NO-UNLOCK NEAR MISSES",
  "-------------------------",
  ...rows
    .filter(r => r.controlledStatus !== "CONTROLLED_LEAN_UNLOCK")
    .slice(0, 20)
    .map(r => `- ${r.player} | ${r.team || "?"} | HRR LESS ${r.line} | prob=${r.prob ?? "n/a"} | edge=${r.edge ?? "n/a"} | books=${r.books} | grade=${r.grade} | misses=${r.nearMissReasons.join(",") || "n/a"}`)
].join("\n");

writeJson(OUT_JSON, report);
writeJson(OUT_LATEST, report);
writeText(OUT_TXT, txt);
writeText(OUT_TXT_LATEST, txt);

console.log(txt);
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_LATEST}`);
console.log(`saved: ${OUT_TXT}`);
console.log(`saved: ${OUT_TXT_LATEST}`);

// Inject into lean reports without overwriting existing shape.
for (const file of LEAN_FILES) {
  const current = read(file, null);
  if (!current) continue;

  const leanRows = unlocks.map(r => ({
    ...r,
    class: "CONTROLLED_HRR_LESS_LEAN",
    classification: "CONTROLLED_HRR_LESS_LEAN",
    candidateClass: "LEAN",
    stake: "controlled lean / track 0.25u max",
    officialEligible: false,
    source: "hrr-less-controlled-unlocks"
  }));

  let next;

  if (Array.isArray(current)) {
    const existingKeys = new Set(current.map(key));
    const toAdd = leanRows.filter(r => !existingKeys.has(key(r)));
    next = [...current, ...toAdd];
  } else if (current && typeof current === "object") {
    next = { ...current };
    const bucketName = Array.isArray(next.controlledHrrLessLeans)
      ? "controlledHrrLessLeans"
      : Array.isArray(next.leans)
        ? "leans"
        : Array.isArray(next.trackOnly)
          ? "trackOnly"
          : "controlledHrrLessLeans";

    const existing = Array.isArray(next[bucketName]) ? next[bucketName] : [];
    const existingKeys = new Set(existing.map(key));
    const toAdd = leanRows.filter(r => !existingKeys.has(key(r)));

    next[bucketName] = [...existing, ...toAdd];
    next.controlledHrrLessLeanCount = leanRows.length;
    next.hrrLessControlledUnlockReport = OUT_LATEST;
  } else {
    next = leanRows;
  }

  writeJson(file, next);
  console.log(`patched lean report: ${file}`);
}
