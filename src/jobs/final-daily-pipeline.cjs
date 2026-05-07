const { execSync } = require("child_process");

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: "/root/mlb-prop-platform" });
}

console.log("Skipping vegas scraper; using webhook-provided data/vegas-raw.json");
run("node src/jobs/slipBuilder.js");
run("node src/research/savant-slip-report.cjs");
run("node src/research/lineups-simple.cjs");
run("node src/research/price-current-slips.cjs");
run("node src/research/build-final-slips.cjs");
run("node src/research/final-slip-summary.cjs\nnode src/research/playable-final-slips.cjs");
run(`node src/research/save-clv-snapshot.cjs ${new Date().toISOString().slice(0, 10)}`);

console.log("\nfinal daily pipeline complete");
