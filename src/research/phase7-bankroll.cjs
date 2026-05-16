const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const BANKROLL = Number(process.env.BANKROLL || 1000);
const KELLY_FRACTION = Number(process.env.KELLY_FRACTION || 0.25);
const MAX_BET_PCT = Number(process.env.MAX_BET_PCT || 0.05);
const MIN_EDGE = Number(process.env.MIN_EDGE || 0.01);

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

function payoutMultiplier(size, mode) {
  if (mode === "POWER") {
    if (size === 2) return 3;
    if (size === 3) return 5;
    if (size === 4) return 10;
    if (size === 5) return 20;
    if (size === 6) return 25;
  }
  return null;
}

function kellyFraction(p, b) {
  if (!Number.isFinite(p) || !Number.isFinite(b)) return 0;
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

const portfolio = read(`outputs/phase7-portfolio-${DATE}.json`, read("outputs/phase7-portfolio.json", null));

if (!portfolio || !Array.isArray(portfolio.selected)) {
  console.error("Missing portfolio file");
  process.exit(1);
}

const bets = [];

for (const slip of portfolio.selected) {
  const size = slip.size;
  const mode = slip.recommendedMode;

  if (mode !== "POWER") continue; // simplify first version

  const payout = payoutMultiplier(size, mode);
  if (!payout) continue;

  const b = payout - 1;
  const p = Number(slip.power?.hitRate ?? 0);

  const rawKelly = kellyFraction(p, b);
  const adjustedKelly = rawKelly * KELLY_FRACTION;

  const cappedKelly = Math.min(adjustedKelly, MAX_BET_PCT);

  if (cappedKelly < MIN_EDGE) continue;

  const betSize = Number((BANKROLL * cappedKelly).toFixed(2));

  bets.push({
    slip: slip.name,
    size,
    mode,
    hitRate: p,
    payout,
    rawKelly,
    adjustedKelly,
    cappedKelly,
    betPct: cappedKelly,
    betSize
  });
}

const result = {
  date: DATE,
  bankroll: BANKROLL,
  kellyFraction: KELLY_FRACTION,
  maxBetPct: MAX_BET_PCT,
  bets,
  summary: {
    totalBets: bets.length,
    totalRisk: Number(
      bets.reduce((a, b) => a + b.betSize, 0).toFixed(2)
    )
  }
};

write(`outputs/phase7-bankroll-${DATE}.json`, result);
write("outputs/phase7-bankroll.json", result);

console.log("PHASE 7 BANKROLL");
console.log("=================");
console.log("bankroll:", BANKROLL);
console.table(
  bets.map(b => ({
    slip: b.slip,
    size: b.size,
    pct: b.betPct,
    bet: b.betSize
  }))
);
console.log(`Wrote outputs/phase7-bankroll-${DATE}.json`);
console.log("Wrote outputs/phase7-bankroll.json");
