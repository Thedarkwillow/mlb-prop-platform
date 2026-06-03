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
  `outputs/lean-final-slips-${DATE}.json`
];

const OUT_JSON = `outputs/high-probability-boards-${DATE}.json`;
const OUT_TXT = `outputs/high-probability-boards-${DATE}.txt`;
const OUT_LATEST_JSON = "outputs/high-probability-boards-latest.json";
const OUT_LATEST_TXT = "outputs/high-probability-boards-latest.txt";

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
  fs.writeFileSync(file, text.trimEnd() + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normName(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getMarket(row) {
  const raw =
    row?.market ||
    row?.statType ||
    row?.stat_type ||
    row?.projectionType ||
    row?.type ||
    "";
  const m = norm(raw);
  if (m === "total_bases") return "bases";
  if (m === "hits_allowed") return "hits_allowed";
  if (m === "walks_allowed") return "walks_allowed";
  if (m === "runs_allowed") return "runs_allowed";
  if (m === "earned_runs") return "earned_runs_allowed";
  if (m === "hitter_fantasy" || m === "hitter_fantasy_score") return "hitter_fantasy_score";
  if (m === "pitcher_fantasy" || m === "pitcher_fantasy_score") return "pitcher_fantasy_score";
  return m;
}

function getSide(row) {
  return String(row?.side || row?.pick || row?.direction || "").toUpperCase();
}

function getTier(row) {
  return norm(row?.tier || row?.oddsTier || row?.lineType || row?.type || "standard");
}

function getPlayer(row) {
  return row?.player || row?.playerName || row?.name || row?.athlete || "";
}

function getProb(row) {
  const vals = [
    row?.prob,
    row?.probability,
    row?.projectedProbability,
    row?.adjustedProbability,
    row?.finalProbability,
    row?.hitProbability
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
  }
  return null;
}

function getEdge(row) {
  const vals = [row?.edge, row?.ev, row?.expectedValue, row?.trueEV, row?.edgePct];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
  }
  return null;
}

function getBooks(row) {
  const vals = [row?.books, row?.bookCount, row?.supportingBooks, row?.numBooks];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function getGrade(row) {
  return String(row?.grade || row?.decisionGrade || row?.validationGrade || row?.finalGrade || "UNKNOWN").toUpperCase();
}

function getSupport(row) {
  return String(row?.support || row?.bookSupport || row?.supportStatus || "").toUpperCase();
}

function sideBiasText(row) {
  const v =
    row?.sideBias ||
    row?.side_bias ||
    row?.marketSideBias ||
    row?.sideBiasLabel ||
    row?.sideBiasTier ||
    "";

  if (!v) return "UNKNOWN";
  if (typeof v === "string") return v.toUpperCase();
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    return String(
      v.label ||
      v.tier ||
      v.status ||
      v.bucket ||
      v.sideBias ||
      v.recommendation ||
      v.action ||
      "OBJECT"
    ).toUpperCase();
  }
  return String(v).toUpperCase();
}

function classify(row) {
  const raw = String(
    row?.class ||
    row?.candidateClass ||
    row?.bucket ||
    row?.status ||
    row?.decision ||
    row?.recommendation ||
    ""
  ).toUpperCase();

  if (raw.includes("SHADOW")) return "SHADOW_BLOCKED";
  if (raw.includes("BLOCK")) return "BLOCKED";
  if (raw.includes("RESEARCH")) return "RESEARCH";
  if (raw.includes("WATCH")) return "WATCHLIST";
  if (raw.includes("LEAN")) return "LEAN";
  if (raw.includes("CORE")) return "CORE";
  return raw || "UNKNOWN";
}

function candidateKey(row) {
  return [
    normName(getPlayer(row)),
    getMarket(row),
    getSide(row),
    String(row?.line ?? row?.threshold ?? row?.value ?? "")
  ].join("|");
}

function boardKey(row) {
  return [
    normName(getPlayer(row)),
    getMarket(row),
    getSide(row),
    String(row?.line ?? row?.threshold ?? row?.value ?? "")
  ].join("|");
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const hasCandidateShape =
    getPlayer(v) &&
    getMarket(v) &&
    (getSide(v) || v?.line !== undefined || v?.threshold !== undefined);

  if (hasCandidateShape) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }

  return out;
}

