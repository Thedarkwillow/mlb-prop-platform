const fs = require("fs");

function todayPtDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function dateOnly(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const explicit =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2];

if (explicit) {
  console.log(explicit);
  process.exit(0);
}

const board = readJson("outputs/priced-board.json", []);
const rows = Array.isArray(board)
  ? board.filter(r => r && r.recordType === "merged_prop")
  : [];

const counts = new Map();

for (const r of rows) {
  const d = dateOnly(
    r.startTime ||
    r.game_start ||
    r.start_time ||
    r.board_time ||
    r.updated_at ||
    r.created_at
  );
  if (!d) continue;
  counts.set(d, (counts.get(d) || 0) + 1);
}

const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

console.log(best ? best[0] : todayPtDate());
