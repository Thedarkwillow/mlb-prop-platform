const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BOARD_FILES = [
  "outputs/sportsbook-enriched-board.json",
  "outputs/priced-board.json",
  `outputs/priced-board-${DATE}.json`
];

const TARGET_FILES = [
  "outputs/production-candidates.json",
  "outputs/high-probability-boards-latest.json",
  `outputs/high-probability-boards-${DATE}.json`,
  "outputs/lean-final-slips.json",
  `outputs/lean-final-slips-${DATE}.json`
];

const OUT_AUDIT_JSON = `outputs/synthetic-fantasy-support-audit-${DATE}.json`;
const OUT_AUDIT_TXT = `outputs/synthetic-fantasy-support-audit-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/synthetic-fantasy-support-audit-latest.json";
const OUT_LATEST_TXT = "outputs/synthetic-fantasy-support-audit-latest.txt";

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
    .replace(/[^a-z0-9.]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function asNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function playerOf(row) {
  return String(row?.player || row?.playerName || row?.name || row?.displayName || "");
}

function marketOf(row) {
  return String(row?.market || row?.statType || row?.stat_type || row?.prop || "").toLowerCase();
}

function sideOf(row) {
  return String(row?.side || row?.pick || row?.direction || "").toUpperCase();
}

function lineOf(row) {
  return row?.line ?? row?.target ?? row?.projectionLine ?? row?.propLine ?? row?.value;
}

function tierOf(row) {
  return String(row?.tier || row?.oddsTier || row?.payoutTier || "standard").toLowerCase();
}

function classOf(row) {
  return String(
    row?.class ||
    row?.candidateClass ||
    row?.bucket ||
    row?.status ||
    row?.decision ||
    ""
  ).toUpperCase();
}

function booksOf(row) {
  const vals = [
    row?.books,
    row?.bookCount,
    row?.bookSupport,
    row?.supportBooks,
    row?.matchedBooks,
    row?.sportsbookBookCount,
    row?.pricing?.books,
    row?.pricing?.bookCount,
    row?.vegas?.books,
    row?.vegas?.bookCount
  ];

  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  if (Array.isArray(row?.sportsbooks)) return row.sportsbooks.length;
  if (Array.isArray(row?.bookNames)) return row.bookNames.length;
  if (Array.isArray(row?.booksMatched)) return row.booksMatched.length;
  if (Array.isArray(row?.matchedBookNames)) return row.matchedBookNames.length;

  return 0;
}

function supportOf(row) {
  return String(
    row?.support ||
    row?.marketSupportFlag ||
    row?.bookSupportStatus ||
    row?.supportStatus ||
    ""
  ).toUpperCase();
}

function gradeOf(row) {
  return String(
    row?.grade ||
    row?.validationGrade ||
    row?.decisionGrade ||
    row?.qualityGrade ||
    ""
  ).toUpperCase();
}

function sideBiasOf(row) {
  const raw =
    row?.sideBias ??
    row?.sideBiasLabel ??
    row?.side_bias ??
    row?.fullBoardSideBias?.label ??
    row?.sideBiasSummary?.label ??
    "";
  if (typeof raw === "object" && raw) {
    return String(raw.label || raw.status || raw.bias || raw.sideBias || "UNKNOWN").toUpperCase();
  }
  return String(raw || "UNKNOWN").toUpperCase();
}

function probOf(row) {
  return asNum(row?.prob ?? row?.probability ?? row?.finalProb ?? row?.modelProbability, 0);
}

function edgeOf(row) {
  return asNum(row?.edge ?? row?.evEdge ?? row?.trueEdge ?? row?.expectedEdge, 0);
}

function isFantasyMarket(row) {
  const market = norm(marketOf(row));
  return market.includes("fantasy");
}

function isHitterFantasy(row) {
  const market = norm(marketOf(row));
  return market === "hitter_fantasy_score" || market.includes("hitter_fantasy");
}

function flattenRows(payload) {
  const out = [];
  const seen = new Set();

  function walk(v, path = "$") {
    if (!v || typeof v !== "object") return;
    if (seen.has(v)) return;
    seen.add(v);

    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }

    if (playerOf(v) && marketOf(v) && sideOf(v) && lineOf(v) !== undefined) {
      out.push({ row: v, path });
    }

    for (const [k, val] of Object.entries(v)) {
      if (k === "syntheticFantasySupport") continue;
      walk(val, `${path}.${k}`);
    }
  }

  walk(payload);
  return out;
}

function boardKey(row) {
  return norm(playerOf(row));
}

function buildComponentIndex(board) {
  const index = new Map();

  for (const { row } of flattenRows(board)) {
    const playerKey = boardKey(row);
    const market = norm(marketOf(row));
    const side = sideOf(row);
    if (!playerKey || side !== "MORE") continue;

    const componentMarkets = new Set([
      "hits",
      "bases",
      "total_bases",
      "runs",
      "rbis",
      "rbi",
      "walks",
      "stolen_bases",
      "singles"
    ]);

    if (!componentMarkets.has(market)) continue;

    const books = booksOf(row);
    const support = supportOf(row);
    const grade = gradeOf(row);
    const sportsbookMatch = row?.sportsbookMatch === true;

    if (books <= 0 && !sportsbookMatch) continue;

    if (!index.has(playerKey)) index.set(playerKey, []);

    index.get(playerKey).push({
      player: playerOf(row),
      market,
      side,
      line: lineOf(row),
      books,
      support: support || (books >= 2 ? "OK" : "LOW_BOOK_SUPPORT"),
      grade: grade || (books >= 2 ? "GREEN" : "NEUTRAL"),
      sportsbookMatch,
      sportsbookEdge: row?.sportsbookEdge ?? null,
      sportsbookAdjustedEdge: row?.sportsbookAdjustedEdge ?? null,
      sportsbookImpliedProb: row?.sportsbookImpliedProb ?? null
    });
  }

  return index;
}

function syntheticGrade(components) {
  const markets = new Set(components.map(c => c.market));
  const totalBooks = components.reduce((sum, c) => sum + asNum(c.books, 0), 0);
  const green = components.filter(c => String(c.grade).toUpperCase() === "GREEN").length;
  const ok = components.filter(c => String(c.support).toUpperCase() === "OK").length;

  if (markets.size >= 4 && totalBooks >= 10 && green >= 3 && ok >= 3) {
    return "SYNTHETIC_GREEN";
  }

  if (markets.size >= 3 && totalBooks >= 6 && ok >= 2) {
    return "SYNTHETIC_NEUTRAL";
  }

  if (markets.size >= 2 && totalBooks >= 3) {
    return "SYNTHETIC_LOW";
  }

  if (markets.size >= 1 && totalBooks >= 1) {
    return "SYNTHETIC_TRACE";
  }

  return "SYNTHETIC_UNKNOWN";
}

function shouldPatchFantasy(row) {
  if (!row || typeof row !== "object") return false;
  if (!isFantasyMarket(row)) return false;

  const support = supportOf(row);
  const grade = gradeOf(row);
  const books = booksOf(row);

  return (
    books <= 0 ||
    support === "PHASE8_UNPRICED" ||
    support === "NO_BOOK_SUPPORT" ||
    support === "UNKNOWN" ||
    grade === "UNKNOWN" ||
    !support ||
    !grade
  );
}

function patchFantasyRow(row, support) {
  if (!shouldPatchFantasy(row)) return false;

  row.books = support.syntheticBooks;
  row.support = support.syntheticSupport;
  row.grade = support.syntheticGrade;
  row.syntheticFantasySupport = support;

  row.fantasyResearchOnly = true;
  row.noBetReason = row.noBetReason || "fantasy_synthetic_support_research_only";
  row.syntheticSupportNote =
    "Fantasy score is not directly priced by sportsbooks; support is synthesized from component markets and remains research-only.";

  return true;
}

function summarizeComponents(components) {
  return components
    .sort((a, b) => {
      const bm = String(b.market).localeCompare(String(a.market));
      if (bm !== 0) return bm;
      return asNum(b.books) - asNum(a.books);
    })
    .map(c => ({
      market: c.market,
      line: c.line,
      books: c.books,
      support: c.support,
      grade: c.grade,
      sportsbookMatch: c.sportsbookMatch
    }));
}

function buildSyntheticSupport(row, componentIndex) {
  const playerKey = boardKey(row);
  const components = componentIndex.get(playerKey) || [];
  const unique = [];

  const seen = new Set();
  for (const c of components) {
    const key = `${c.market}|${c.line}|${c.support}|${c.grade}|${c.books}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  const grade = syntheticGrade(unique);
  const syntheticBooks = unique.reduce((sum, c) => sum + asNum(c.books, 0), 0);
  const componentMarkets = [...new Set(unique.map(c => c.market))];

  return {
    player: playerOf(row),
    market: marketOf(row),
    side: sideOf(row),
    line: lineOf(row),
    tier: tierOf(row),
    class: classOf(row),
    prob: probOf(row),
    edge: edgeOf(row),
    sideBias: sideBiasOf(row),
    syntheticSupport: grade,
    syntheticGrade: grade,
    syntheticBooks,
    componentMarketCount: componentMarkets.length,
    componentMarkets,
    components: summarizeComponents(unique),
    researchOnly: true,
    actionable: false,
    note: "Synthetic fantasy support only. Do not promote to official/actionable without validated fantasy ROI."
  };
}

