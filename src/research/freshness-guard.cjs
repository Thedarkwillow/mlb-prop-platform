const fs = require("fs");

const MAX = {
  prizepicks: 20,
  vegas: 20,
  snapshot: 35
};

function ageMin(path) {
  if (!fs.existsSync(path)) return null;
  return (Date.now() - fs.statSync(path).mtimeMs) / 60000;
}

function check(label, path, maxMin) {
  const age = ageMin(path);
  if (age == null) return { label, ok: false, msg: `${label}: missing ${path}` };
  if (age > maxMin) return { label, ok: false, msg: `${label}: stale ${age.toFixed(1)} min old, max ${maxMin}` };
  return { label, ok: true, msg: `${label}: OK ${age.toFixed(1)} min old` };
}

const date = new Date().toISOString().slice(0, 10);
const checks = [
  check("PrizePicks", "data/prizepicks-latest.json", MAX.prizepicks),
  check("Vegas/Odds API", "data/vegas-consensus.json", MAX.vegas),
  check("Odds snapshot", `data/odds-history/${date}/latest.json`, MAX.snapshot)
];

console.log("FRESHNESS GUARD");
console.log("---------------");
for (const c of checks) console.log(c.msg);

const failed = checks.filter(c => !c.ok);
if (failed.length) {
  console.log("");
  console.log("BLOCKED: refresh data first with:");
  console.log("npm run daily");
  process.exit(1);
}

console.log("");
console.log("status: OK");
