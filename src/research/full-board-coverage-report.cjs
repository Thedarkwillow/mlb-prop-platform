const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

function read(p, fallback = []) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function marketOf(x) {
  return String(x?.market || x?.stat || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/^hr$/, "home_runs")
    .trim();
}

function countByMarket(rows) {
  const map = new Map();
  for (const r of rows) {
    const m = marketOf(r);
    if (!m) continue;
    map.set(m, (map.get(m) || 0) + 1);
  }
  return map;
}

const board = read("outputs/priced-board.json", []);
const graded = read(`outputs/history/${date}-full-board-graded.json`, []);

const boardMap = countByMarket(board);
const gradedMap = countByMarket(graded);

const markets = [...new Set([...boardMap.keys(), ...gradedMap.keys()])].sort();

const rows = markets.map(m => {
  const boardCount = boardMap.get(m) || 0;
  const gradedCount = gradedMap.get(m) || 0;
  const missing = Math.max(0, boardCount - gradedCount);
  const coverage = boardCount ? gradedCount / boardCount : null;

  return {
    market: m,
    board: boardCount,
    graded: gradedCount,
    missing,
    coveragePct: coverage == null ? null : Number((coverage * 100).toFixed(1)),
    status:
      boardCount === 0 ? "GRADED_ONLY" :
      gradedCount === 0 ? "MISSING" :
      coverage < 0.5 ? "LOW_COVERAGE" :
      coverage < 0.9 ? "PARTIAL" :
      "GOOD"
  };
});

const report = {
  date,
  generatedAt: new Date().toISOString(),
  boardRows: board.length,
  gradedRows: graded.length,
  markets: rows
};

fs.writeFileSync(`outputs/full-board-coverage-report-${date}.json`, JSON.stringify(report, null, 2));
fs.writeFileSync("outputs/full-board-coverage-report.json", JSON.stringify(report, null, 2));

console.log("FULL BOARD COVERAGE REPORT");
console.log("--------------------------");
console.log("date:", date);
console.log("board rows:", board.length);
console.log("graded rows:", graded.length);
console.table(rows);
console.log(`saved: outputs/full-board-coverage-report-${date}.json`);