function loadBoard() {
  for (const file of BOARD_FILES) {
    const payload = readJson(file, null);
    if (payload) return { file, payload };
  }
  return { file: null, payload: null };
}

function processFile(file, componentIndex) {
  const payload = readJson(file, null);
  if (!payload) {
    return {
      file,
      exists: false,
      rows: 0,
      fantasyRows: 0,
      patched: 0,
      unknown: 0,
      patchedRows: [],
      unknownRows: []
    };
  }

  const rows = flattenRows(payload);
  let fantasyRows = 0;
  let patched = 0;
  let unknown = 0;
  const patchedRows = [];
  const unknownRows = [];

  for (const { row, path } of rows) {
    if (!isFantasyMarket(row)) continue;
    fantasyRows++;

    const synthetic = buildSyntheticSupport(row, componentIndex);
    const changed = patchFantasyRow(row, synthetic);

    if (changed) {
      patched++;
      patchedRows.push({ file, path, ...synthetic });
    }

    if (synthetic.syntheticGrade === "SYNTHETIC_UNKNOWN") {
      unknown++;
      unknownRows.push({ file, path, ...synthetic });
    }
  }

  if (patched > 0) writeJson(file, payload);

  return {
    file,
    exists: true,
    rows: rows.length,
    fantasyRows,
    patched,
    unknown,
    patchedRows,
    unknownRows
  };
}

