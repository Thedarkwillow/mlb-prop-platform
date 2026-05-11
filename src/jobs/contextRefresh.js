import { execSync } from "child_process";

const date =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

function run(label, cmd) {
  console.log(`\n=== ${label} ===`);
  execSync(cmd, {
    stdio: "inherit",
    env: {
      ...process.env,
      SLATE_DATE: date,
      SAVANT_MAX_PITCHERS: process.env.SAVANT_MAX_PITCHERS || "35",
      PITCHER_STATS_MAX: process.env.PITCHER_STATS_MAX || "180"
    }
  });
}

run("Probable pitcher hands", "npm run context:pitcher-hands");
run("Savant handedness splits", "npm run savant:handedness");
run("Pitching staffs", "npm run context:pitching-staffs");
run("Savant velocity / arsenal", "node --max-old-space-size=768 src/learning/pull-savant-pitcher-velocity-trends.cjs");
run("Pitching staffs refresh with arsenal", "npm run context:pitching-staffs");
run("Automated pitcher stats", "npm run context:pitcher-stats");
run("Game model context", "npm run context:game-model");
run("Lineup handedness readiness", "npm run context:lineup-handedness");
run("Pitch-type matchups", "npm run savant:pitch-matchups");
run("Rolling ROI validation", "npm run learn:rolling-roi");
run("Weak environment rules", "npm run learn:weak-env");

console.log("\nCONTEXT REFRESH COMPLETE");
console.log(`Date: ${date}`);
