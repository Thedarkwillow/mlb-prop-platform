const { execSync } = require("child_process");

const DATE = new Date().toISOString().slice(0, 10);

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: "/root/mlb-prop-platform" });
}

if (process.env.ODDS_API_KEY) {
  run("node src/research/oddsapi-playable-games-only.cjs");
  run("node src/research/convert-oddsapi-props.cjs");
} else {
  console.log("Skipping Odds API fetch; using existing data/vegas-raw.json");
}

run("node src/jobs/slipBuilder.js");
run("node src/research/savant-slip-report.cjs");
run("node src/research/lineups-simple.cjs");
run("node src/research/price-current-slips.cjs");
run("node src/research/build-final-slips.cjs");
run("node src/research/final-slip-summary.cjs");
run("node src/research/playable-final-slips.cjs");
run(`node src/research/save-playable-clv-snapshot.cjs ${DATE}`);
run(`node src/research/save-clv-snapshot.cjs ${DATE}`);
run(`node src/research/daily-review-report.cjs ${DATE}`);

console.log("\nfinal daily pipeline complete");
