const fs = require("fs");
const path = require("path");

const date =
  process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = {
  board: "outputs/priced-board.json",
  umpire: "data/context/umpires.json",
  pitchType: "data/context/pitch-type-matchups.json",
  pitchTypeAlt: "data/learning/pitch-type-matchups.json",
  bullpen: "data/context/bullpen-fatigue.json",
  catcher: "data/context/catcher-framing.json"
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function asArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (Array.isArray(v.rows)) return v.rows;
  if (Array.isArray(v.data)) return v.data;
  if (Array.isArray(v.games)) return v.games;
  if (Array.isArray(v.players)) return v.players;
  if (Array.isArray(v.matchups)) return v.matchups;
  return [];
}

function pct(n, d) {
  if (!d) return "0.0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function hasAny(row, keys) {
  return keys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "");
}

function summarizeBoardContext(board) {
  const rows = asArray(board);
  const total = rows.length;

  const umpireKeys = [
    "umpire",
    "homePlateUmpire",
    "plateUmpire",
    "umpireName",
    "umpireContext",
    "umpireRunFactor",
    "umpireKFactor",
    "umpireWalkFactor"
  ];

  const pitchTypeKeys = [
    "pitchTypeMatchup",
    "pitchTypeEdge",
    "pitchTypeScore",
    "arsenalMatchup",
    "pitchMixMatchup",
    "pitchTypeContext",
    "pitchTypeAdjustment"
  ];

  const bullpenKeys = [
    "bullpenFatigue",
    "bullpenFatigueScore",
    "bullpenContext",
    "bullpenRisk",
    "bullpenAdjustment"
  ];

  const catcherKeys = [
    "catcherFraming",
    "catcherFramingRuns",
    "catcherFramingKImpact",
    "catcherFramingAdjustment",
    "catcherContext"
  ];

  const out = {
    totalRows: total,
    umpireRows: rows.filter(r => hasAny(r, umpireKeys)).length,
    pitchTypeRows: rows.filter(r => hasAny(r, pitchTypeKeys)).length,
    bullpenRows: rows.filter(r => hasAny(r, bullpenKeys)).length,
    catcherRows: rows.filter(r => hasAny(r, catcherKeys)).length
  };

  out.umpireCoveragePct = pct(out.umpireRows, total);
  out.pitchTypeCoveragePct = pct(out.pitchTypeRows, total);
  out.bullpenCoveragePct = pct(out.bullpenRows, total);
  out.catcherCoveragePct = pct(out.catcherRows, total);

  return out;
}

function fileStatus(file) {
  if (!fs.existsSync(file)) {
    return { file, exists: false, rows: 0, modifiedAt: null };
  }
  const stat = fs.statSync(file);
  const raw = readJson(file, null);
  return {
    file,
    exists: true,
    rows: asArray(raw).length,
    modifiedAt: stat.mtime.toISOString()
  };
}

const board = readJson(FILES.board, []);
const boardSummary = summarizeBoardContext(board);

const files = Object.values(FILES).map(fileStatus);
const warnings = [];

if (!boardSummary.totalRows) warnings.push("priced_board_missing_or_empty");
if (boardSummary.umpireRows === 0) warnings.push("umpire_context_missing_from_board");
if (boardSummary.pitchTypeRows === 0) warnings.push("pitch_type_context_missing_from_board");
if (boardSummary.bullpenRows === 0) warnings.push("bullpen_context_missing_from_board");
if (boardSummary.catcherRows === 0) warnings.push("catcher_framing_context_missing_from_board");

const report = {
  date,
  generatedAt: new Date().toISOString(),
  boardSummary,
  files,
  warnings,
  note: "Coverage report only. Missing context should warn/downgrade confidence, not silently create official plays."
};

fs.mkdirSync("outputs/context", { recursive: true });
fs.writeFileSync(`outputs/context/context-coverage-report-${date}.json`, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync("outputs/context/context-coverage-report-latest.json", JSON.stringify(report, null, 2) + "\n");

console.log("CONTEXT COVERAGE REPORT");
console.log("-----------------------");
console.log("date:", date);
console.table([boardSummary]);
console.log("warnings:", warnings.length ? warnings.join(", ") : "none");
console.log("saved:", `outputs/context/context-coverage-report-${date}.json`);
console.log("saved:", "outputs/context/context-coverage-report-latest.json");
