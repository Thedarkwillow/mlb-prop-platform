const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

const outDir = path.join("data", "history", date);

fs.mkdirSync(outDir, { recursive: true });

const files = [
  "outputs/slips-priced.json",
  "outputs/slips-distribution-enriched.json",
  "outputs/final-slips.json",
  "outputs/playable-final-slips.json",
  "outputs/distribution-coverage-report.json"
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;

  const target = path.join(outDir, path.basename(file));
  fs.copyFileSync(file, target);

  console.log("archived:", target);
}

console.log("archive complete:", date);
