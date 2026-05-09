const fs = require("fs");

const FILE = "data/results/prop-warehouse.json";
const BACKUP = `data/results/prop-warehouse.backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

const rows = read(FILE, []);
if (!Array.isArray(rows)) {
  console.error("prop warehouse is not an array");
  process.exit(1);
}

fs.copyFileSync(FILE, BACKUP);

const seen = new Set();
const cleaned = [];

for (const r of rows) {
  const key = [
    r.date,
    r.slip,
    r.player,
    r.market,
    r.side,
    r.line,
    r.result,
    r.actual
  ].map(x => String(x ?? "").toLowerCase().trim()).join("|");

  if (seen.has(key)) continue;
  seen.add(key);
  cleaned.push(r);
}

fs.writeFileSync(FILE, JSON.stringify(cleaned, null, 2));

console.log("WAREHOUSE DUPLICATE CLEANER");
console.log("---------------------------");
console.log(`before: ${rows.length}`);
console.log(`after: ${cleaned.length}`);
console.log(`removed: ${rows.length - cleaned.length}`);
console.log(`backup: ${BACKUP}`);
console.log(`wrote: ${FILE}`);
