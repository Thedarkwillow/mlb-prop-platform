const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

const dir = path.join("data", "history", date);

if (!fs.existsSync(dir)) {
  console.error(`No history folder found for ${date}`);
  process.exit(1);
}

console.log(`\nHISTORY FILES ${date}\n`);

const files = fs.readdirSync(dir).sort();

for (const file of files) {
  const full = path.join(dir, file);
  const stat = fs.statSync(full);
  console.log(`${file} | ${(stat.size / 1024).toFixed(1)} KB`);
}
