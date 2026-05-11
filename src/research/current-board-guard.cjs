const fs = require("fs");

const REQUIRED = [
  "outputs/priced-board.json"
];

const maxAgeMinutes = 180;
const now = Date.now();
let failed = false;

console.log("CURRENT BOARD GUARD");
console.log("===================");

for (const file of REQUIRED) {
  if (!fs.existsSync(file)) {
    console.log(`MISSING: ${file}`);
    failed = true;
    continue;
  }

  const stat = fs.statSync(file);
  const ageMin = (now - stat.mtimeMs) / 60000;

  console.log(`${file} | modified=${stat.mtime.toISOString()} | age=${ageMin.toFixed(1)} min`);

  if (ageMin > maxAgeMinutes) {
    console.log(`STALE: ${file}`);
    failed = true;
  }
}

if (failed) {
  console.log("status: BLOCKED");
  console.log("reason: current board files are missing or stale");
  process.exit(1);
}

console.log("status: PASS");
