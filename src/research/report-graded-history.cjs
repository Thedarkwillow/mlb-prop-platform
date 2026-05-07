const fs = require("fs");

const IN = "data/history/all-graded-slips.jsonl";

if (!fs.existsSync(IN)) {
  console.error("Missing", IN);
  process.exit(1);
}

const rows = fs.readFileSync(IN, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(x => JSON.parse(x))
  .filter(x => ["HIT", "MISS", "PUSH"].includes(x.result));

function summarize(name, rows) {
  const decided = rows.filter(x => x.result !== "PUSH");
  const hits = decided.filter(x => x.result === "HIT").length;
  const misses = decided.filter(x => x.result === "MISS").length;
  const total = hits + misses;
  return {
    group: name,
    total,
    hits,
    misses,
    pushes: rows.filter(x => x.result === "PUSH").length,
    hitRate: total ? +(hits / total).toFixed(4) : null
  };
}

function groupBy(key) {
  const map = new Map();
  for (const r of rows) {
    const k = r[key] ?? "UNKNOWN";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()].map(([k, v]) => summarize(k, v));
}

console.log("\nOVERALL");
console.table([summarize("ALL", rows)]);

console.log("\nBY MARKET");
console.table(groupBy("market"));

console.log("\nBY SIDE");
console.table(groupBy("side"));

console.log("\nBY GRADE");
console.table(groupBy("grade"));

console.log("\nBY SAVANT");
console.table(groupBy("savant"));
