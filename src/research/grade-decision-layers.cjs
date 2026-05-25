const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const DECISION = "outputs/lean-final-slips.json";
const FULL_BOARD = `outputs/history/${date}-full-board-graded.json`;
const OUT = `outputs/history/${date}-decision-layer-grades.json`;
const LATEST = "outputs/decision-layer-grades-latest.json";

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickKey(row) {
  return [
    norm(row.player),
    norm(row.market),
    norm(row.side),
    String(row.line ?? "")
  ].join("|");
}

function summarize(rows) {
  const graded = rows.filter(r => r.result === "HIT" || r.result === "MISS" || r.result === "PUSH");
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const decisions = hits + misses;
  const profit = hits - misses;
  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    pending: rows.filter(r => r.result === "PENDING").length,
    unmatched: rows.filter(r => r.result === "UNMATCHED").length,
    hitRate: decisions ? Number((hits / decisions).toFixed(4)) : null,
    roi: decisions ? Number((profit / decisions).toFixed(4)) : null
  };
}

function withGrade(row, layer, gradedByKey) {
  const match = gradedByKey.get(pickKey(row));
  return {
    layer,
    player: row.player,
    team: row.team ?? null,
    game: row.game ?? null,
    market: row.market,
    side: row.side,
    line: row.line,
    oddsTier: row.oddsTier ?? "standard",
    prob: num(row.prob),
    edge: num(row.edge),
    support: row.support ?? row.marketSupportFlag ?? null,
    grade: row.grade ?? row.qualityGrade ?? null,
    sideBias: row.fullBoardSideBias ?? row.sideBias ?? null,
    result: match?.result ?? "UNMATCHED",
    actual: match?.actual ?? null,
    source: match?.source ?? null
  };
}

const decision = readJson(DECISION, {});
const fullBoard = readJson(FULL_BOARD, []);

const leans = Array.isArray(decision.leans) ? decision.leans : [];
const trackOnly = Array.isArray(decision.trackOnly) ? decision.trackOnly : [];

const gradedByKey = new Map();
for (const row of fullBoard) {
  gradedByKey.set(pickKey(row), row);
}

const leanRows = leans.map(r => withGrade(r, "ACTIONABLE_LEAN", gradedByKey));

const avoidRows = trackOnly
  .filter(r => {
    const notes = Array.isArray(r.leanNotes) ? r.leanNotes.join(" ").toLowerCase() : "";
    const side = norm(r.side);
    return (
      notes.includes("negative_full_board_more_side") ||
      notes.includes("full_board_side_bias_negative") ||
      String(r.grade || r.qualityGrade || "").toUpperCase() === "FADE" ||
      (side === "more" && r.fullBoardSideBias && Number(r.fullBoardSideBias.roi) < 0)
    );
  })
  .map(r => withGrade(r, "AVOID", gradedByKey));

const rows = [...leanRows, ...avoidRows];

const report = {
  date,
  generatedAt: new Date().toISOString(),
  source: {
    decision: DECISION,
    fullBoard: FULL_BOARD
  },
  summary: {
    actionableLean: summarize(leanRows),
    avoid: summarize(avoidRows),
    all: summarize(rows)
  },
  rows
};

writeJson(OUT, report);
writeJson(LATEST, report);

console.log("DECISION LAYER GRADES");
console.log("---------------------");
console.log("date:", date);
console.log("actionable lean:", report.summary.actionableLean);
console.log("avoid:", report.summary.avoid);
console.table(rows.map(r => ({
  layer: r.layer,
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  tier: r.oddsTier,
  prob: r.prob,
  edge: r.edge,
  result: r.result,
  actual: r.actual
})));
console.log("saved:", OUT);
console.log("saved:", LATEST);
