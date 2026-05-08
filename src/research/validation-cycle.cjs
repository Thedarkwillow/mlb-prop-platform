const { execSync } = require("child_process");
const date = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0,10);

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", shell: "/bin/bash" });
}

run(`npm run grade --date=${date}`);
run(`npm run roi --date=${date}`);
run(`npm run clv --date=${date}`);
run(`npm run mobile --date=${date}`);
