const fs = require("fs");
const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const unmatched = read(`outputs/history/${DATE}-full-board-unmatched.json`, []);
const graded = read(`outputs/history/${DATE}-full-board-graded.json`, []);

const byReason = {};
const byMarket = {};

for (const r of unmatched) {
  const reason = r.reason || "unknown";
  const market = r.market || "unknown";
  byReason[reason] = (byReason[reason] || 0) + 1;
  byMarket[market] = (byMarket[market] || 0) + 1;
}

const report = {
  date: DATE,
  graded: graded.length,
  dropped: unmatched.length,
  dropRate: graded.length + unmatched.length
    ? Number((unmatched.length / (graded.length + unmatched.length)).toFixed(4))
    : 0,
  byReason,
  byMarket,
  examples: unmatched.slice(0, 25)
};

fs.mkdirSync("outputs/history", { recursive: true });
fs.writeFileSync(`outputs/history/${DATE}-full-board-drop-report.json`, JSON.stringify(report, null, 2));

console.log(`FULL BOARD DROP REPORT ${DATE}`);
console.log(report);
