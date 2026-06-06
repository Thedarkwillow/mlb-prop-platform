const fs = require("fs");

const FINAL = "outputs/final-slips.json";
const BLOCKED = "outputs/blocked-final-candidates.json";
const PF_SUPPORT = "outputs/pickfinder-support-enriched-candidates.json";
const OUT = "outputs/filter-loss-lean-audit.json";
const TXT = "outputs/filter-loss-lean-audit.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function flatten(v, out = [], seen = new Set()) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out, seen);
    return out;
  }
  if (typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);

  const looks =
    v.player || v.playerName || v.player_name || v.name ||
    v.market || v.stat || v.projectionType ||
    v.side || v.pick || v.selection ||
    v.line != null || v.ppLine != null || v.prizepicksLine != null;

  if (looks) out.push(v);

  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flatten(x, out, seen);
  }
  return out;
}

function normName(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function market(v) {
  const t = String(v || "").toLowerCase();
  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis")) return "hrr";
  if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
  if (t.includes("total bases") || t === "bases") return "bases";
  if (t.includes("hits allowed")) return "hits_allowed";
  if (t === "hits" || t.includes("hits")) return "hits";
  if (t.includes("earned") || t.includes("runs allowed") || t === "runs") return "earned_runs_allowed";
  if (t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walks")) return "walks";
  if (t.includes("strikeouts") || t.includes("strikeout")) return "strikeouts";
  if (t.includes("pitching outs") || t.includes("outs recorded") || t === "outs" || t.includes(" outs")) return "pitching_outs";
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function side(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "";
}

function lineNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function prob(c) {
  const vals = [
    c.probability,
    c.recommendedProb,
    c.calibratedDistributionProb,
    c.contextAdjustedDistributionProb,
    c.preContextCalibratedDistributionProb,
    c.distributionProb,
    c.twoSidedPricing?.selectedProb, c.prob, c.finalProbability, c.calibratedProbability,
    c.modelProbability, c.trueProbability, c.finalProb, c.calibratedProb,
    c.modelProb, c.rawProbability,
    c.leg?.probability,
    c.leg?.recommendedProb,
    c.leg?.calibratedDistributionProb,
    c.leg?.contextAdjustedDistributionProb,
    c.leg?.preContextCalibratedDistributionProb,
    c.leg?.distributionProb,
    c.leg?.twoSidedPricing?.selectedProb, c.leg?.prob, c.legs?.[0]?.probability,
    c.legs?.[0]?.recommendedProb,
    c.legs?.[0]?.calibratedDistributionProb,
    c.legs?.[0]?.contextAdjustedDistributionProb,
    c.legs?.[0]?.preContextCalibratedDistributionProb,
    c.legs?.[0]?.distributionProb,
    c.legs?.[0]?.twoSidedPricing?.selectedProb, c.legs?.[0]?.prob
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function books(c) {
  const vals = [
    c.books, c.bookCount, c.supportBooks, c.directBookCount,
    c.raw?.books, c.raw?.bookCount, c.leg?.books, c.legs?.[0]?.books
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function tier(c) {
  return String(c.tier || c.specialTier || c.pickType || c.raw?.tier || "").toLowerCase();
}

function reasons(c) {
  const out = [];
  for (const k of ["disabledReason", "reason", "blockReason", "reasons", "failReasons", "warnings"]) {
    const v = c[k];
    if (Array.isArray(v)) out.push(...v.map(String));
    else if (v) out.push(String(v));
  }
  return [...new Set(out.flatMap(x => x.split(/[;,]/).map(y => y.trim()).filter(Boolean)))];
}

function keyOf(x) {
  return `${normName(x.player)}|${market(x.market)}|${side(x.side)}|${lineNum(x.line)}`;
}

function classify(row) {
  const p = row.probability ?? 0;
  const b = row.books ?? 0;
  const m = row.market;
  const s = row.side;
  const t = row.tier;
  const reasonText = row.reasons.join(" ").toLowerCase();
  const pf = row.pickfinderSupportClass || "PF_NO_MATCH";
  const pfApps = row.pickfinderAppsCount || 0;

  const fatal = [];
  const soft = [];

  if (/fantasy/.test(m)) fatal.push("fantasy_research_only");
  if (m === "hrr" && s === "MORE") fatal.push("hrr_more_research_only");
  if (reasonText.includes("negative_side_bias") && t === "goblin") fatal.push("goblin_negative_side_bias");
  if (reasonText.includes("high_probability_conflict")) fatal.push("high_probability_conflict");
  if (reasonText.includes("high_volatility")) soft.push("high_volatility");
  if (reasonText.includes("weak_confidence")) soft.push("weak_confidence");
  if (reasonText.includes("low_book") || reasonText.includes("support") || reasonText.includes("direct")) soft.push("support_weak");

  const supportGood =
    b >= 3 ||
    pf === "PF_SUPPORTED" ||
    pf === "PF_STRONG_SUPPORT" ||
    pfApps >= 10;

  const supportThin =
    b >= 2 ||
    pf === "PF_THIN_SUPPORT" ||
    pfApps >= 4;

  let lane = "KEEP_BLOCKED";

  if (fatal.length) {
    lane = "RESEARCH_ONLY";
  } else if (p >= 0.60 && supportGood && !soft.includes("high_volatility")) {
    lane = "LEAN_CANDIDATE";
  } else if (p >= 0.55 && supportThin && !soft.includes("high_volatility")) {
    lane = "WATCHLIST_CANDIDATE";
  } else if (p >= 0.60 && soft.includes("high_volatility")) {
    lane = "VOLATILITY_WATCH";
  } else if (p >= 0.50 && supportThin) {
    lane = "WATCHLIST_CANDIDATE";
  }

  return {lane, fatal, soft, supportGood, supportThin};
}

const pfData = readJson(PF_SUPPORT, {enriched: []});
const pfMap = new Map();
for (const x of pfData.enriched || []) {
  pfMap.set(keyOf(x), x);
}

const rows = [
  ...flatten(readJson(FINAL, [])).map(x => ({...x, source: "final"})),
  ...flatten(readJson(BLOCKED, [])).map(x => ({...x, source: "blocked"}))
];

const seen = new Set();
const normalized = [];
for (const r of rows) {
  const row = {
    source: r.source,
    player: r.player || r.playerName || r.player_name || r.name || "",
    team: r.team || r.rawTeam || r.playerTeam || "",
    market: market(r.market || r.stat || r.projectionType || r.type),
    side: side(r.side || r.pick || r.selection),
    line: lineNum(r.line ?? r.ppLine ?? r.prizepicksLine),
    probability: prob(r),
    books: books(r),
    tier: tier(r),
    current: r.supportClass || r.directSupportClass || r.bookSupportClass || r.disabledReason || r.reason || "",
    reasons: reasons(r),
    raw: r
  };

  if (!row.player || row.line == null || !row.market) continue;
  const k = keyOf(row);
  if (seen.has(k)) continue;
  seen.add(k);

  const pf = pfMap.get(k);
  if (pf) {
    row.pickfinderMatched = true;
    row.pickfinderSupportClass = pf.pickfinderSupportClass;
    row.pickfinderAppsCount = pf.pickfinderAppsCount;
    row.pickfinderStat = pf.pickfinderStat;
    row.pickfinderConsensusOverIp = pf.pickfinderConsensusOverIp;
    row.pickfinderConsensusUnderIp = pf.pickfinderConsensusUnderIp;
  } else {
    row.pickfinderMatched = false;
    row.pickfinderSupportClass = "PF_NO_MATCH";
    row.pickfinderAppsCount = 0;
  }

  Object.assign(row, classify(row));
  normalized.push(row);
}

normalized.sort((a,b) =>
  (b.probability || 0) - (a.probability || 0) ||
  (b.books || 0) - (a.books || 0) ||
  (b.pickfinderAppsCount || 0) - (a.pickfinderAppsCount || 0)
);

const byLane = {};
for (const r of normalized) byLane[r.lane] = (byLane[r.lane] || 0) + 1;

const summary = {
  generatedAt: new Date().toISOString(),
  rows: normalized.length,
  byLane,
  leanCandidates: normalized.filter(x => x.lane === "LEAN_CANDIDATE").length,
  watchlistCandidates: normalized.filter(x => x.lane === "WATCHLIST_CANDIDATE").length,
  researchOnly: normalized.filter(x => x.lane === "RESEARCH_ONLY").length,
  volatilityWatch: normalized.filter(x => x.lane === "VOLATILITY_WATCH").length,
  keepBlocked: normalized.filter(x => x.lane === "KEEP_BLOCKED").length,
  pfMatched: normalized.filter(x => x.pickfinderMatched).length
};

fs.writeFileSync(OUT, JSON.stringify({summary, rows: normalized}, null, 2) + "\n");

const lines = [];
lines.push("FILTER LOSS / LEAN LANE AUDIT");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");

for (const lane of ["LEAN_CANDIDATE", "WATCHLIST_CANDIDATE", "VOLATILITY_WATCH", "RESEARCH_ONLY", "KEEP_BLOCKED"]) {
  lines.push(lane);
  lines.push("-".repeat(lane.length));
  const laneRows = normalized.filter(x => x.lane === lane).slice(0, 40);
  if (!laneRows.length) lines.push("none");
  for (const x of laneRows) {
    lines.push(`${x.player} | ${x.team} | ${x.market} ${x.side} ${x.line} | prob=${x.probability} | books=${x.books ?? "?"} | pf=${x.pickfinderSupportClass} apps=${x.pickfinderAppsCount} | current=${x.current || "-"} | reasons=${x.reasons.join(",") || "-"}`);
  }
  lines.push("");
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
