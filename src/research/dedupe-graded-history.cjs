const fs = require("fs");

const IN = "data/history/all-graded-slips.jsonl";

if (!fs.existsSync(IN)) {
  console.log("No history file yet.");
  process.exit(0);
}

const rows = fs.readFileSync(IN, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(x => JSON.parse(x));

const seen = new Set();
const out = [];

for (const r of rows) {
  const key = [
    r.date,
    r.player,
    r.game,
    r.market,
    r.side,
    r.line
  ].join("|");

  if (seen.has(key)) continue;
  seen.add(key);
  out.push(r);
}

fs.writeFileSync(IN, out.map(x => JSON.stringify(x)).join("\n") + "\n");

console.log(`Deduped history: ${rows.length} -> ${out.length}`);
