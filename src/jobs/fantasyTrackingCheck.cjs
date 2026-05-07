const fs = require("fs");

const date = process.argv[2];

if (!date) {
  console.error("Usage: node src/jobs/fantasyTrackingCheck.cjs YYYY-MM-DD");
  process.exit(1);
}

const gradedPath = `outputs/history/${date}-graded-slips.json`;

if (!fs.existsSync(gradedPath)) {
  console.error(`Missing ${gradedPath}`);
  process.exit(1);
}

const slips = JSON.parse(fs.readFileSync(gradedPath, "utf8"));
const legs = slips.flatMap(s => s.legs || []);

const fantasyLegs = legs.filter(l => {
  const m = String(l.market || l.stat || "").toLowerCase();
  return m.includes("fantasy");
});

console.log("FANTASY TRACKING CHECK");
console.log("Date:", date);
console.log("Fantasy legs found:", fantasyLegs.length);

if (!fantasyLegs.length) {
  console.log("No fantasy legs in locked slate. Good — tracking-only mode is safe.");
  process.exit(0);
}

for (const leg of fantasyLegs) {
  console.log({
    player: leg.player,
    team: leg.team,
    market: leg.market || leg.stat,
    line: leg.line,
    side: leg.side || leg.recommendedSide,
    actual: leg.actual,
    result: leg.result,
  });
}

console.log("Fantasy is tracking-only. Do not allow into slips yet.");
