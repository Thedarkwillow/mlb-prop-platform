function applyPreDistributionContext(leg) {
  const baseProjection = Number(
    leg.projection ??
    leg.mean ??
    leg.hrrMean ??
    leg.hrrProjection ??
    leg.hitsMean ??
    leg.basesMean ??
    leg.kMean ??
    leg.strikeoutMean ??
    0
  );

  if (!Number.isFinite(baseProjection) || baseProjection <= 0) return {};

  const market = String(leg.market || "").toLowerCase();
  let multiplier = 1;
  const notes = [];

  if (Number(leg.teamTotal) >= 5) {
    multiplier += 0.05;
    notes.push("team_total_boost");
  }

  if (Number(leg.teamTotal) > 0 && Number(leg.teamTotal) <= 3.5) {
    multiplier -= 0.05;
    notes.push("team_total_penalty");
  }

  if (["hits", "bases", "hrr", "runs", "rbis", "rbi"].includes(market)) {
    if (leg.opponentBullpenWeak) {
      multiplier += 0.04;
      notes.push("weak_opponent_bullpen_boost");
    }

    if (leg.opponentBullpenElite) {
      multiplier -= 0.04;
      notes.push("elite_opponent_bullpen_penalty");
    }
  }

  if (leg.handednessAdvantage === "strong") {
    multiplier += 0.06;
    notes.push("handedness_boost");
  }

  if (leg.handednessAdvantage === "weak") {
    multiplier -= 0.06;
    notes.push("handedness_penalty");
  }

  if (Number(leg.recentForm) >= 1.2) {
    multiplier += 0.05;
    notes.push("recent_form_boost");
  }

  if (Number(leg.recentForm) > 0 && Number(leg.recentForm) <= 0.8) {
    multiplier -= 0.05;
    notes.push("recent_form_penalty");
  }

  if (market === "strikeouts") {
    if (leg.velocityTrend === "up") {
      multiplier += 0.05;
      notes.push("velocity_trend_boost");
    }

    if (leg.velocityTrend === "down") {
      multiplier -= 0.05;
      notes.push("velocity_trend_penalty");
    }
  }

  if (["hits", "bases", "hrr"].includes(market)) {
    if (Number(leg.hardHitRate) >= 45) {
      multiplier += 0.05;
      notes.push("hard_hit_boost");
    }

    if (Number(leg.hardHitRate) > 0 && Number(leg.hardHitRate) <= 30) {
      multiplier -= 0.05;
      notes.push("hard_hit_penalty");
    }
  }

  multiplier = Math.max(0.82, Math.min(1.18, multiplier));

  return {
    contextBaseProjection: Number(baseProjection.toFixed(4)),
    contextAdjustedProjection: Number((baseProjection * multiplier).toFixed(4)),
    contextMultiplier: Number(multiplier.toFixed(4)),
    contextProjectionNotes: notes
  };
}

module.exports = { applyPreDistributionContext };
