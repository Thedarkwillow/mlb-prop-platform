const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = "data/live/mlb-live-board-history.json";
const OUT = `outputs/live/mlb-live-board-graded-${date}.json`;
const LATEST = "outputs/live/mlb-live-board-graded-latest.json";
const HISTORY = "data/live/mlb-live-graded-history.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’`-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function result(actual, side, line) {
  if (actual === null || actual === undefined || !Number.isFinite(Number(actual))) return "UNKNOWN";
  const a = Number(actual);
  const l = Number(line);
  const s = String(side || "").toUpperCase();
  if (a === l) return "PUSH";
  if (s === "MORE") return a > l ? "HIT" : "MISS";
  if (s === "LESS") return a < l ? "HIT" : "MISS";
  return "UNKNOWN";
}

const SUPPORTED_MARKETS = new Set([
  "strikeouts",
  "pitches_thrown",
  "pitching_outs",
  "hits_allowed",
  "runs_allowed",
  "walks_allowed"
]);

function gradeShell(row) {
  const reasons = [];

  if (!row.gamePk) reasons.push("missing_gamePk");
  if (!row.inningWindow || row.inningWindow < 1 || row.inningWindow > 5) reasons.push("missing_or_invalid_inningWindow");
  if (!SUPPORTED_MARKETS.has(row.market)) reasons.push("unsupported_market");
  if (!["MORE", "LESS"].includes(String(row.side || "").toUpperCase())) reasons.push("missing_side");
  if (!Number.isFinite(Number(row.line))) reasons.push("missing_line");

  const ready = reasons.length === 0;

  return {
    ...row,
    gradeDate: date,
    gradeStatus: ready ? "READY_TO_GRADE" : "NOT_READY",
    gradeReasons: reasons,
    actual: null,
    result: ready ? "PENDING_GAME_STATE_GRADER" : "UNSUPPORTED",
    normalizedPlayerKey: normName(row.player)
  };
}

const rows = read(INPUT, []).filter(r => r.date === date);
const graded = rows.map(gradeShell);

write(OUT, graded);
write(LATEST, graded);

const hist = read(HISTORY, []).filter(r => r.date !== date);
write(HISTORY, [...hist, ...graded]);

const summary = graded.reduce((acc, r) => {
  const k = `${r.gradeStatus}:${r.gradeReasons[0] || "ready"}`;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log("MLB LIVE BOARD GRADER");
console.log("---------------------");
console.log("date:", date);
console.log("input rows:", rows.length);
console.log("graded rows:", graded.length);
console.table(Object.entries(summary).map(([bucket, count]) => ({ bucket, count })));
console.log("supported markets:", [...SUPPORTED_MARKETS].join(", "));
console.log("saved:", OUT);
console.log("saved:", LATEST);
console.log("saved:", HISTORY);
