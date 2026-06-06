function teamOf(leg) {
  return String(
    leg?.resolvedTeam ||
    leg?.team ||
    leg?.rawTeam ||
    leg?.playerTeam ||
    ""
  ).trim();
}

function playerOf(leg) {
  return String(leg?.player || leg?.playerName || leg?.name || "").trim();
}

function projectionKey(leg) {
  const player = playerOf(leg).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const market = String(leg?.market || leg?.stat || leg?.projectionType || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const side = String(leg?.side || leg?.recommendedSide || "").toUpperCase();
  const line = String(leg?.line ?? leg?.ppLine ?? leg?.prizepicksLine ?? "");
  return [player, market, side, line].join("|");
}

function prizePicksSlipValidation(legs) {
  const list = Array.isArray(legs) ? legs : [];
  const teams = new Set(list.map(teamOf).filter(Boolean));
  const playerCounts = new Map();
  const projectionCounts = new Map();

  for (const leg of list) {
    const p = playerOf(leg).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (p) playerCounts.set(p, (playerCounts.get(p) || 0) + 1);

    const k = projectionKey(leg);
    projectionCounts.set(k, (projectionCounts.get(k) || 0) + 1);
  }

  const duplicateProjection = [...projectionCounts.values()].some(n => n > 1);
  const overThreeSamePlayer = [...playerCounts.values()].some(n => n > 3);

  const errors = [];
  if (list.length < 2) errors.push("needs_at_least_2_projections");
  if (list.length > 6) errors.push("max_6_projections");
  if (teams.size < 2) errors.push("needs_at_least_2_teams");
  if (overThreeSamePlayer) errors.push("max_3_projections_per_player");
  if (duplicateProjection) errors.push("duplicate_projection");

  return {
    valid: errors.length === 0,
    errors,
    projectionCount: list.length,
    teamCount: teams.size,
    teams: [...teams],
    maxSamePlayerCount: Math.max(0, ...playerCounts.values()),
    sameTeamStacksAllowed: true
  };
}

module.exports = {
  teamOf,
  playerOf,
  projectionKey,
  prizePicksSlipValidation
};