function loadBoardKeys() {
  for (const file of BOARD_FILES) {
    const board = readJson(file, null);
    if (!board) continue;
    const rows = flatten(board);
    const keys = new Set(rows.map(boardKey).filter(k => !k.startsWith("||")));
    if (keys.size) return { file, keys };
  }
  return { file: null, keys: new Set() };
}

function loadCandidates() {
  const byKey = new Map();

  for (const file of SOURCE_FILES) {
    const data = readJson(file, null);
    if (!data) continue;

    const rows = flatten(data);
    for (const row of rows) {
      const key = candidateKey(row);
      if (!key || key.startsWith("||")) continue;

      const prev = byKey.get(key);
      const prob = getProb(row) ?? 0;
      const prevProb = prev ? getProb(prev) ?? 0 : -1;

      const enriched = {
        ...row,
        _sourceFile: file,
        _class: classify(row),
        _player: getPlayer(row),
        _market: getMarket(row),
        _side: getSide(row),
        _tier: getTier(row),
        _prob: getProb(row),
        _edge: getEdge(row),
        _books: getBooks(row),
        _grade: getGrade(row),
        _support: getSupport(row),
        _sideBias: sideBiasText(row),
        _key: key
      };

      if (!prev || prob > prevProb) byKey.set(key, enriched);
    }
  }

  return [...byKey.values()];
}

function isBadSupport(row) {
  return row._support.includes("PHASE8_UNPRICED") || row._support.includes("LOW_BOOK");
}

function isNegativeSide(row) {
  return row._sideBias.includes("NEGATIVE");
}

function isUnknownGrade(row) {
  return row._grade === "UNKNOWN" || row._grade === "";
}

function isFade(row) {
  return row._grade === "FADE";
}

function isFantasy(row) {
  return row._market === "hitter_fantasy_score" || row._market === "pitcher_fantasy_score";
}

function isHrrMore(row) {
  return row._market === "hrr" && row._side === "MORE";
}

function isGoblin(row) {
  return row._tier === "goblin";
}

function highProb(row) {
  const p = row._prob ?? 0;
  if (isGoblin(row)) return p >= 0.70;
  return p >= 0.65;
}

function actionable(row) {
  if (!highProb(row)) return false;
  if (row._class === "RESEARCH" || row._class === "SHADOW_BLOCKED" || row._class === "BLOCKED") return false;
  if (isGoblin(row)) return false;
  if (isFantasy(row)) return false;
  if (isHrrMore(row)) return false;
  if (isBadSupport(row)) return false;
  if (isFade(row) || isUnknownGrade(row)) return false;
  if (isNegativeSide(row)) return false;
  return true;
}

function rowLine(row, i) {
  const prob = row._prob == null ? "n/a" : `${(row._prob * 100).toFixed(2)}%`;
  const edge = row._edge == null ? "n/a" : `${(row._edge * 100).toFixed(2)}%`;
  const books = row._books == null ? "n/a" : row._books;
  const line = row?.line ?? row?.threshold ?? row?.value ?? "";
  return `${i + 1}. ${row._player} | ${String(row?.team || row?.teamAbbr || "").toUpperCase()} | ${row._market} ${row._side} ${line} | ${row._tier} | prob=${prob} | edge=${edge} | books=${books} | grade=${row._grade} | support=${row._support || "UNKNOWN"} | sideBias=${row._sideBias} | class=${row._class}`;
}

function section(lines, title, rows, max = 30) {
  lines.push(title);
  lines.push("-".repeat(title.length));
  if (!rows.length) {
    lines.push("none");
    return;
  }
  rows.slice(0, max).forEach((row, i) => lines.push(rowLine(row, i)));
}

