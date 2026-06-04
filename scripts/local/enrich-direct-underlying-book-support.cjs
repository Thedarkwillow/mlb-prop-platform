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

const OUT_AUDIT_JSON = `outputs/direct-underlying-book-support-audit-${DATE}.json`;
const OUT_AUDIT_TXT = `outputs/direct-underlying-book-support-audit-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/direct-underlying-book-support-audit-latest.json";
const OUT_LATEST_TXT = "outputs/direct-underlying-book-support-audit-latest.txt";

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

function readRemainingProblemRows() {
  const audit =
    readJson(`outputs/unpriced-unknown-book-support-audit-${DATE}.json`, null) ||
    readJson("outputs/unpriced-unknown-book-support-audit-latest.json", null) ||
    {};
  return Number(
    audit?.problemRows ??
    audit?.summary?.problemRows ??
    audit?.counts?.problemRows ??
    0
  ) || 0;
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
  return String(row?.market || row?.statType || row?.stat_type || row?.prop || "");
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

function booksOf(row) {
  const vals = [
    row?.books,
    row?.bookCount,
    row?.bookSupport,
    row?.supportBooks,
    row?.matchedBooks,
    row?.sportsbookBookCount,
    row?.sportsbook?.bookCount,
    row?.sportsbook?.books,
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

function keyOf(row) {
  const player = norm(playerOf(row));
  const market = norm(marketOf(row));
  const side = norm(sideOf(row));
  const line = String(lineOf(row) ?? "").trim();

  if (!player || !market || !side || !line) return null;
  return `${player}|${market}|${side}|${line}`;
}

function isDirectUnderlyingEligible(row) {
  const market = norm(marketOf(row));
  const side = sideOf(row);

  if (side !== "MORE" && side !== "LESS") return false;

  return [
    "hits",
    "bases",
    "total_bases",
    "hrr",
    "walks",
    "strikeouts",
    "hitter_strikeouts",
    "pitching_outs",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "runs_allowed",
    "runs",
    "rbis",
    "singles"
  ].includes(market);
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
      if (k === "underlyingBookSupport") continue;
      walk(val, `${path}.${k}`);
    }
  }

  walk(payload);
  return out;
}

function buildBoardIndex(board) {
  const index = new Map();
  let supportKeys = 0;

  for (const { row } of flattenRows(board)) {
    if (!isDirectUnderlyingEligible(row)) continue;

    const key = keyOf(row);
    if (!key) continue;

    const books = booksOf(row);
    if (books <= 0) continue;

    supportKeys++;

    const candidate = {
      player: playerOf(row),
      market: marketOf(row),
      side: sideOf(row),
      line: lineOf(row),
      tier: tierOf(row),
      books,
      support: supportOf(row) || (books >= 2 ? "OK" : "LOW_BOOK_SUPPORT"),
      grade: gradeOf(row) || "UNKNOWN",
      sideBias: sideBiasOf(row),
      prob: probOf(row),
      edge: edgeOf(row),
      sourceKey: key,
      sportsbookMatch: !!row?.sportsbookMatch,
      sportsbookMatchType: row?.sportsbookMatchType ?? null,
      sportsbooks: Array.isArray(row?.sportsbooks) ? row.sportsbooks : []
    };

    const existing = index.get(key);
    if (!existing || candidate.books > existing.books) {
      index.set(key, candidate);
    }
  }

  return { index, supportKeys };
}

function shouldPatch(row) {
  if (!row || typeof row !== "object") return false;
  if (!isDirectUnderlyingEligible(row)) return false;

  const market = norm(marketOf(row));

  // Fantasy is not a direct sportsbook market. HRR is allowed only when sportsbook board has exact HRR support.
  if (market.includes("fantasy")) return false;

  const support = supportOf(row);
  const grade = gradeOf(row);
  const books = booksOf(row);

  return (
    books <= 0 ||
    support === "PHASE8_UNPRICED" ||
    support === "NO_DIRECT_BOOK_MATCH" ||
    support === "UNKNOWN" ||
    grade === "UNKNOWN" ||
    !support
  );
}

function patchRow(row, match) {
  if (!shouldPatch(row)) return false;

  const currentBooks = booksOf(row);
  if (match.books <= currentBooks) return false;

  row.books = match.books;
  row.support = match.support || (match.books >= 2 ? "OK" : "LOW_BOOK_SUPPORT");
  row.grade = gradeOf(row) && gradeOf(row) !== "UNKNOWN"
    ? gradeOf(row)
    : (match.grade || "UNKNOWN");

  row.underlyingBookSupport = {
    patched: true,
    source: "sportsbook-enriched-board",
    books: match.books,
    support: row.support,
    grade: row.grade,
    sideBias: match.sideBias,
    sportsbookMatch: match.sportsbookMatch,
    sportsbookMatchType: match.sportsbookMatchType,
    sportsbooks: match.sportsbooks
  };

  return true;
}

function processTargetFile(file, boardIndex) {
  const payload = readJson(file, null);
  if (!payload) return null;

  const rows = flattenRows(payload);
  const patched = [];
  const unmatched = [];

  for (const { row, path } of rows) {
    if (!shouldPatch(row)) continue;

    const key = keyOf(row);
    if (!key) continue;

    const match = boardIndex.get(key);
    if (!match) {
      unmatched.push({
        file,
        path,
        player: playerOf(row),
        market: marketOf(row),
        side: sideOf(row),
        line: lineOf(row),
        tier: tierOf(row),
        books: booksOf(row),
        support: supportOf(row) || "UNKNOWN",
        grade: gradeOf(row) || "UNKNOWN",
        reason: "NO_MATCHING_DIRECT_UNDERLYING_BOOK_ROW"
      });
      continue;
    }

    if (patchRow(row, match)) {
      patched.push({
        file,
        path,
        player: playerOf(row),
        market: marketOf(row),
        side: sideOf(row),
        line: lineOf(row),
        tier: tierOf(row),
        books: match.books,
        support: row.support,
        grade: row.grade,
        sourceKey: match.sourceKey
      });
    }
  }

  writeJson(file, payload);

  return {
    file,
    rows: rows.length,
    candidates: rows.filter(({ row }) => shouldPatch(row)).length,
    patched: patched.length,
    unmatched: unmatched.length,
    patchedRows: patched,
    unmatchedRows: unmatched
  };
}

function main() {
  let boardFile = null;
  let board = null;

  for (const file of BOARD_FILES) {
    const data = readJson(file, null);
    if (data) {
      boardFile = file;
      board = data;
      break;
    }
  }

  if (!board) {
    console.error("No board file found.");
    process.exit(1);
  }

  const { index: boardIndex, supportKeys } = buildBoardIndex(board);

  const files = [];
  const patchedRows = [];
  const unmatchedRows = [];

  for (const file of TARGET_FILES) {
    if (!fs.existsSync(file)) continue;
    const result = processTargetFile(file, boardIndex);
    if (!result) continue;
    files.push({
      file: result.file,
      rows: result.rows,
      candidates: result.candidates,
      patched: result.patched,
      unmatched: result.unmatched
    });
    patchedRows.push(...result.patchedRows);
    unmatchedRows.push(...result.unmatchedRows);
  }

  const audit = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    boardFile,
    boardSupportKeys: supportKeys,
    summary: {
    remainingProblemRows: readRemainingProblemRows(),
      files: files.length,
      patchedRows: patchedRows.length,
      unmatchedRows: unmatchedRows.length
    },
    files,
    patchedRows,
    unmatchedRows,
    note: "Direct sportsbook support only. Fantasy remains research-only. HRR may receive direct support when sportsbook-enriched-board has exact HRR line support."
  };

  const lines = [];
  lines.push("DIRECT UNDERLYING BOOK SUPPORT ENRICHMENT");
  lines.push("========================================");
  lines.push(`date: ${DATE}`);
  lines.push(`boardFile: ${boardFile}`);
  lines.push(`boardSupportKeys: ${supportKeys}`);
  lines.push("");
  lines.push("FILES");
  lines.push("-----");
  for (const f of files) {
    lines.push(`${f.file} | rows=${f.rows} | candidates=${f.candidates} | patched=${f.patched} | unmatched=${f.unmatched}`);
  }
  lines.push("");
  lines.push("PATCHED ROWS");
  lines.push("------------");
  if (!patchedRows.length) {
    lines.push("none");
  } else {
    patchedRows.slice(0, 80).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | books=${r.books} | support=${r.support} | grade=${r.grade}`);
    });
  }
  lines.push("");
  lines.push("UNMATCHED DIRECT UNDERLYING ROWS");
  lines.push("--------------------------------");
  if (!unmatchedRows.length) {
    lines.push("none");
  } else {
    unmatchedRows.slice(0, 80).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | books=${r.books} | support=${r.support} | grade=${r.grade} | ${r.reason}`);
    });
  }

  writeJson(OUT_AUDIT_JSON, audit);
  writeJson(OUT_LATEST_JSON, audit);
  writeText(OUT_AUDIT_TXT, lines.join("\n"));
  writeText(OUT_LATEST_TXT, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log(`saved: ${OUT_AUDIT_JSON}`);
  console.log(`saved: ${OUT_AUDIT_TXT}`);
}

main();
