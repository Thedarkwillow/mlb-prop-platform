const { execSync } = require("child_process");

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: "/root/mlb-prop-platform" });
}

run("node src/scrapers/savant.js");
run("node src/jobs/slipBuilder.js");
run("node src/research/repair-slip-gamepks.cjs");
run("node src/research/lineup-checker.cjs");
run("node src/research/price-current-slips.cjs");
run("node src/research/savant-slip-report.cjs");

console.log("daily refresh complete");
