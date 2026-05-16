const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const RUNS = Number(process.env.ROR_RUNS || 10000);
const SLATES = Number(process.env.ROR_SLATES || 100);
const START_BANKROLL = Number(process.env.BANKROLL || 1000);
const RUIN_PCT = Number(process.env.RUIN_PCT || 0.5);
const DRAWDOWN_PCT = Number(process.env.DRAWDOWN_PCT || 0.2);

function read(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function q(values, pct) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * pct)];
}

function powerPayout(size) {
  return {
    2: 3,
    3: 5,
    4: 10,
    5: 20,
    6: 25
  }[size] || null;
}

function simulateBet(bet, bankroll) {
  const hitRate = Number(bet.hitRate || 0);
  const betSize = Number(bet.betSize || 0);
  const payout = Number(bet.payout || powerPayout(bet.size) || 0);

  if (!hitRate || !betSize || !payout) return 0;

  const hit = Math.random() < hitRate;
  if (hit) return betSize * (payout - 1);
  return -betSize;
}

const bankrollPlan = read(
  `outputs/phase7-bankroll-${DATE}.json`,
  read("outputs/phase7-bankroll.json", null)
);

if (!bankrollPlan || !Array.isArray(bankrollPlan.bets)) {
  console.error("Missing bankroll plan. Run:");
  console.error(`node src/research/phase7-bankroll.cjs ${DATE}`);
  process.exit(1);
}

const bets = bankrollPlan.bets;

if (!bets.length) {
  const empty = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    note: "No bankroll bets available; risk-of-ruin skipped.",
    settings: { runs: RUNS, slates: SLATES, startBankroll: START_BANKROLL },
    summary: null,
    bets: []
  };

  write(`outputs/phase7-risk-of-ruin-${DATE}.json`, empty);
  write("outputs/phase7-risk-of-ruin.json", empty);
  console.log("No bets available for risk-of-ruin simulation.");
  process.exit(0);
}

const endingBankrolls = [];
const maxDrawdowns = [];
let ruinCount = 0;
let drawdownCount = 0;
let profitableRuns = 0;

for (let r = 0; r < RUNS; r++) {
  let bankroll = START_BANKROLL;
  let peak = START_BANKROLL;
  let maxDrawdown = 0;
  let ruined = false;
  let hitDrawdown = false;

  for (let slate = 0; slate < SLATES; slate++) {
    for (const bet of bets) {
      const scaledBet = {
        ...bet,
        betSize: bankroll * Number(bet.betPct || 0)
      };

      bankroll += simulateBet(scaledBet, bankroll);

      if (bankroll > peak) peak = bankroll;

      const dd = peak > 0 ? (peak - bankroll) / peak : 1;
      if (dd > maxDrawdown) maxDrawdown = dd;

      if (bankroll <= START_BANKROLL * RUIN_PCT) ruined = true;
      if (dd >= DRAWDOWN_PCT) hitDrawdown = true;

      if (bankroll <= 0) {
        bankroll = 0;
        ruined = true;
        break;
      }
    }

    if (bankroll <= 0) break;
  }

  endingBankrolls.push(bankroll);
  maxDrawdowns.push(maxDrawdown);

  if (ruined) ruinCount++;
  if (hitDrawdown) drawdownCount++;
  if (bankroll > START_BANKROLL) profitableRuns++;
}

const avgEnding =
  endingBankrolls.reduce((a, b) => a + b, 0) / endingBankrolls.length;

const avgDrawdown =
  maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length;

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  note: "Phase 7 risk-of-ruin simulation. Shadow-only; uses current bankroll plan repeatedly over future slates.",
  settings: {
    runs: RUNS,
    slates: SLATES,
    startBankroll: START_BANKROLL,
    ruinPct: RUIN_PCT,
    drawdownPct: DRAWDOWN_PCT
  },
  bets,
  summary: {
    runs: RUNS,
    slates: SLATES,
    ruinRate: Number((ruinCount / RUNS).toFixed(4)),
    drawdownRate: Number((drawdownCount / RUNS).toFixed(4)),
    profitableRate: Number((profitableRuns / RUNS).toFixed(4)),
    avgEndingBankroll: Number(avgEnding.toFixed(2)),
    medianEndingBankroll: Number(q(endingBankrolls, 0.5).toFixed(2)),
    p05EndingBankroll: Number(q(endingBankrolls, 0.05).toFixed(2)),
    p95EndingBankroll: Number(q(endingBankrolls, 0.95).toFixed(2)),
    avgMaxDrawdown: Number(avgDrawdown.toFixed(4)),
    medianMaxDrawdown: Number(q(maxDrawdowns, 0.5).toFixed(4)),
    p95MaxDrawdown: Number(q(maxDrawdowns, 0.95).toFixed(4))
  }
};

write(`outputs/phase7-risk-of-ruin-${DATE}.json`, report);
write("outputs/phase7-risk-of-ruin.json", report);

console.log("PHASE 7 RISK OF RUIN");
console.log("====================");
console.log("date:", DATE);
console.log("runs:", RUNS);
console.log("slates:", SLATES);
console.table([report.summary]);
console.log(`Wrote outputs/phase7-risk-of-ruin-${DATE}.json`);
console.log("Wrote outputs/phase7-risk-of-ruin.json");
