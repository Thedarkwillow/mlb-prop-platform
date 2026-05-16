const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const ITERATIONS = Number(process.env.SIM_ITERATIONS || 20000);

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

function probOf(row) {
  const p = Number(
    row.calibratedDistributionProb ??
    row.recommendedProb ??
    row.probability ??
    row.prob
  );
  if (!Number.isFinite(p)) return null;
  return Math.max(0.01, Math.min(0.99, p));
}

function market(row) {
  return String(row.market || row.stat || "").toLowerCase().trim();
}

function side(row) {
  return String(row.side || row.recommendedSide || "").toUpperCase().trim();
}

function legKey(row) {
  return [
    row.player || "",
    market(row),
    side(row),
    row.line ?? row.ppLine ?? ""
  ].join("|");
}

function playerKey(row) {
  return String(row.player || "").toLowerCase().trim();
}

function teamKey(row) {
  return String(row.team || "").toUpperCase().trim();
}

function gameKey(row) {
  return String(row.game || row.matchup || "").toUpperCase().trim();
}

function propKey(row) {
  return [playerKey(row), market(row)].join("|");
}

function oddsTier(row) {
  return String(row.oddsTier || row.tier || "standard").toLowerCase().trim();
}

function isSpecial(row) {
  return ["goblin", "demon"].includes(oddsTier(row));
}

function violatesSlipConstraints(candidate, slip) {
  const candidatePlayer = playerKey(candidate);
  const candidateTeam = teamKey(candidate);
  const candidateGame = gameKey(candidate);
  const candidateProp = propKey(candidate);
  const candidateMarket = market(candidate);

  for (const leg of slip) {
    if (playerKey(leg) === candidatePlayer) return true;
    if (propKey(leg) === candidateProp) return true;
  }

  const sameTeamCount = slip.filter(l => teamKey(l) && teamKey(l) === candidateTeam).length;
  if (candidateTeam && sameTeamCount >= 2) return true;

  const sameGameCount = slip.filter(l => gameKey(l) && gameKey(l) === candidateGame).length;
  if (candidateGame && sameGameCount >= 3) return true;

  const specialCount = slip.filter(isSpecial).length;
  if (isSpecial(candidate) && specialCount >= 1) return true;

  const volatileMarkets = new Set(["home_runs", "hr", "triples"]);
  if (volatileMarkets.has(candidateMarket)) return true;

  return false;
}

function buildConstrainedSlip(rows, size) {
  const slip = [];
  for (const row of rows) {
    if (slip.length >= size) break;
    if (violatesSlipConstraints(row, slip)) continue;
    slip.push(row);
  }
  return slip.length === size ? slip : [];
}

function simulateLeg(prob) {
  return Math.random() < prob;
}

function powerPayout(size) {
  return {
    2: 3,
    3: 5,
    4: 10,
    5: 20,
    6: 37.5
  }[size] || null;
}

function flexPayout(size, hits) {
  if (size === 3) {
    if (hits === 3) return 2.25;
    if (hits === 2) return 1.25;
  }
  if (size === 4) {
    if (hits === 4) return 5;
    if (hits === 3) return 1.5;
  }
  if (size === 5) {
    if (hits === 5) return 10;
    if (hits === 4) return 2;
    if (hits === 3) return 0.4;
  }
  if (size === 6) {
    if (hits === 6) return 25;
    if (hits === 5) return 2;
    if (hits === 4) return 0.4;
  }
  return 0;
}

function summarize(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const q = p => sorted[Math.floor((sorted.length - 1) * p)];
  return {
    avg: Number(avg.toFixed(4)),
    p05: Number(q(0.05).toFixed(4)),
    p25: Number(q(0.25).toFixed(4)),
    median: Number(q(0.5).toFixed(4)),
    p75: Number(q(0.75).toFixed(4)),
    p95: Number(q(0.95).toFixed(4))
  };
}

