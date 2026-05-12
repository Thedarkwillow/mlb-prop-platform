function marketOf(row) {
  return String(row.market || row.stat || row.rawStat || "").toLowerCase();
}

function sideOf(row) {
  const raw = String(row.side || row.recommendedSide || row.pick || row.direction || "").toUpperCase();

  if (raw.includes("LESS") || raw.includes("UNDER")) return "LESS";
  if (raw.includes("MORE") || raw.includes("OVER")) return "MORE";

  const projection = Number(row.projection);
  const line = Number(row.line);

  if (Number.isFinite(projection) && Number.isFinite(line)) {
    if (projection > line) return "MORE";
    if (projection < line) return "LESS";
  }

  return raw;
}

function tierOf(row) {
  return String(row.oddsTier || row.tier || row.payoutTier || "standard").toLowerCase();
}

function isFantasy(row) {
  return marketOf(row).includes("fantasy");
}

function isHitterFantasy(row) {
  return marketOf(row).includes("hitter") && isFantasy(row);
}

function isPitcherFantasy(row) {
  return marketOf(row).includes("pitcher") && isFantasy(row);
}

function fantasyPolicy(row) {
  if (!isFantasy(row)) {
    return {
      isFantasy: false,
      fantasyEligible: true,
      fantasyWatchlist: false,
      fantasyPolicy: "non_fantasy"
    };
  }

  const side = sideOf(row);
  const tier = tierOf(row);
  const line = Number(row.line);

  const base = {
    isFantasy: true,
    fantasyEligible: false,
    fantasyWatchlist: true,
    fantasyPolicy: "blocked",
    fantasyReason: "fantasy_default_tracking_only"
  };

  if (!side) {
    return {
      ...base,
      fantasyPolicy: "blocked",
      fantasyReason: "fantasy_missing_side"
    };
  }

  if (!Number.isFinite(line)) {
    return {
      ...base,
      fantasyPolicy: "blocked",
      fantasyReason: "fantasy_missing_line"
    };
  }

  if (side === "MORE") {
    return {
      ...base,
      fantasyPolicy: "banned",
      fantasyReason: isPitcherFantasy(row)
        ? "pitcher_fantasy_more_hard_ban"
        : "fantasy_more_banned"
    };
  }

  if (tier === "goblin") {
    return {
      ...base,
      fantasyPolicy: "banned",
      fantasyReason: "fantasy_goblin_banned"
    };
  }

  if (side === "LESS" && isPitcherFantasy(row)) {
    return {
      ...base,
      fantasyPolicy: "watchlist",
      fantasyReason: "pitcher_fantasy_less_watchlist_sample_not_ready"
    };
  }

  if (side === "LESS" && isHitterFantasy(row)) {
    if (Number.isFinite(line) && line <= 2.5) {
      return {
        ...base,
        fantasyPolicy: "banned",
        fantasyReason: "low_line_fantasy_less_banned"
      };
    }

    if (Number.isFinite(line) && line >= 6) {
      return {
        ...base,
        fantasyEligible: true,
        fantasyPolicy: "strong_watchlist",
        fantasyReason: "hitter_fantasy_less_high_line_strong_watchlist"
      };
    }

    if (Number.isFinite(line) && line >= 3) {
      return {
        ...base,
        fantasyEligible: true,
        fantasyPolicy: "watchlist",
        fantasyReason: "hitter_fantasy_less_mid_line_watchlist"
      };
    }
  }

  return {
    ...base,
    fantasyPolicy: "blocked",
    fantasyReason: [
      isHitterFantasy(row) ? "hitter" : isPitcherFantasy(row) ? "pitcher" : "unknown",
      "fantasy",
      side ? side.toLowerCase() : "missing_side",
      Number.isFinite(line) ? `line_${line}` : "missing_line",
      "no_matching_policy"
    ].join("_")
  };
}

module.exports = {
  fantasyPolicy,
  isFantasy,
  isHitterFantasy,
  isPitcherFantasy
};
