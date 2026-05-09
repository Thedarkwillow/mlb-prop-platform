const fs = require("fs");

const files = [
  "outputs/slips.json",
  "outputs/slips-priced.json",
  "outputs/slips-distribution-enriched.json",
  "outputs/final-slips.json"
];

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function flatten(x) {
  if (Array.isArray(x)) return x.flatMap(flatten);
  if (x && typeof x === "object") return [x, ...Object.values(x).flatMap(flatten)];
  return [];
}

let found = [];

for (const file of files) {
  const raw = read(file, null);
  if (!raw) continue;

  const rows = flatten(raw).filter(x => x && typeof x === "object");
  const fantasy = rows.filter(r =>
    String(r.market || r.stat || r.statKey || r.rawMarket || "").toLowerCase().includes("fantasy") ||
    JSON.stringify(r).toLowerCase().includes("fantasy")
  );

  found.push({ file, rows: rows.length, fantasy: fantasy.length });
}

console.log("FANTASY AVAILABILITY");
console.table(found);

const total = found.reduce((a, x) => a + x.fantasy, 0);
if (total > 0) {
  console.log(`READY: fantasy props found = ${total}`);
  process.exit(0);
}

console.log("NOT READY: no fantasy props found yet.");
process.exit(0);
