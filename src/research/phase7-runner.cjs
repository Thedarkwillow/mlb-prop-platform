const { spawnSync } = require("child_process");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

function run(label, cmd, args, env = {}) {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...env }
  });

  if (res.status !== 0) {
    console.error(`FAILED: ${label}`);
    process.exit(res.status || 1);
  }
}

console.log("PHASE 7 MASTER RUNNER");
console.log("=====================");
console.log("date:", DATE);

run("Simulation", "node", ["src/research/phase7-simulation.cjs", DATE]);
run("Portfolio Optimizer", "node", ["src/research/phase7-portfolio-optimizer.cjs", DATE]);

// First bankroll pass before risk.
run("Initial Bankroll", "node", ["src/research/phase7-bankroll.cjs", DATE]);

// Risk uses initial bankroll output.
run("Risk of Ruin", "node", ["src/research/phase7-risk-of-ruin.cjs", DATE]);

// Second bankroll pass applies drawdown-aware risk scaling.
run("Risk-Adjusted Bankroll", "node", ["src/research/phase7-bankroll.cjs", DATE]);
run("PostgreSQL Export", "node", ["src/db/export-json-to-postgres.cjs", DATE]);

console.log("\nPHASE 7 COMPLETE");
console.log("================");
console.log("Wrote:");
console.log(`outputs/phase7-simulation-${DATE}.json`);
console.log(`outputs/phase7-portfolio-${DATE}.json`);
console.log(`outputs/phase7-bankroll-${DATE}.json`);
console.log(`outputs/phase7-risk-of-ruin-${DATE}.json`);
