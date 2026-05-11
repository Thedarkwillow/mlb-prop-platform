const fs = require("fs");

const ROI = "data/learning/rolling-roi-validation.json";
const VOL = "data/learning/market-volatility.json";
const BOARD = "outputs/priced-board.json";
const OUT = "data/learning/weak-environment-downgrades.json";

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function marketKey(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function sideKey(v) {
  return String(v || "").toUpperCase().includes("LESS") ? "LESS" : "MORE";
}

function decideMarket(market, rec = {}, vol = {}) {
  const sample = Number(rec.sample || 0);
  const roi = Number(rec.roi || 0);
  const hitRate = Number(rec.hitRate || 0);
  const volatilityScore = Number(vol.volatilityScore || 0);
  const riskTier = vol.riskTier || "unknown";

  let action = "hold";
  let multiplier = 1;
  const reasons = [];

  if (sample < 25) {
    return {
      market,
      action: "sample_too_small",
      multiplier: 1,
      sample,
      roi,
      hitRate,
      volatilityScore,
      riskTier,
      reasons: ["sample too small"]
    };
  }

  if (roi <= -0.15 || hitRate <= 0.45) {
    action = "downgrade";
    multiplier = Math.min(multiplier, 0.94);
    reasons.push("negative ROI or low hit rate");
  }

  if (volatilityScore >= 0.55 || riskTier === "extreme") {
    action = "downgrade";
    multiplier = Math.min(multiplier, 0.95);
    reasons.push("high volatility");
  }

  if (market.includes("fantasy")) {
    action = "suppress";
    multiplier = 0.82;
    reasons.push("fantasy market historically weak");
  }

  if (market === "hrr_more") {
    action = "downgrade";
    multiplier = Math.min(multiplier, 0.90);
    reasons.push("HRR MORE unstable relative to HRR LESS");
  }

  return {
    market,
    action,
    multiplier,
    sample,
    roi,
    hitRate,
    volatilityScore,
    riskTier,
    reasons: reasons.length ? reasons : ["no weak-environment trigger"]
  };
}

const roi = read(ROI, {});
const vol = read(VOL, {});
const board = read(BOARD, []);

const allWindow = roi.windows?.all || {};
const last7Window = roi.windows?.last7 || {};

const byMarket = allWindow.byMarket || {};
const byMarketDirection = allWindow.byMarketDirection || {};
const last7ByMarket = last7Window.byMarket || {};
const last7ByMarketDirection = last7Window.byMarketDirection || {};

const volMarkets = vol.byMarket || {};
const volDirections = vol.byMarketDirection || {};

const marketRules = {};
const directionRules = {};

for (const [market, rec] of Object.entries(byMarket)) {
  marketRules[marketKey(market)] = decideMarket(marketKey(market), rec, volMarkets[market] || {});
}

for (const [key, rec] of Object.entries(byMarketDirection)) {
  directionRules[marketKey(key)] = decideMarket(marketKey(key), rec, volDirections[key] || {});
}

const props = Array.isArray(board) ? board.filter(r => r.recordType === "merged_prop") : [];
const boardPreview = [];

for (const r of props) {
  const m = marketKey(r.market || r.stat);
  const s = sideKey(r.recommendedSide || r.side);
  const direction = `${m}_${s}`;

  const rule = directionRules[direction] || marketRules[m] || null;
  if (!rule || rule.action === "hold" || rule.action === "sample_too_small") continue;

  boardPreview.push({
    player: r.player,
    team: r.team || r.resolvedTeam,
    market: m,
    side: s,
    recommendedProb: r.recommendedProb ?? null,
    action: rule.action,
    multiplier: rule.multiplier,
    reasons: rule.reasons
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: [ROI, VOL, BOARD].filter(fs.existsSync),
  note: "Weak-environment downgrade rules. Conservative multipliers. Not source of truth until probabilityEngine reads this file.",
  marketRules,
  directionRules,
  last7Snapshot: {
    byMarket: last7ByMarket,
    byMarketDirection: last7ByMarketDirection
  },
  boardPreviewCount: boardPreview.length,
  boardPreview: boardPreview.slice(0, 100)
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("WEAK ENVIRONMENT DOWNGRADES");
console.log("===========================");
console.log(`Wrote ${OUT}`);

console.log("\nMarket rules:");
console.table(Object.values(marketRules).map(r => ({
  market: r.market,
  action: r.action,
  multiplier: r.multiplier,
  sample: r.sample,
  roi: r.roi,
  hitRate: r.hitRate,
  volatility: r.volatilityScore,
  reasons: r.reasons.join("; ")
})));

console.log("\nDirection rules:");
console.table(Object.values(directionRules).map(r => ({
  market: r.market,
  action: r.action,
  multiplier: r.multiplier,
  sample: r.sample,
  roi: r.roi,
  hitRate: r.hitRate,
  volatility: r.volatilityScore,
  reasons: r.reasons.join("; ")
})).slice(0, 20));

console.log("\nBoard preview:");
console.table(boardPreview.slice(0, 20));
