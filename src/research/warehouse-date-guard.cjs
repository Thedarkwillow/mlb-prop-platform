const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

const required = [
  `outputs/final-slips-${DATE}.json`,
  `outputs/playable-final-slips-graded-${DATE}.json`
];

console.log("WAREHOUSE DATE GUARD");
console.log("--------------------");
console.log(`date: ${DATE}`);

let ok = true;

for (const file of required) {
  if (!fs.existsSync(file)) {
    console.log(`missing: ${file}`);
    ok = false;
  } else {
    console.log(`found: ${file}`);
  }
}

if (!ok) {
  console.log("status: BLOCKED");
  console.log("reason: date-specific files are missing; refusing to mix current board with historical date");
  process.exit(1);
}

console.log("status: OK");
