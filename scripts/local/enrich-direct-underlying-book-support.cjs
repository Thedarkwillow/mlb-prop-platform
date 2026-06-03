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

function sideOf(row) {
  return String(row?.side || row?.pick || row?.direction || "").toUpperCase();
}

function marketOf(row) {
  return String(row?.market || row?.statType || row?.stat_type || row?.prop || "").toLowerCase();
}

function playerOf(row) {
  return String(row?.player || row?.playerName || row?.name || row?.displayName || "");
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
    row?.pricing?.books,
    row?.pricing?.bookCount,
    row?.vegas?.books,
    row?.vegas?.bookCount
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (Array.isArray(row?.bookNames)) return row.bookNames.length;
  if (Array.isArray(row?.booksMatched)) return row.booksMatched.length;
  if (Array.isArray(row?.matchedBookNames)) return row.matchedBookNames.length;
  return 0;
}

function supportOf(row) {
  return String(row?.support || row?.bookSupportStatus || row?.supportStatus || "").toUpperCase();
}

function gradeOf(row) {
  return String(row?.grade || row?.validationGrade || row?.decisionGrade || row?.qualityGrade || "").toUpperCase();
}

function sideBiasOf(row) {
  const raw =
    row?.sideBias ??
    row?.sideBiasLabel ??
    row?.side_bias ??
    row?.sideBias?.label ??
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

  // These are sportsbook-underlying markets we can match directly.
  return [
    "hits",
    "bases",
    "total_bases",
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
  for (const { row } of flattenRows(board)) {
    if (!isDirectUnderlyingEligible(row)) continue;

    const key = keyOf(row);
    if (!key) continue;

    const books = booksOf(row);
    const support = supportOf(row);
    const grade = gradeOf(row);
    const tier = tierOf(row);

    // Need a row that has actual book/pricing support.
    if (books <= 0) continue;

    const candidate = {
      player: playerOf(row),
      market: marketOf(row),
      side: sideOf(row),
      line: lineOf(row),
      tier,
      books,
      support: support || (books >= 2 ? "OK" : "LOW_BOOK_SUPPORT"),
      grade: grade || "UNKNOWN",
      sideBias: sideBiasOf(row),
      prob: probOf(row),
      edge: edgeOf(row),
      sourceTier: tier,
      sourceKey: key
    };

    const existing = index.get(key);
    if (!existing || candidate.books > existing.books) {
      index.set(key, candidate);
    }
  }
  return index;
}

function shouldPatch(row) {
  if (!row || typeof row !== "object") return false;
  if (!isDirectUnderlyingEligible(row)) return false;

  const market = norm(marketOf(row));

  // Do not treat fantasy/HRR as direct underlying. Those need synthetic support later.
  if (market === "hrr" || market.includes("fantasy")) return false;

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
  const currentGrade = gradeOf(row);

  row.bookSupportType = "DIRECT_UNDERLYING_MARKET";
  row.underlyingBookSupport = {
    type: "DIRECT_UNDERLYING_MARKET",
    note: "Underlying sportsbook market matched by player/market/side/line. This supports the stat market, not the PrizePicks special payout.",
    books: match.books,
    support: match.support,
    grade: match.grade,
    sideBias: match.sideBias,
    sourceTier: match.sourceTier,
    sourceKey: match.sourceKey
  };

  row.books = Math.max(currentBooks, match.books);
  row.bookCount = Math.max(asNum(row.bookCount, 0), match.books);
  row.support = match.books >= 2 ? "OK" : "LOW_BOOK_SUPPORT";

  if (!currentGrade || currentGrade === "UNKNOWN") {
    row.grade = match.grade || "UNKNOWN";
  }

  row.directUnderlyingSupportPatched = true;
  row.directUnderlyingSupportDate = DATE;

  const cls = String(row.class || row.candidateClass || row.status || "").toUpperCase();
  if (cls.includes("RESEARCH") || cls.includes("SHADOW") || cls.includes("BLOCKED")) {
    row.promotionLocked = true;
    row.promotionLockReason = "Direct underlying book support attached, but row remains in original no-bet class until validated promotion rules approve it.";
  }

  return true;
}

function main() {
  const boardFile = BOARD_FILES.find(f => fs.existsSync(f));
  const board = boardFile ? readJson(boardFile, []) : [];
  const boardIndex = buildBoardIndex(board);

  const audit = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    boardFile: boardFile || null,
    boardSupportKeys: boardIndex.size,
    files: [],
    patchedRows: [],
    unmatchedRows: []
  };

  for (const file of TARGET_FILES) {
    if (!fs.existsSync(file)) continue;

    const payload = readJson(file, null);
    if (!payload) continue;

    const rows = flattenRows(payload);
    let candidates = 0;
    let patched = 0;
    let unmatched = 0;

    for (const item of rows) {
      const row = item.row;
      if (!shouldPatch(row)) continue;

      candidates += 1;
      const key = keyOf(row);
      const match = key ? boardIndex.get(key) : null;

      if (match) {
        if (patchRow(row, match)) {
          patched += 1;
          audit.patchedRows.push({
            file,
            path: item.path,
            player: playerOf(row),
            market: marketOf(row),
            side: sideOf(row),
            line: lineOf(row),
            tier: tierOf(row),
            books: booksOf(row),
            support: supportOf(row),
            grade: gradeOf(row),
            bookSupportType: row.bookSupportType
          });
        }
      } else {
        unmatched += 1;
        audit.unmatchedRows.push({
          file,
          path: item.path,
          player: playerOf(row),
          market: marketOf(row),
          side: sideOf(row),
          line: lineOf(row),
          tier: tierOf(row),
          currentBooks: booksOf(row),
          currentSupport: supportOf(row),
          currentGrade: gradeOf(row),
          reason: "NO_MATCHING_DIRECT_UNDERLYING_BOOK_ROW"
        });
      }
    }

    if (patched > 0) writeJson(file, payload);

    audit.files.push({
      file,
      rows: rows.length,
      candidates,
      patched,
      unmatched
    });
  }

  const lines = [];
  lines.push("DIRECT UNDERLYING BOOK SUPPORT ENRICHMENT");
  lines.push("========================================");
  lines.push(`date: ${DATE}`);
  lines.push(`boardFile: ${boardFile || "none"}`);
  lines.push(`boardSupportKeys: ${boardIndex.size}`);
  lines.push("");
  lines.push("FILES");
  lines.push("-----");
  for (const f of audit.files) {
    lines.push(`${f.file} | rows=${f.rows} | candidates=${f.candidates} | patched=${f.patched} | unmatched=${f.unmatched}`);
  }
  lines.push("");
  lines.push("PATCHED ROWS");
  lines.push("------------");
  if (!audit.patchedRows.length) {
    lines.push("none");
  } else {
    audit.patchedRows.slice(0, 80).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | books=${r.books} | support=${r.support} | grade=${r.grade} | ${r.bookSupportType}`);
    });
  }
  lines.push("");
  lines.push("UNMATCHED DIRECT UNDERLYING ROWS");
  lines.push("--------------------------------");
  if (!audit.unmatchedRows.length) {
    lines.push("none");
  } else {
    audit.unmatchedRows.slice(0, 80).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.tier} | books=${r.currentBooks} | support=${r.currentSupport || "none"} | grade=${r.currentGrade || "none"} | ${r.reason}`);
    });
  }
  lines.push("");
  lines.push("NOTE");
  lines.push("----");
  lines.push("This only upgrades direct underlying sportsbook/stat support. It does not synthesize HRR or fantasy support and does not promote research/shadow/blocked rows to bets.");

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
