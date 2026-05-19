const fs = require("fs");
const { priceSlip, getSlipConfigKey } = require("../pricing/prizepicks-payout-engine.cjs");

const INPUT = "outputs/slips-distribution-enriched.json";
const OUT = "outputs/mixed-slip-ev-optimizer.json";

const MAX_POOL = Number(process.env.MIXED_EV_MAX_POOL || 28);
const MAX_RESULTS_PER_SIZE = Number(process.env.MIXED_EV_RESULTS || 10);
const MIN_LEG_PROB = Number(process.env.MIXED_EV_MIN_LEG_PROB || 0.58);
const MIN_TRUE_EV = Number(process.env.MIXED_EV_MIN_TRUE_EV || 0.0);

const MAX_GOBLINS_PER_SLIP = Number(process.env.MIXED_EV_MAX_GOBLINS || 2);
const MAX_DEMONS_PER_SLIP = Number(process.env.MIXED_EV_MAX_DEMONS || 2);
const MAX_SAME_GAME = Number(process.env.MIXED_EV_MAX_SAME_GAME || 1);
const MAX_SAME_TEAM = Number(process.env.MIXED_EV_MAX_SAME_TEAM || 2);
const MAX_SAME_MARKET = Number(process.env.MIXED_EV_MAX_SAME_MARKET || 3);

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function legProb(x) {
  const vals = [
    x.calibratedDistributionProb,
    x.phase55Prob,
    x.adjustedProb,
    x.finalProb,
    x.probability,
    x.prob
  ];

  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n < 1) return n;
  }

  return null;
}

function tier(x) {
  return String(x.oddsTier || x.specialTier || x.tier || "standard").toLowerCase();
}

function side(x) {
  return String(x.side || x.recommendedSide || "").toUpperCase();
}

function playerKey(x) {
  return String(x.player || "").trim().toLowerCase();
}

function gameKey(x) {
  return String(x.game || x.sportsbookGame || x.resolvedGame || "").trim().toLowerCase();
}

function teamKey(x) {
  return String(x.team || x.resolvedTeam || "").trim().toLowerCase();
}

function marketKey(x) {
  return String(x.market || x.stat || "").trim().toLowerCase();
}

function edge(x) {
  return Number(x.sportsbookAdjustedEdge ?? x.adjustedEdge ?? x.sportsbookEdge ?? x.edge ?? 0);
}

function scoreLeg(x) {
  const p = legProb(x) || 0;
  const e = edge(x);
  const books = Number(x.sportsbookBookCount ?? x.books ?? 0);
  const t = tier(x);

  let tierPenalty = 0;
  if (t === "goblin") tierPenalty = -0.03;
  if (t === "demon") tierPenalty = -0.06;

  return p * 0.65 + e * 0.25 + Math.min(books, 5) * 0.01 + tierPenalty;
}

function cleanLeg(x) {
  return {
    player: x.player,
    team: x.team,
    game: x.game || x.sportsbookGame || x.resolvedGame || null,
    gamePk: x.gamePk || x.resolvedGamePk || null,
    market: x.market,
    side: side(x),
    line: x.line,
    oddsTier: tier(x),
    prob: legProb(x),
    edge: edge(x),
    books: Number(x.sportsbookBookCount ?? x.books ?? 0),
    grade: x.grade || x.displayGrade || null,
    executionSafe: executionGatePassed(x),
    executionReasons: executionFailureReasons(x)
  };
}

function hasExactPayout(table, legs, mode) {
  const size = String(legs.length);
  const key = getSlipConfigKey(legs);

  if (mode === "power") {
    return table.power?.[size]?.[key] != null;
  }

  if (mode === "flex") {
    return table.flex?.[size]?.[key] != null;
  }

  return false;
}


function executionGatePassed(x) {
  if (x.finalExecutionGate && typeof x.finalExecutionGate.passed === "boolean") {
    return x.finalExecutionGate.passed === true;
  }

  // If the enriched row does not carry finalExecutionGate, use conservative proxy.
  const p = legProb(x);
  const e = edge(x);
  const t = tier(x);

  if (t === "goblin") return p != null && p >= 0.68 && e >= 0.30;
  if (t === "demon") return e >= 0.06 && p != null && p >= 0.50;

  return p != null && p >= 0.60 && e > 0;
}

