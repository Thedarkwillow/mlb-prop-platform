const fs = require("fs");
const path = require("path");

const DEFAULT_TABLE_PATH = path.join(
  process.cwd(),
  "data",
  "payouts",
  "prizepicks-payout-table.json"
);

function loadPayoutTable(tablePath = DEFAULT_TABLE_PATH) {
  if (!fs.existsSync(tablePath)) {
    throw new Error(`Missing PrizePicks payout table: ${tablePath}`);
  }
  return JSON.parse(fs.readFileSync(tablePath, "utf8"));
}

function getLegTier(leg) {
  const raw =
    leg.tier ||
    leg.projectionType ||
    leg.specialType ||
    leg.pickType ||
    leg.variant ||
    "";

  const s = String(raw).toLowerCase();

  if (s.includes("goblin")) return "goblin";
  if (s.includes("demon")) return "demon";

  if (leg.isGoblin === true) return "goblin";
  if (leg.isDemon === true) return "demon";

  return "standard";
}

function getSlipConfigKey(legs) {
  let goblins = 0;
  let demons = 0;

  for (const leg of legs || []) {
    const tier = getLegTier(leg);
    if (tier === "goblin") goblins += 1;
    if (tier === "demon") demons += 1;
  }

  return `${goblins}G_${demons}D`;
}

function getLegProbability(leg) {
  const candidates = [
    leg.phase55Prob,
    leg.adjustedProb,
    leg.finalProb,
    leg.probability,
    leg.prob,
    leg.p
  ];

  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n < 1) return n;
  }

  return null;
}

function jointWinProbability(legs) {
  let p = 1;

  for (const leg of legs || []) {
    const legProb = getLegProbability(leg);
    if (legProb == null) return null;
    p *= legProb;
  }

  return p;
}

function getPowerPayout({ table, legs }) {
  const size = String(legs.length);
  const key = getSlipConfigKey(legs);
  const sizeTable = table.power?.[size];

  if (!sizeTable) return null;

  if (sizeTable[key] != null) return Number(sizeTable[key]);

  // Safe fallback: standard payout only.
  if (sizeTable["0G_0D"] != null) return Number(sizeTable["0G_0D"]);

  return null;
}

function getFlexPayoutMap({ table, legs }) {
  const size = String(legs.length);
  const key = getSlipConfigKey(legs);
  const sizeTable = table.flex?.[size];

  if (!sizeTable) return null;

  if (sizeTable[key] != null) return sizeTable[key];

  // Safe fallback: standard payout only.
  if (sizeTable["0G_0D"] != null) return sizeTable["0G_0D"];

  return null;
}

function impliedPowerSlipProbability(payout) {
  const x = Number(payout);
  if (!Number.isFinite(x) || x <= 0) return null;
  return 1 / x;
}

function impliedPowerLegProbability({ payout, legCount }) {
  const slipProb = impliedPowerSlipProbability(payout);
  if (slipProb == null) return null;
  return Math.pow(slipProb, 1 / legCount);
}

function powerEV({ legs, payout }) {
  const winProb = jointWinProbability(legs);
  if (winProb == null || payout == null) return null;

  // Unit stake EV: win returns payout including stake-style multiplier.
  return winProb * Number(payout) - 1;
}

function combinations(arr, k) {
  const out = [];

  function backtrack(start, combo) {
    if (combo.length === k) {
      out.push(combo.slice());
      return;
    }

    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      backtrack(i + 1, combo);
      combo.pop();
    }
  }

  backtrack(0, []);
  return out;
}

function probabilityExactlyKWins(legs, k) {
  const probs = legs.map(getLegProbability);
  if (probs.some((p) => p == null)) return null;

  const indexes = probs.map((_, i) => i);
  const winCombos = combinations(indexes, k);

  let total = 0;

  for (const wins of winCombos) {
    const winSet = new Set(wins);
    let p = 1;

    for (let i = 0; i < probs.length; i++) {
      p *= winSet.has(i) ? probs[i] : 1 - probs[i];
    }

    total += p;
  }

  return total;
}

function flexEV({ legs, payoutMap }) {
  if (!payoutMap) return null;

  let evReturn = 0;

  for (const [wins, payout] of Object.entries(payoutMap)) {
    const k = Number(wins);
    const mult = Number(payout);

    if (!Number.isFinite(k) || !Number.isFinite(mult)) continue;

    const prob = probabilityExactlyKWins(legs, k);
    if (prob == null) return null;

    evReturn += prob * mult;
  }

  return evReturn - 1;
}

function priceSlip({ legs, mode = "power", table = loadPayoutTable() }) {
  if (!Array.isArray(legs) || legs.length < 2) {
    throw new Error("priceSlip requires at least 2 legs");
  }

  const configKey = getSlipConfigKey(legs);
  const legCount = legs.length;

  if (mode === "power") {
    const payout = getPowerPayout({ table, legs });
    const modelWinProb = jointWinProbability(legs);
    const impliedSlipProb = impliedPowerSlipProbability(payout);
    const impliedLegProb = impliedPowerLegProbability({ payout, legCount });
    const ev = powerEV({ legs, payout });

    return {
      mode,
      legCount,
      configKey,
      payout,
      modelWinProb,
      impliedSlipProb,
      impliedLegProb,
      ev,
      evPct: ev == null ? null : ev * 100
    };
  }

  if (mode === "flex") {
    const payoutMap = getFlexPayoutMap({ table, legs });
    const ev = flexEV({ legs, payoutMap });

    return {
      mode,
      legCount,
      configKey,
      payoutMap,
      ev,
      evPct: ev == null ? null : ev * 100
    };
  }

  throw new Error(`Unknown slip mode: ${mode}`);
}

module.exports = {
  loadPayoutTable,
  getLegTier,
  getSlipConfigKey,
  getLegProbability,
  jointWinProbability,
  priceSlip,
  powerEV,
  flexEV,
  impliedPowerSlipProbability,
  impliedPowerLegProbability
};
