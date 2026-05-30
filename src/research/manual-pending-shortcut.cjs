const { spawnSync } = require("child_process");

const [
  player,
  team = "",
  market = "total_bases",
  side = "MORE",
  line = "0.5",
  tier = "standard",
  ...notesParts
] = process.argv.slice(2);

if (!player) {
  console.error(`
Usage:
  npm run manual:pending -- "Player Name" TEAM market SIDE line tier "notes"

Example:
  npm run manual:pending -- "Juan Soto" NYM total_bases MORE 0.5 goblin "elite bat low TB goblin"
`);
  process.exit(1);
}

const date = new Date().toISOString().slice(0, 10);
const notes = notesParts.join(" ");

const args = [
  "run",
  "manual:add",
  "--",
  `--date=${date}`,
  `--player=${player}`,
  `--team=${team}`,
  `--market=${market}`,
  `--side=${side}`,
  `--line=${line}`,
  `--tier=${tier}`,
  "--result=PENDING",
  "--played=true",
  `--notes=${notes}`
];

const res = spawnSync("npm", args, { stdio: "inherit" });
process.exit(res.status || 0);
