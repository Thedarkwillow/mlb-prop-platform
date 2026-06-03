const fs = require("fs");

const DATE = process.argv[2] || process.env.SLATE_DATE || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

const BOARD_FILES = [
  "outputs/priced-board.json",
  `outputs/priced-board-${DATE}.json`
];

const TARGET_FILES = [
  "outputs/production-candidates.json",
  "outputs/lean-final-slips.json",
  `outputs/lean-final-slips-${DATE}.json`
];

const AUDIT_FILE = `outputs/current-slate-candidate-filter-${DATE}.json`;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normMarket(market) {
  const m = String(market || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (m === "total_bases") return "bases";
  if (m === "rbi") return "rbis";
  if (m === "earned_runs") return "earned_runs_allowed";
  if (m === "hits_allowed") return "hits_allowed";
  if (m === "walks_allowed") return "walks_allowed";
  if (m === "runs_allowed") return "runs_allowed";
  return m;
}

function sideOf(row) {
  return String(row?.side || row?.pick || row?.selection || row?.direction || "").toUpperCase();
}

function playerOf(row) {
  return row?.player || row?.playerName || row?.name || row?.athlete || row?.athleteName || "";
}

function marketOf(row) {
  return row?.market || row?.stat || row?.type || row?.projectionType || row?.propType || "";
}

function lineOf(row) {
  const raw = row?.line ?? row?.projection ?? row?.value ?? row?.target ?? row?.threshold;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function key(row) {
  const player = norm(playerOf(row));
  const market = normMarket(marketOf(row));
  const side = sideOf(row);
  const line = lineOf(row);

  if (!player || !market || !side || line == null) return null;
  return `${player}|${market}|${side}|${line}`;
}

function walkBoard(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) walkBoard(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const k = key(v);
  if (k) out.push(k);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") walkBoard(val, out);
  }
  return out;
}

function candidateRowsFromObject(obj) {
  const keys = [
    "CORE",
    "LEAN",
    "WATCHLIST",
    "HIGH_PROBABILITY_WATCH",
    "RESEARCH",
    "BLOCKED",
    "SHADOW_BLOCKED",
    "candidates",
    "rows",
    "leans",
    "trackOnly",
    "blocked"
  ];

  let total = 0;
  for (const k of keys) {
    if (Array.isArray(obj?.[k])) total += obj[k].length;
  }
  return total;
}

function filterArray(arr, boardKeys, removed, file, bucket = "array") {
  const kept = [];
  for (const row of arr) {
    const k = key(row);

    // If it is not a prop row, keep it. This prevents damaging metadata.
    if (!k) {
      kept.push(row);
      continue;
    }

    if (boardKeys.has(k)) {
      kept.push(row);
    } else {
      removed.push({
        file,
        bucket,
        player: playerOf(row),
        market: marketOf(row),
        side: sideOf(row),
        line: lineOf(row),
        reason: "not_on_current_priced_board"
      });
    }
  }
  return kept;
}

function filterObject(obj, boardKeys, removed, file) {
  if (Array.isArray(obj)) return filterArray(obj, boardKeys, removed, file);

  if (!obj || typeof obj !== "object") return obj;

  const out = Array.isArray(obj) ? [] : { ...obj };

  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      out[k] = filterArray(v, boardKeys, removed, file, k);
    }
  }

  if ("TOTAL" in out) {
    let total = 0;
    for (const [k, v] of Object.entries(out)) {
      if (Array.isArray(v)) total += v.length;
    }
    out.TOTAL = total;
  }

  if ("total" in out && candidateRowsFromObject(out) > 0) {
    out.total = candidateRowsFromObject(out);
  }

  return out;
}

function main() {
  const boardFile = BOARD_FILES.find(f => fs.existsSync(f));
  if (!boardFile) throw new Error(`No board file found: ${BOARD_FILES.join(", ")}`);

  const board = readJson(boardFile, []);
  const boardKeys = new Set(walkBoard(board));

  if (!boardKeys.size) {
    throw new Error(`Could not build current board keyset from ${boardFile}`);
  }

  const audit = {
    date: DATE,
    boardFile,
    boardKeys: boardKeys.size,
    files: [],
    removed: []
  };

  for (const file of TARGET_FILES) {
    if (!fs.existsSync(file)) continue;

    const before = readJson(file, null);
    const beforeCount = Array.isArray(before) ? before.length : candidateRowsFromObject(before);

    const removed = [];
    const after = filterObject(before, boardKeys, removed, file);
    const afterCount = Array.isArray(after) ? after.length : candidateRowsFromObject(after);

    writeJson(file, after);

    audit.files.push({
      file,
      beforeCount,
      afterCount,
      removed: removed.length
    });

    audit.removed.push(...removed);
  }

  writeJson(AUDIT_FILE, audit);

  console.log("CURRENT-SLATE CANDIDATE FILTER");
  console.log("==============================");
  console.log(`date=${DATE}`);
  console.log(`boardFile=${boardFile}`);
  console.log(`boardKeys=${boardKeys.size}`);
  console.table(audit.files);
  console.log(`removed=${audit.removed.length}`);
  console.log(`audit=${AUDIT_FILE}`);
}

main();
