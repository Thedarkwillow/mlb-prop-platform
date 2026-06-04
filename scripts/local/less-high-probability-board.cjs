const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BOARD_FILES = [
  "outputs/priced-board.json",
  `outputs/priced-board-${DATE}.json`
];

const SOURCE_FILES = [
  "outputs/production-candidates.json",
  "outputs/lean-final-slips.json",
  `outputs/lean-final-slips-${DATE}.json`,
  "outputs/high-probability-boards-latest.json",
  `outputs/high-probability-boards-${DATE}.json`
];

const OUT_JSON = `outputs/less-high-probability-board-${DATE}.json`;
const OUT_TXT = `outputs/less-high-probability-board-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/less-high-probability-board-latest.json";
const OUT_LATEST_TXT = "outputs/less-high-probability-board-latest.txt";

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

function writeText(file, text) {
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
  if (m === "pitcher_outs") return "pitching_outs";
  return m;
}

function num(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : fallback;
}

function getProb(row) {
  const raw =
    row?.prob ??
    row?.probability ??
    row?.trueProbability ??
    row?.modelProbability ??
    row?.p ??
    null;

  const n = num(raw, null);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
}

function getEdge(row) {
  const raw =
    row?.edge ??
    row?.evEdge ??
    row?.trueEdge ??
    row?.modelEdge ??
    row?.expectedEdge ??
    null;

  const n = num(raw, null);
  if (n === null) return null;
  return n > 1 ? n / 100 : n;
}

function getBooks(row) {
  return num(
    row?.books ??
      row?.bookCount ??
      row?.supportingBooks ??
      row?.bookSupport ??
      row?.pricing?.books ??
      row?.pricing?.bookCount,
    0
  );
}

function sideBiasText(row) {
  const raw =
    row?.sideBias ??
    row?.side_bias ??
    row?.sideBiasLabel ??
    row?.sideBias?.label ??
    row?.sideBias?.bucket ??
    row?.sideBias?.status ??
    "";

  if (raw && typeof raw === "object") {
    return String(raw.label || raw.bucket || raw.status || raw.sideBias || raw.bias || "UNKNOWN").toUpperCase();
  }

  return String(raw || "UNKNOWN").toUpperCase();
}

function gradeText(row) {
  return String(row?.grade || row?.finalGrade || row?.pricingGrade || "UNKNOWN").toUpperCase();
}

function supportText(row) {
  return String(row?.support || row?.pricingSupport || row?.supportStatus || "UNKNOWN").toUpperCase();
}

function classText(row) {
  return String(
    row?.class ||
      row?.candidateClass ||
      row?.bucket ||
      row?.status ||
      row?.decision ||
      row?.recommendation ||
      "UNKNOWN"
  ).toUpperCase();
}

function playerName(row) {
  return (
    row?.player ||
    row?.playerName ||
    row?.name ||
    row?.participant ||
    row?.athlete ||
    ""
  );
}

function marketName(row) {
  return row?.market || row?.statType || row?.stat || row?.propType || "";
}

function rowKey(row) {
  return [
    norm(playerName(row)),
    normMarket(marketName(row)),
    String(row?.side || "").toUpperCase(),
    String(row?.line ?? row?.target ?? row?.threshold ?? "")
  ].join("|");
}

function boardKey(row) {
  return [
    norm(playerName(row)),
    normMarket(marketName(row)),
    String(row?.side || "").toUpperCase(),
    String(row?.line ?? row?.target ?? row?.threshold ?? "")
  ].join("|");
}

function flattenBoard(data) {
  const out = [];
  function walk(v) {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v !== "object") return;

    const player = playerName(v);
    const market = marketName(v);
    const side = String(v?.side || "").toUpperCase();
    const line = v?.line ?? v?.target ?? v?.threshold;

    if (player && market && side && line !== undefined && line !== null) {
      out.push(v);
    }

    for (const val of Object.values(v)) {
      if (val && typeof val === "object") walk(val);
    }
  }
  walk(data);
  return out;
}

function buildBoardKeySet() {
  for (const file of BOARD_FILES) {
    const data = readJson(file);
    const rows = flattenBoard(data);
    if (!rows.length) continue;

    const keys = new Set(rows.map(boardKey).filter(k => !k.includes("||")));
    return { file, keys };
  }

  return { file: null, keys: new Set() };
}

function flattenCandidates(payload) {
  const out = [];

  function add(row, forcedClass = null) {
    if (!row || typeof row !== "object") return;
    const player = playerName(row);
    const market = marketName(row);
    const side = String(row?.side || "").toUpperCase();
    const line = row?.line ?? row?.target ?? row?.threshold;

    if (!player || !market || !side || line === undefined || line === null) return;

    const copy = { ...row };
    if (forcedClass && !copy.class && !copy.candidateClass) copy.class = forcedClass;
    out.push(copy);
  }

  function walk(v, forcedClass = null) {
    if (!v) return;

    if (Array.isArray(v)) {
      for (const x of v) walk(x, forcedClass);
      return;
    }

    if (typeof v !== "object") return;

    const classKeys = {
      core: "CORE",
      CORE: "CORE",
      lean: "LEAN",
      LEAN: "LEAN",
      leans: "LEAN",
      watchlist: "WATCHLIST",
      WATCHLIST: "WATCHLIST",
      highProbabilityWatch: "HIGH_PROBABILITY_WATCH",
      high_probability_watch: "HIGH_PROBABILITY_WATCH",
      research: "RESEARCH",
      RESEARCH: "RESEARCH",
      blocked: "BLOCKED",
      BLOCKED: "BLOCKED",
      shadowBlocked: "SHADOW_BLOCKED",
      shadow_blocked: "SHADOW_BLOCKED",
      SHADOW_BLOCKED: "SHADOW_BLOCKED",
      actionableHighProbability: "ACTIONABLE_HIGH_PROBABILITY",
      goblinActionableWatch: "GOBLIN_ACTIONABLE_WATCH",
      goblinFantasyResearch: "GOBLIN_FANTASY_RESEARCH",
      hrrMoreResearch: "HRR_MORE_RESEARCH",
      researchHighProbabilityNonHrrNonFantasy: "RESEARCH",
      shadowHighProbability: "SHADOW_BLOCKED",
      blockedHighProbability: "BLOCKED"
    };

    for (const [key, cls] of Object.entries(classKeys)) {
      if (Array.isArray(v[key])) {
        for (const row of v[key]) walk(row, cls);
      }
    }

    if (Array.isArray(v.rows)) for (const row of v.rows) walk(row, forcedClass);
    if (Array.isArray(v.candidates)) for (const row of v.candidates) walk(row, forcedClass);
    if (Array.isArray(v.all)) for (const row of v.all) walk(row, forcedClass);

    add(v, forcedClass);
  }

  walk(payload);
  return out;
}

function collectRows() {
  const rows = [];

  for (const file of SOURCE_FILES) {
    const data = readJson(file);
    if (!data) continue;
    for (const row of flattenCandidates(data)) {
      rows.push({ ...row, sourceFile: file });
    }
  }

  const seen = new Set();
  const unique = [];

  for (const row of rows) {
    const key = rowKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return unique;
}

function isLess(row) {
  return String(row?.side || "").toUpperCase() === "LESS";
}

function isFantasy(row) {
  return /fantasy/i.test(String(marketName(row)));
}

function isHrr(row) {
  return normMarket(marketName(row)) === "hrr";
}

function isGoblin(row) {
  return String(row?.tier || row?.oddsTier || "").toLowerCase() === "goblin";
}

function isResearch(row) {
  const cls = classText(row);
  return cls.includes("RESEARCH");
}

function isShadow(row) {
  const cls = classText(row);
  return cls.includes("SHADOW");
}

function isBlocked(row) {
  const cls = classText(row);
  return cls.includes("BLOCKED") && !cls.includes("SHADOW");
}

function isCore(row) {
  return classText(row).includes("CORE");
}

function isLean(row) {
  return classText(row).includes("LEAN");
}

function isWatch(row) {
  return classText(row).includes("WATCH");
}

function hasGoodSupport(row) {
  const support = supportText(row);
  const books = getBooks(row);
  return support === "OK" || books >= 2;
}

function goodGrade(row) {
  const g = gradeText(row);
  return g === "GREEN" || g === "NEUTRAL";
}

function isNegativeSide(row) {
  return sideBiasText(row).includes("NEGATIVE");
}

function isCurrentSlate(row, boardKeys) {
  if (!boardKeys || boardKeys.size === 0) return true;
  return boardKeys.has(rowKey(row));
}

function sortRows(rows) {
  return rows.sort((a, b) => {
    const pa = getProb(a) ?? 0;
    const pb = getProb(b) ?? 0;
    if (pb !== pa) return pb - pa;

    const ea = getEdge(a) ?? 0;
    const eb = getEdge(b) ?? 0;
    if (eb !== ea) return eb - ea;

    return String(playerName(a)).localeCompare(String(playerName(b)));
  });
}

function line(row, i) {
  const prob = getProb(row);
  const edge = getEdge(row);
  const books = getBooks(row);
  return `${i + 1}. ${playerName(row)} | ${row?.team || ""} | ${marketName(row)} ${String(row?.side || "").toUpperCase()} ${row?.line ?? row?.target ?? row?.threshold} | ${row?.tier || row?.oddsTier || "standard"} | prob=${prob === null ? "n/a" : (prob * 100).toFixed(2) + "%"} | edge=${edge === null ? "n/a" : (edge * 100).toFixed(2) + "%"} | books=${books} | grade=${gradeText(row)} | support=${supportText(row)} | sideBias=${sideBiasText(row)} | class=${classText(row)}`;
}

function section(title, rows, limit = 20) {
  const out = [];
  out.push(title);
  out.push("-".repeat(title.length));
  if (!rows.length) {
    out.push("none");
    return out;
  }

  rows.slice(0, limit).forEach((row, i) => out.push(line(row, i)));
  return out;
}

function main() {
  const { file: boardFile, keys: boardKeys } = buildBoardKeySet();
  const allRows = collectRows();

  // PrizePicks/priced-board often stores only MORE-side board rows.
  // Production candidates can still contain model-generated LESS rows for the current slate.
  // Do not require LESS candidates to have an exact LESS key in priced-board, or the LESS report will be empty.
  const lessRows = allRows.filter(row => isLess(row) && (
    isCurrentSlate(row, boardKeys) ||
    /production-candidates|lean-final-slips|high-probability/i.test(String(row._sourceFile || row.sourceFile || row.source || ""))
  ));

  const actionableLess = sortRows(lessRows.filter(row => {
    const prob = getProb(row) ?? 0;
    return (
      prob >= 0.6 &&
      !isGoblin(row) &&
      !isFantasy(row) &&
      !isHrr(row) &&
      !isResearch(row) &&
      !isShadow(row) &&
      !isBlocked(row) &&
      hasGoodSupport(row) &&
      goodGrade(row) &&
      !isNegativeSide(row)
    );
  }));

  const coreLeanLess = sortRows(lessRows.filter(row => {
    const prob = getProb(row) ?? 0;
    return (
      prob >= 0.55 &&
      !isGoblin(row) &&
      !isFantasy(row) &&
      !isHrr(row) &&
      !isResearch(row) &&
      !isShadow(row) &&
      !isBlocked(row) &&
      (isCore(row) || isLean(row)) &&
      hasGoodSupport(row) &&
      goodGrade(row)
    );
  }));

  const watchlistLess = sortRows(lessRows.filter(row => {
    const prob = getProb(row) ?? 0;
    return (
      prob >= 0.55 &&
      !isFantasy(row) &&
      !isHrr(row) &&
      !isResearch(row) &&
      !isShadow(row) &&
      !isBlocked(row) &&
      isWatch(row)
    );
  }));

  const pitcherLess = sortRows(lessRows.filter(row => {
    const prob = getProb(row) ?? 0;
    const market = normMarket(marketName(row));
    return (
      prob >= 0.55 &&
      ["pitching_outs", "strikeouts", "hits_allowed", "walks_allowed", "runs_allowed", "earned_runs_allowed"].includes(market) &&
      !isFantasy(row) &&
      !isHrr(row)
    );
  }));

  const hitterLess = sortRows(lessRows.filter(row => {
    const prob = getProb(row) ?? 0;
    const market = normMarket(marketName(row));
    return (
      prob >= 0.55 &&
      !["pitching_outs", "strikeouts", "hits_allowed", "walks_allowed", "runs_allowed", "earned_runs_allowed"].includes(market) &&
      !isFantasy(row) &&
      !isHrr(row)
    );
  }));

  const blockedLess = sortRows(lessRows.filter(row => {
    const prob = getProb(row) ?? 0;
    return prob >= 0.55 && isBlocked(row);
  }));

  const researchLess = sortRows(lessRows.filter(row => {
    const prob = getProb(row) ?? 0;
    return prob >= 0.55 && (isResearch(row) || isShadow(row));
  }));

  const result = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    boardFile,
    boardKeys: boardKeys.size,
    counts: {
      allLessRows: lessRows.length,
      actionableLess: actionableLess.length,
      coreLeanLess: coreLeanLess.length,
      watchlistLess: watchlistLess.length,
      pitcherLess: pitcherLess.length,
      hitterLess: hitterLess.length,
      blockedLess: blockedLess.length,
      researchLess: researchLess.length
    },
    rules: [
      "LESS board is current-slate only.",
      "ACTIONABLE LESS excludes goblins, fantasy, HRR, research, shadow, blocked, LOW_BOOK_SUPPORT, FADE, UNKNOWN grade, and NEGATIVE side bias.",
      "CORE/LEAN LESS keeps strict current-slate less candidates even if probability is below official floor.",
      "WATCHLIST LESS is track-only.",
      "BLOCKED/RESEARCH LESS are no-bet buckets."
    ],
    actionableLess,
    coreLeanLess,
    watchlistLess,
    pitcherLess,
    hitterLess,
    blockedLess,
    researchLess
  };

  const txt = [];
  txt.push("LESS HIGH PROBABILITY BOARD");
  txt.push("===========================");
  txt.push(`date: ${DATE}`);
  txt.push(`boardFile: ${boardFile || "none"}`);
  txt.push(`boardKeys: ${boardKeys.size}`);
  txt.push("");
  txt.push("Rules:");
  for (const r of result.rules) txt.push(`- ${r}`);
  txt.push("");
  txt.push(...section("ACTIONABLE LESS", actionableLess));
  txt.push("");
  txt.push(...section("CORE / LEAN LESS", coreLeanLess));
  txt.push("");
  txt.push(...section("WATCHLIST LESS", watchlistLess));
  txt.push("");
  txt.push(...section("PITCHER LESS", pitcherLess));
  txt.push("");
  txt.push(...section("HITTER LESS", hitterLess));
  txt.push("");
  txt.push(...section("BLOCKED LESS", blockedLess));
  txt.push("");
  txt.push(...section("RESEARCH / SHADOW LESS", researchLess));

  writeJson(OUT_JSON, result);
  writeJson(OUT_LATEST_JSON, result);
  writeText(OUT_TXT, txt.join("\n"));
  writeText(OUT_LATEST_TXT, txt.join("\n"));

  console.log(txt.join("\n"));
  console.log("");
  console.log(`saved: ${OUT_JSON}`);
  console.log(`saved: ${OUT_TXT}`);
}

main();
