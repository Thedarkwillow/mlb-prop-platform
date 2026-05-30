const readline = require("readline");
const { spawnSync } = require("child_process");

const today = new Date().toISOString().slice(0, 10);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(q, fallback = "") {
  return new Promise(resolve => {
    const suffix = fallback ? ` [${fallback}]` : "";
    rl.question(`${q}${suffix}: `, ans => resolve(ans.trim() || fallback));
  });
}

(async () => {
  const date = await ask("Date", today);
  const player = await ask("Player");
  const team = await ask("Team");
  const market = await ask("Market", "total_bases");
  const side = await ask("Side", "MORE");
  const line = await ask("Line", "0.5");
  const tier = await ask("Tier", "standard");
  const result = await ask("Result", "PENDING");
  const actual = await ask("Actual", "");
  const played = await ask("Played", "true");
  const notes = await ask("Notes", "");

  rl.close();

  if (!player || !market || !side || !line) {
    console.error("Missing required field: player, market, side, or line.");
    process.exit(1);
  }

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
    `--result=${result}`,
    `--played=${played}`,
    `--notes=${notes}`
  ];

  if (actual !== "") args.push(`--actual=${actual}`);

  const res = spawnSync("npm", args, { stdio: "inherit" });
  process.exit(res.status || 0);
})();
