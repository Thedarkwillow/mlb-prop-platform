const fs = require("fs");

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function legProb(leg) {
  const p = Number(
    leg.calibratedDistributionProb ??
    leg.distributionProb ??
    leg.prob ??
    leg.probability
  );
  if (!Number.isFinite(p)) return 0.5;
  return Math.max(0.01, Math.min(0.99, p));
}

function hitDistribution(probs) {
  let dist = [1];
  for (const p of probs) {
    const next = Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

function powerEv(probs, payout) {
  if (!Number.isFinite(Number(payout))) return null;
  const allHit = probs.reduce((a, p) => a * p, 1);
  return Number((allHit * Number(payout) - 1).toFixed(6));
}

function flexEv(probs, flexTable) {
  if (!flexTable) return null;
  const dist = hitDistribution(probs);
  let expectedReturn = 0;
  for (const [hits, payout] of Object.entries(flexTable)) {
    expectedReturn += (dist[Number(hits)] || 0) * Number(payout);
  }
  return Number((expectedReturn - 1).toFixed(6));
}

function optimizeSlipType(slip, payouts) {
  const legs = slip.legs || [];
  const size = legs.length || Number(slip.size || 0);
  const probs = legs.map(legProb);

  const pEv = powerEv(probs, payouts.power?.[String(size)]);
  const fEv = size >= 3 ? flexEv(probs, payouts.flex?.[String(size)]) : null;

  const qualityTier = slip.quality?.tier || null;
  const qualityRejected = slip.quality?.isRejected === true || slip.rejected === true;

  let bestType = "POWER";
  let bestEv = pEv;
  let selectionReason = "power_ev_best";

  if (qualityRejected || qualityTier === "C") {
    bestType = null;
    bestEv = null;
    selectionReason = "quality_rejected";
  } else if (qualityTier === "A") {
    bestType = "POWER";
    bestEv = pEv;
    selectionReason = "tier_a_power_priority";
  } else if (qualityTier === "B" && fEv !== null) {
    bestType = fEv >= (pEv ?? -999) ? "FLEX" : "POWER";
    bestEv = bestType === "FLEX" ? fEv : pEv;
    selectionReason = bestType === "FLEX" ? "tier_b_flex_ev_best" : "tier_b_power_ev_best";
  } else if (fEv !== null && (pEv === null || fEv > pEv)) {
    bestType = "FLEX";
    bestEv = fEv;
    selectionReason = "flex_ev_best";
  }

  const originalName = slip.name || `${size}-MAN`;
  const cleanName = originalName.replace(/\s+(POWER|FLEX)$/i, "");
  const finalName = bestType ? `${cleanName} ${bestType}` : `${cleanName} REJECTED`;

  return {
    ...slip,
    name: finalName,
    entryType: bestType,
    size,
    complete: bestType ? slip.complete : false,
    rejected: qualityRejected || qualityTier === "C" || slip.rejected === true,
    slipTypeOptimization: {
      originalName,
      selectedType: bestType,
      selectionReason,
      qualityTier,
      powerEv: pEv,
      flexEv: fEv,
      bestEv,
      avgLegProb: probs.length ? Number((probs.reduce((a, p) => a + p, 0) / probs.length).toFixed(4)) : null,
      minLegProb: probs.length ? Number(Math.min(...probs).toFixed(4)) : null,
      maxLegProb: probs.length ? Number(Math.max(...probs).toFixed(4)) : null,
      legProbs: probs.map(p => Number(p.toFixed(4))),
      note: "Uses configured PrizePicks payout multipliers plus slip quality tier. Update data/config/prizepicks-slip-payouts.json if payout table changes."
    }
  };
}

module.exports = {
  optimizeSlipType,
  powerEv,
  flexEv,
  hitDistribution
};