function simulateSlip(slip) {
  const legs = slip.legs || [];
  const size = legs.length;
  if (!size) return null;

  const probs = legs.map(probOf).filter(p => p !== null);
  if (probs.length !== size) return null;

  const powerReturns = [];
  const flexReturns = [];
  let powerHits = 0;
  let flexProfitCount = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    let hits = 0;
    for (const p of probs) {
      if (simulateLeg(p)) hits++;
    }

    const powerReturn = hits === size ? powerPayout(size) : 0;
    const flexReturn = flexPayout(size, hits);

    powerReturns.push(powerReturn - 1);
    flexReturns.push(flexReturn - 1);

    if (hits === size) powerHits++;
    if (flexReturn > 1) flexProfitCount++;
  }

  const powerAvg = powerReturns.reduce((a, b) => a + b, 0) / ITERATIONS;
  const flexAvg = flexReturns.reduce((a, b) => a + b, 0) / ITERATIONS;

  return {
    name: slip.name || `${size}-leg slip`,
    size,
    legs: legs.map(l => ({
      player: l.player,
      market: market(l),
      side: side(l),
      line: l.line ?? l.ppLine,
      prob: probOf(l),
      edge: l.edge ?? l.adjustedEdge ?? l.sportsbookAdjustedEdge ?? null
    })),
    power: {
      hitRate: Number((powerHits / ITERATIONS).toFixed(4)),
      avgProfitPerUnit: Number(powerAvg.toFixed(4)),
      roi: Number(powerAvg.toFixed(4)),
      distribution: summarize(powerReturns)
    },
    flex: {
      profitRate: Number((flexProfitCount / ITERATIONS).toFixed(4)),
      avgProfitPerUnit: Number(flexAvg.toFixed(4)),
      roi: Number(flexAvg.toFixed(4)),
      distribution: summarize(flexReturns)
    },
    recommendation:
      powerAvg > flexAvg
        ? "POWER"
        : flexAvg > powerAvg
          ? "FLEX"
          : "NEUTRAL"
  };
}

function buildCandidateSlips(rows) {
  const usable = rows
    .filter(r => probOf(r) !== null)
    .filter(r => {
      const m = market(r);
      if (!m) return false;
      if (m.includes("fantasy")) return false;
      return true;
    })
    .sort((a, b) => probOf(b) - probOf(a));

  const seen = new Set();
  const unique = [];
  for (const r of usable) {
    const k = legKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(r);
  }

  return [2, 3, 4, 5, 6]
    .map(size => ({
      name: `PHASE 7 SIM ${size}-LEG`,
      legs: buildConstrainedSlip(unique, size)
    }))
    .filter(slip => slip.legs.length === Number(slip.name.match(/(\d+)-LEG/)?.[1] || 0));
}

const playable = read("outputs/playable-final-slips.json", []);
const watchlist = read("outputs/watchlist-final-slips.json", []);
const enriched = read("outputs/slips-distribution-enriched.json", []);
const finalSlipsRaw = read("outputs/final-slips.json", []);
const finalSlips = Array.isArray(finalSlipsRaw)
  ? finalSlipsRaw
  : Array.isArray(finalSlipsRaw.slips)
    ? finalSlipsRaw.slips
    : Array.isArray(finalSlipsRaw.finalSlips)
      ? finalSlipsRaw.finalSlips
      : [];

const sourceSlips = [
  ...playable.filter(s => (s.legs || []).length),
  ...watchlist.filter(s => (s.legs || []).length),
  ...finalSlips.filter(s => (s.legs || []).length)
];

const candidateSlips = sourceSlips.length ? sourceSlips : buildCandidateSlips(enriched);

const simulations = candidateSlips
  .map(simulateSlip)
  .filter(Boolean)
  .sort((a, b) => b.flex.roi - a.flex.roi);

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  iterations: ITERATIONS,
  note: "Phase 7 base Monte Carlo simulation. Shadow-only; does not change official slips.",
  slipCount: simulations.length,
  simulations
};

write(`outputs/phase7-simulation-${DATE}.json`, report);
write("outputs/phase7-simulation.json", report);

console.log("PHASE 7 BASE SIMULATION");
console.log("=======================");
console.log("date:", DATE);
console.log("iterations:", ITERATIONS);
console.log("slips simulated:", simulations.length);
console.table(
  simulations.map(s => ({
    slip: s.name,
    size: s.size,
    powerROI: s.power.roi,
    powerHitRate: s.power.hitRate,
    flexROI: s.flex.roi,
    flexProfitRate: s.flex.profitRate,
    recommendation: s.recommendation
  }))
);
console.log(`Wrote outputs/phase7-simulation-${DATE}.json`);
console.log("Wrote outputs/phase7-simulation.json");