function main() {
  const { file: boardFile, keys } = loadBoardKeys();
  const all = loadCandidates()
    .filter(row => keys.size ? keys.has(row._key) : true)
    .filter(row => row._prob != null)
    .sort((a, b) => (b._prob ?? 0) - (a._prob ?? 0));

  const boards = {
    actionableHighProbability: all.filter(actionable),
    goblinActionableWatch: all.filter(row =>
      highProb(row) &&
      isGoblin(row) &&
      !isFantasy(row) &&
      !isHrrMore(row) &&
      row._class !== "RESEARCH" &&
      row._class !== "SHADOW_BLOCKED" &&
      row._class !== "BLOCKED" &&
      !isBadSupport(row) &&
      !isFade(row) &&
      !isUnknownGrade(row) &&
      !isNegativeSide(row)
    ),
    goblinFantasyResearch: all.filter(row =>
      highProb(row) &&
      isGoblin(row) &&
      isFantasy(row)
    ),
    hrrMoreResearch: all.filter(row =>
      highProb(row) &&
      isHrrMore(row)
    ),
    shadowHighProbability: all.filter(row =>
      highProb(row) &&
      row._class === "SHADOW_BLOCKED"
    ),
    blockedHighProbability: all.filter(row =>
      highProb(row) &&
      row._class === "BLOCKED"
    ),
    researchHighProbabilityNonHrrNonFantasy: all.filter(row =>
      highProb(row) &&
      row._class === "RESEARCH" &&
      !isHrrMore(row) &&
      !isFantasy(row)
    )
  };

  const output = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    boardFile,
    boardKeys: keys.size,
    rules: [
      "ACTIONABLE excludes HRR MORE, fantasy, research, shadow, blocked, PHASE8_UNPRICED, LOW_BOOK_SUPPORT, FADE, UNKNOWN grade, NEGATIVE side bias, and goblins.",
      "Goblin boards are separated into actionable-watch, fantasy research, HRR research, shadow, and blocked.",
      "Research/shadow/blocked are no-bet buckets unless manually approved later."
    ],
    counts: Object.fromEntries(Object.entries(boards).map(([k, v]) => [k, v.length])),
    ...boards
  };

  const lines = [];
  lines.push("HIGH PROBABILITY BOARDS");
  lines.push("=======================");
  lines.push(`date: ${DATE}`);
  lines.push(`boardFile: ${boardFile || "none"}`);
  lines.push(`boardKeys: ${keys.size}`);
  lines.push("");
  lines.push("Rules:");
  for (const rule of output.rules) lines.push(`- ${rule}`);
  lines.push("");

  section(lines, "ACTIONABLE HIGH PROBABILITY", boards.actionableHighProbability, 30);
  lines.push("");
  section(lines, "GOBLIN ACTIONABLE WATCH", boards.goblinActionableWatch, 30);
  lines.push("");
  section(lines, "GOBLIN FANTASY RESEARCH", boards.goblinFantasyResearch, 30);
  lines.push("");
  section(lines, "HRR MORE RESEARCH", boards.hrrMoreResearch, 30);
  lines.push("");
  section(lines, "RESEARCH HIGH PROBABILITY NON-HRR/NON-FANTASY", boards.researchHighProbabilityNonHrrNonFantasy, 30);
  lines.push("");
  section(lines, "SHADOW HIGH PROBABILITY", boards.shadowHighProbability, 30);
  lines.push("");
  section(lines, "BLOCKED HIGH PROBABILITY", boards.blockedHighProbability, 30);

  writeJson(OUT_JSON, output);
  writeJson(OUT_LATEST_JSON, output);
  writeText(OUT_TXT, lines.join("\n"));
  writeText(OUT_LATEST_TXT, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log("");
  console.log(`saved: ${OUT_JSON}`);
  console.log(`saved: ${OUT_TXT}`);
}

main();
