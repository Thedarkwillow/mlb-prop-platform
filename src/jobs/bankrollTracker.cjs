// src/jobs/bankrollTracker.js

const fs = require("fs");

const FILE = "outputs/bankroll.json";

let state = {
  bankroll: 1000,
  unitSize: 10,
  history: []
};

if (fs.existsSync(FILE)) {
  state = JSON.parse(fs.readFileSync(FILE, "utf8"));
}

const slips = JSON.parse(fs.readFileSync("outputs/slips.json", "utf8"));

for (const slip of slips) {
  if (!slip.complete) continue;

  const win = slip.result === "win";

  const units = 1; // base unit per slip (expand later)
  const profit = win ? units * 2 : -units;

  state.bankroll += profit;

  state.history.push({
    date: new Date().toISOString(),
    result: win ? "win" : "loss",
    units,
    profit,
    bankroll: state.bankroll
  });
}

fs.writeFileSync(FILE, JSON.stringify(state, null, 2));

console.log("Bankroll:", state.bankroll);
