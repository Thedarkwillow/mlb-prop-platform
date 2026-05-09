const fs = require("fs");
const cp = require("child_process");

function exists(p) { return fs.existsSync(p); }
function ageMin(p) {
  if (!exists(p)) return null;
  return (Date.now() - fs.statSync(p).mtimeMs) / 60000;
}
function fmtAge(x) {
  return x == null ? "missing" : `${x.toFixed(1)} min ago`;
}
function sh(cmd) {
  try { return cp.execSync(cmd, { encoding: "utf8" }).trim(); }
  catch { return ""; }
}

const date = new Date().toISOString().slice(0, 10);
const pp = "data/prizepicks-latest.json";
const vegas = "data/vegas-consensus.json";
const slips = "outputs/final-slips-validated.json";
const latestSnap = `data/odds-history/${date}/latest.json`;

console.log("MLB PROP PLATFORM STATUS");
console.log("========================");
console.log(`date: ${date}`);
console.log("");

console.log("DATA FRESHNESS");
console.log("--------------");
console.log(`PrizePicks: ${fmtAge(ageMin(pp))}`);
console.log(`Vegas/Odds API: ${fmtAge(ageMin(vegas))}`);
console.log(`Latest odds snapshot: ${fmtAge(ageMin(latestSnap))}`);
console.log(`Validated slips: ${fmtAge(ageMin(slips))}`);

console.log("");
console.log("SYSTEM");
console.log("------");
console.log(sh("df -h / | tail -1"));
console.log(sh("free -h | grep Mem"));

console.log("");
console.log("SERVICES");
console.log("--------");
console.log(sh("systemctl is-active mlb-odds-snapshot-loop 2>/dev/null") || "snapshot loop: unknown");

console.log("");
console.log("NEXT COMMANDS");
console.log("-------------");
console.log("Live refresh: npm run daily");
console.log(`Postgame:     npm run postgame --date=${date}`);
console.log("Mobile view:  npm run mobile");