function executionFailureReasons(x) {
  if (x.finalExecutionGate?.reasons?.length) {
    return x.finalExecutionGate.reasons;
  }

  const reasons = [];
  const p = legProb(x);
  const e = edge(x);
  const t = tier(x);

  if (p == null) reasons.push("missing_probability");
  if (p != null && p < 0.60) reasons.push("low_probability");
  if (e <= 0) reasons.push("non_positive_edge");
  if (t === "goblin" && (p == null || p < 0.68)) reasons.push("goblin_prob_below_68");
  if (t === "goblin" && e < 0.30) reasons.push("goblin_edge_below_30pct");
  if (t === "demon" && e < 0.06) reasons.push("demon_edge_below_6pct");

  return reasons;
}

function slipExecutionSafe(legs) {
  return legs.every(executionGatePassed);
}

function slipExecutionReasons(legs) {
  const out = [];

  for (const leg of legs) {
    const reasons = executionFailureReasons(leg);
    if (!executionGatePassed(leg)) {
      out.push({
        player: leg.player,
        market: leg.market,
        side: side(leg),
        line: leg.line,
        oddsTier: tier(leg),
        reasons
      });
    }
  }

  return out;
}

function validCombo(legs) {
  const players = new Set();
  const games = {};
  const teams = {};
  const markets = {};
  let goblins = 0;
  let demons = 0;

  for (const l of legs) {
    const pk = playerKey(l);
    if (!pk) return false;
    if (players.has(pk)) return false;
    players.add(pk);

    const t = tier(l);
    if (t === "goblin") goblins++;
    if (t === "demon") demons++;

    if ((t === "goblin" || t === "demon") && side(l) !== "MORE") {
      return false;
    }

    const p = legProb(l);
    if (p == null || p < MIN_LEG_PROB) return false;

    const g = gameKey(l);
    const tm = teamKey(l);
    const m = marketKey(l);

    if (g) games[g] = (games[g] || 0) + 1;
    if (tm) teams[tm] = (teams[tm] || 0) + 1;
    if (m) markets[m] = (markets[m] || 0) + 1;
  }

  if (goblins > MAX_GOBLINS_PER_SLIP) return false;
  if (demons > MAX_DEMONS_PER_SLIP) return false;

  if (Object.values(games).some(v => v > MAX_SAME_GAME)) return false;
  if (Object.values(teams).some(v => v > MAX_SAME_TEAM)) return false;
  if (Object.values(markets).some(v => v > MAX_SAME_MARKET)) return false;

  return true;
}

function* comboGenerator(arr, k) {
  const combo = [];

  function* rec(start) {
    if (combo.length === k) {
      yield combo.slice();
      return;
    }

    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      yield* rec(i + 1);
      combo.pop();
    }
  }

  yield* rec(0);
}

