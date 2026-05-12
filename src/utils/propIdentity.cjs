function normName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function canonicalMarket(row) {
  const raw = String(row.market || row.stat || row.statType || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (raw === "pitching outs" || raw === "pitcher outs" || raw === "outs recorded") return "pitching_outs";
  if (raw === "walks allowed" || raw === "pitcher walks" || raw === "pitcher walks allowed") return "walks_allowed";
  if (raw.includes("pitcher strikeout") || raw === "strikeouts") return "strikeouts";
  if (raw.includes("hits allowed")) return "hits_allowed";
  if (raw.includes("earned runs")) return "earned_runs_allowed";
  if (raw.includes("total bases") || raw === "bases") return "bases";
  if (raw.includes("hits runs rbis") || raw.includes("hits + runs + rbis") || raw === "hrr") return "hrr";
  if (raw.includes("home runs") || raw === "hr") return "hr";
  if (raw.includes("rbi")) return "rbis";
  if (raw.includes("runs scored") || raw === "runs") return "runs";
  if (raw === "hits" || raw.includes("batter hits")) return "hits";
  if (raw.includes("walks")) return "walks";
  if (raw.includes("singles")) return "singles";
  if (raw.includes("doubles")) return "doubles";
  if (raw.includes("triples")) return "triples";
  if (raw.includes("stolen bases")) return "stolen_bases";
  if (raw.includes("fantasy") && raw.includes("pitcher")) return "pitcher_fantasy_score";
  if (raw.includes("fantasy") && raw.includes("hitter")) return "hitter_fantasy_score";

  return raw.replace(/\s+/g, "_");
}

function inferSourceType(row) {
  const market = canonicalMarket(row);
  const pitcherMarkets = new Set([
    "pitching_outs",
    "strikeouts",
    "walks_allowed",
    "hits_allowed",
    "earned_runs_allowed",
    "pitcher_fantasy_score"
  ]);

  if (pitcherMarkets.has(market)) return "pitcher";
  return "hitter";
}

module.exports = {
  normName,
  canonicalMarket,
  inferSourceType
};
