const { execSync } = require("child_process");

function run(cmd) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run("node src/research/repair-slip-gamepks.cjs 2026-05-05");
run("node src/research/lineup-checker.cjs");
run("node src/research/price-current-slips.cjs");