function summarizeSlip(legs, pricing, mode) {
  const probs = legs.map(legProb).filter(Number.isFinite);
  const tiers = legs.reduce((acc, l) => {
    const t = tier(l);
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  return {
    name: `${legs.length}-MAN ${mode.toUpperCase()} MIXED EV`,
    size: legs.length,
    mode,
    complete: true,
    trueEV: pricing.ev,
    trueEVPct: pricing.evPct,
    payoutConfigKey: pricing.configKey,
    payout: pricing.payout ?? null,
    payoutMap: pricing.payoutMap ?? null,
    avgProb: probs.reduce((a, b) => a + b, 0) / probs.length,
    minProb: Math.min(...probs),
    tiers,
    executionSafe: slipExecutionSafe(legs),
    executionIssues: slipExecutionReasons(legs),
    legs: legs.map(cleanLeg)
  };
}

function main() {
  const rows = readJson(INPUT, []);
  const table = readJson("data/payouts/prizepicks-payout-table.json", {});

  const pool = rows
    .filter(x => {
      const p = legProb(x);
      if (p == null || p < MIN_LEG_PROB) return false;
      if (!x.player || !x.market || !x.side) return false;
      if (edge(x) <= 0) return false;
      return true;
    })
    .sort((a, b) => scoreLeg(b) - scoreLeg(a))
    .slice(0, MAX_POOL);

  const safeResults = [];
  const aggressiveResults = [];

  for (const size of [2, 3, 4, 5, 6]) {
    const sizeResults = [];

    for (const legs of comboGenerator(pool, size)) {
      if (!validCombo(legs)) continue;

      for (const mode of size === 2 ? ["power"] : ["power", "flex"]) {
        if (!hasExactPayout(table, legs, mode)) continue;

        const pricing = priceSlip({ legs, mode, table });
        if (!pricing || !Number.isFinite(Number(pricing.ev))) continue;
        if (Number(pricing.ev) <= MIN_TRUE_EV) continue;

        const slip = summarizeSlip(legs, pricing, mode);
        sizeResults.push(slip);
      }
    }

    sizeResults.sort((a, b) => Number(b.trueEV) - Number(a.trueEV));

    for (const slip of sizeResults) {
      if (slip.executionSafe) safeResults.push(slip);
      else aggressiveResults.push(slip);
    }
  }

  safeResults.sort((a, b) => Number(b.trueEV) - Number(a.trueEV));
  aggressiveResults.sort((a, b) => Number(b.trueEV) - Number(a.trueEV));

  const output = {
    generatedAt: new Date().toISOString(),
    input: INPUT,
    poolSize: pool.length,
    maxPool: MAX_POOL,
    minLegProb: MIN_LEG_PROB,
    minTrueEV: MIN_TRUE_EV,
    note: "Aligned mode: SAFE slips pass execution checks; AGGRESSIVE slips are positive theoretical EV but failed execution checks.",
    safeSlips: safeResults.slice(0, MAX_RESULTS_PER_SIZE * 5),
    aggressiveWatchlist: aggressiveResults.slice(0, MAX_RESULTS_PER_SIZE * 5),
    slips: safeResults.slice(0, MAX_RESULTS_PER_SIZE * 5)
  };

  fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");

  console.log("MIXED SLIP EV OPTIMIZER");
  console.log("=======================");
  console.log(`Pool size: ${pool.length}`);
  console.log(`Wrote ${OUT}`);

  console.log(`Safe slips: ${output.safeSlips.length}`);
  console.log(`Aggressive watchlist: ${output.aggressiveWatchlist.length}`);

  if (!output.safeSlips.length && !output.aggressiveWatchlist.length) {
    console.log("No positive trueEV mixed slips found.");
    return;
  }

  console.log("\nSAFE EV SLIPS");
  console.log("-------------");
  if (!output.safeSlips.length) {
    console.log("None.");
  } else {
    console.table(output.safeSlips.slice(0, 20).map(s => ({
    slip: s.name,
    mode: s.mode,
    size: s.size,
    trueEVPct: Number(s.trueEVPct.toFixed(2)),
    payoutKey: s.payoutConfigKey,
    payout: s.payout || JSON.stringify(s.payoutMap),
    avgProb: Number(s.avgProb.toFixed(3)),
    minProb: Number(s.minProb.toFixed(3)),
    tiers: JSON.stringify(s.tiers)
  })));
  }

  console.log("\nAGGRESSIVE WATCHLIST");
  console.log("--------------------");
  if (!output.aggressiveWatchlist.length) {
    console.log("None.");
  } else {
    console.table(output.aggressiveWatchlist.slice(0, 20).map(s => ({
      slip: s.name,
      mode: s.mode,
      size: s.size,
      trueEVPct: Number(s.trueEVPct.toFixed(2)),
      payoutKey: s.payoutConfigKey,
      payout: s.payout || JSON.stringify(s.payoutMap),
      avgProb: Number(s.avgProb.toFixed(3)),
      minProb: Number(s.minProb.toFixed(3)),
      tiers: JSON.stringify(s.tiers),
      issues: s.executionIssues.length
    })));
  }
}

main();