function formatRow(row, i) {
  return `${i + 1}. ${row.player} | ${row.market} ${row.side} ${row.line} | ${row.tier} | ${row.syntheticGrade} | syntheticBooks=${row.syntheticBooks} | componentMarkets=${row.componentMarkets.join(",") || "none"} | class=${row.class || "UNKNOWN"}`;
}

function main() {
  const { file: boardFile, payload: board } = loadBoard();
  if (!board) throw new Error("No board file found.");

  const componentIndex = buildComponentIndex(board);
  const results = TARGET_FILES.map(file => processFile(file, componentIndex));

  const patchedRows = results.flatMap(r => r.patchedRows || []);
  const unknownRows = results.flatMap(r => r.unknownRows || []);

  const audit = {
    date: DATE,
    boardFile,
    componentPlayers: componentIndex.size,
    summary: {
      files: results.length,
      fantasyRows: results.reduce((sum, r) => sum + r.fantasyRows, 0),
      patchedRows: patchedRows.length,
      unknownRows: unknownRows.length
    },
    files: results.map(r => ({
      file: r.file,
      exists: r.exists,
      rows: r.rows,
      fantasyRows: r.fantasyRows,
      patched: r.patched,
      unknown: r.unknown
    })),
    patchedRows,
    unknownRows,
    policy: {
      fantasySupportType: "synthetic_component_market_support",
      officialPromotionAllowed: false,
      actionableLeanAllowed: false,
      reason: "PrizePicks fantasy score is not directly priced by sportsbooks; support must be synthesized from component stat markets and validated separately."
    }
  };

  const lines = [];
  lines.push("SYNTHETIC FANTASY SUPPORT ENRICHMENT");
  lines.push("====================================");
  lines.push(`date: ${DATE}`);
  lines.push(`boardFile: ${boardFile}`);
  lines.push(`componentPlayers: ${componentIndex.size}`);
  lines.push("");
  lines.push("POLICY");
  lines.push("------");
  lines.push("- Fantasy score does not get normal direct sportsbook support.");
  lines.push("- Support is synthesized from component markets only.");
  lines.push("- Fantasy remains research-only until separate fantasy ROI validates it.");
  lines.push("");
  lines.push("FILES");
  lines.push("-----");
  for (const r of results) {
    lines.push(`${r.file} | rows=${r.rows} | fantasyRows=${r.fantasyRows} | patched=${r.patched} | unknown=${r.unknown}`);
  }
  lines.push("");
  lines.push("PATCHED FANTASY ROWS");
  lines.push("--------------------");
  if (!patchedRows.length) {
    lines.push("none");
  } else {
    patchedRows.slice(0, 80).forEach((r, i) => lines.push(formatRow(r, i)));
  }
  lines.push("");
  lines.push("UNKNOWN FANTASY ROWS");
  lines.push("--------------------");
  if (!unknownRows.length) {
    lines.push("none");
  } else {
    unknownRows.slice(0, 80).forEach((r, i) => lines.push(formatRow(r, i)));
  }

  writeJson(OUT_AUDIT_JSON, audit);
  writeJson(OUT_LATEST_JSON, audit);
  writeText(OUT_AUDIT_TXT, lines.join("\n"));
  writeText(OUT_LATEST_TXT, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log("");
  console.log(`saved: ${OUT_AUDIT_JSON}`);
  console.log(`saved: ${OUT_AUDIT_TXT}`);
}

main();
