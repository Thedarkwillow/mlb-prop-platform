const MARKETS = {
  hrr: {
    group: "hitter",
    enabled: true,
    priority: 1,
    modelType: "hitter_counting",
    supportedSides: ["MORE", "LESS"],
    eliteContext: ["lineup", "weather", "pitcher_hand", "bullpen", "park", "savant"]
  },
  bases: {
    group: "hitter",
    enabled: true,
    priority: 2,
    modelType: "hitter_total_bases",
    supportedSides: ["MORE", "LESS"],
    eliteContext: ["lineup", "weather", "pitcher_hand", "park", "savant"]
  },
  hits: {
    group: "hitter",
    enabled: true,
    priority: 3,
    modelType: "hitter_hits",
    supportedSides: ["MORE", "LESS"],
    eliteContext: ["lineup", "pitcher_hand", "park", "savant"]
  },
  strikeouts: {
    group: "pitcher",
    enabled: true,
    priority: 1,
    modelType: "pitcher_ks",
    supportedSides: ["MORE", "LESS"],
    eliteContext: ["umpire", "opponent_k_rate", "pitch_count", "weather", "savant"]
  },
  pitching_outs: {
    group: "pitcher",
    enabled: true,
    priority: 2,
    modelType: "pitcher_outs",
    supportedSides: ["MORE", "LESS"],
    eliteContext: ["bullpen", "pitch_count", "team_total", "weather", "savant"]
  },
  hits_allowed: {
    group: "pitcher",
    enabled: true,
    priority: 3,
    modelType: "pitcher_hits_allowed",
    supportedSides: ["MORE", "LESS"],
    eliteContext: ["opponent_contact", "defense", "park", "weather", "savant"]
  },
  earned_runs_allowed: {
    group: "pitcher",
    enabled: true,
    priority: 4,
    modelType: "pitcher_runs_allowed",
    supportedSides: ["MORE", "LESS"],
    eliteContext: ["opponent_power", "bullpen", "park", "weather", "savant"]
  }
};

function getMarketConfig(market) {
  return MARKETS[String(market || "").toLowerCase()] || null;
}

function isSupportedMarket(market) {
  const cfg = getMarketConfig(market);
  return Boolean(cfg && cfg.enabled);
}

module.exports = {
  MARKETS,
  getMarketConfig,
  isSupportedMarket
};
