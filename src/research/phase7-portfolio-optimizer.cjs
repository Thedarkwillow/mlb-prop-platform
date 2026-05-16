const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const MAX_SLIPS = Number(process.env.PORTFOLIO_MAX_SLIPS || 3);
const MAX_PLAYER_OVERLAP = Number(process.env.PORTFOLIO_MAX_PLAYER_OVERLAP || 1);

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

function playerKey(leg) {
  return String(leg.player || "").toLowerCase().trim();
}

function slipScore(slip) {
  const powerRoi = Number(slip.power?.roi ?? -999);
  const flexRoi = Number(slip.flex?.roi ?? -999);
  const bestRoi = Math.max(powerRoi, flexRoi);

  const powerHitRate = Number(slip.power?.hitRate ?? 0);
  const flexProfitRate = Number(slip.flex?.profitRate ?? 0);
  const bestHitRate = slip.recommendation === "POWER" ? powerHitRate : flexProfitRate;

  const median =
    slip.recommendation === "POWER"
      ? Number(slip.power?.distribution?.median ?? -1)
      : Number(slip.flex?.distribution?.median ?? -1);

  const p05 =
    slip.recommendation === "POWER"
      ? Number(slip.power?.distribution?.p05 ?? -1)
      : Number(slip.flex?.distribution?.p05 ?? -1);

  return Number((bestRoi * 0.7 + bestHitRate * 0.2 + median * 0.07 + p05 * 0.03).toFixed(4));
}

function bestMode(slip) {
  const powerRoi = Number(slip.power?.roi ?? -999);
  const flexRoi = Number(slip.flex?.roi ?? -999);
  return powerRoi >= flexRoi ? "POWER" : "FLEX";
}

function bestRoi(slip) {
  const mode = bestMode(slip);
  return Number((mode === "POWER" ? slip.power?.roi : slip.flex?.roi) ?? 0);
}

function overlapCount(candidate, selected) {
  const players = new Set((candidate.legs || []).map(playerKey));
  let overlap = 0;

  for (const s of selected) {
    for (const leg of s.legs || []) {
      if (players.has(playerKey(leg))) overlap++;
    }
  }

  return overlap;
}

function playerExposure(selected) {
  const counts = {};
  for (const s of selected) {
    for (const leg of s.legs || []) {
      const k = playerKey(leg);
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return counts;
}

function violatesExposure(candidate, selected) {
  const exposure = playerExposure(selected);
  for (const leg of candidate.legs || []) {
    const k = playerKey(leg);
    if ((exposure[k] || 0) >= MAX_PLAYER_OVERLAP) return true;
  }
  return false;
}

function optimize(simulations) {
  const ranked = [...simulations]
    .map(s => ({
      ...s,
      portfolioScore: slipScore(s),
      bestMode: bestMode(s),
      bestRoi: bestRoi(s)
    }))
    .filter(s => Number.isFinite(s.bestRoi))
    .filter(s => s.bestRoi > 0)
    .sort((a, b) => b.portfolioScore - a.portfolioScore);

  const selected = [];
  const rejected = [];

  for (const slip of ranked) {
    if (selected.length >= MAX_SLIPS) break;

    const overlap = overlapCount(slip, selected);
    const exposureViolation = violatesExposure(slip, selected);

    if (exposureViolation) {
      rejected.push({
        name: slip.name,
        reason: "player_exposure_violation",
        overlap,
        portfolioScore: slip.portfolioScore,
        bestMode: slip.bestMode,
        bestRoi: slip.bestRoi
      });
      continue;
    }

    selected.push(slip);
  }

  return { ranked, selected, rejected };
}

const sim = read(`outputs/phase7-simulation-${DATE}.json`, read("outputs/phase7-simulation.json", null));

if (!sim || !Array.isArray(sim.simulations)) {
  console.error("Missing Phase 7 simulation. Run:");
  console.error(`node src/research/phase7-simulation.cjs ${DATE}`);
  process.exit(1);
}

const { ranked, selected, rejected } = optimize(sim.simulations);

const portfolio = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  source: `outputs/phase7-simulation-${DATE}.json`,
  note: "Phase 7 portfolio optimizer skeleton. Shadow-only; does not change official slips.",
  settings: {
    maxSlips: MAX_SLIPS,
    maxPlayerOverlap: MAX_PLAYER_OVERLAP
  },
  summary: {
    candidateSlips: sim.simulations.length,
    rankedSlips: ranked.length,
    selectedSlips: selected.length,
    avgSelectedRoi: selected.length
      ? Number((selected.reduce((a, s) => a + s.bestRoi, 0) / selected.length).toFixed(4))
      : null,
    totalLegs: selected.reduce((a, s) => a + (s.legs || []).length, 0),
    uniquePlayers: new Set(selected.flatMap(s => (s.legs || []).map(playerKey))).size
  },
  selected: selected.map(s => ({
    name: s.name,
    size: s.size,
    recommendedMode: s.bestMode,
    bestRoi: s.bestRoi,
    portfolioScore: s.portfolioScore,
    power: s.power,
    flex: s.flex,
    legs: s.legs
  })),
  rejected,
  ranked: ranked.map(s => ({
    name: s.name,
    size: s.size,
    recommendedMode: s.bestMode,
    bestRoi: s.bestRoi,
    portfolioScore: s.portfolioScore,
    legs: s.legs
  }))
};

write(`outputs/phase7-portfolio-${DATE}.json`, portfolio);
write("outputs/phase7-portfolio.json", portfolio);

console.log("PHASE 7 PORTFOLIO OPTIMIZER");
console.log("===========================");
console.log("date:", DATE);
console.log("candidate slips:", sim.simulations.length);
console.log("selected slips:", selected.length);
console.table(
  selected.map(s => ({
    slip: s.name,
    size: s.size,
    mode: s.bestMode,
    roi: s.bestRoi,
    score: s.portfolioScore,
    legs: (s.legs || []).map(l => l.player).join(" | ")
  }))
);
console.log(`Wrote outputs/phase7-portfolio-${DATE}.json`);
console.log("Wrote outputs/phase7-portfolio.json");
