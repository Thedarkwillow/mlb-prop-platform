const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const DIR = `data/odds-history/${DATE}`;

console.log("ODDS SNAPSHOT STATUS");
console.log("--------------------");
console.log(`date: ${DATE}`);

if (!fs.existsSync(DIR)) {
  console.log("status: MISSING");
  console.log("warning: no odds snapshot folder found");
  console.log("run: npm run snap");
  process.exit(0);
}

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith(".json"))
  .sort();

console.log(`snapshots: ${files.length}`);

if (!files.length) {
  console.log("status: MISSING");
  console.log("warning: no odds snapshot files found");
  console.log("run: npm run snap");
  process.exit(0);
}

console.log("status: OK");
console.log(`first: ${files[0]}`);
console.log(`latest: ${files[files.length - 1]}`);
