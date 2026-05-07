const { MARKETS } = require("./market-registry.cjs");

console.log("\nMARKET MODEL ROADMAP\n");

console.table(
  Object.entries(MARKETS).map(([market, cfg]) => ({
    market,
    group: cfg.group,
    enabled: cfg.enabled,
    priority: cfg.priority,
    modelType: cfg.modelType,
    context: cfg.eliteContext.join(", ")
  }))
);
