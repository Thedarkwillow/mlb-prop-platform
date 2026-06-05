const fs = require("fs");

const PF_PROPS = "outputs/pickfinder-mlb-props.json";
const PF_FULL = "outputs/pickfinder-mlb-full-capture.json";
const FINAL = "outputs/final-slips.json";
const BLOCKED = "outputs/blocked-final-candidates.json";
const OUT = "outputs/pickfinder-support-enriched-candidates.json";
const TXT = "outputs/pickfinder-support-enriched-candidates.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function normName(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function lineNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function side(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "";
}

function rawMarketText(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normMarket(v) {
  const t = rawMarketText(v);

  if (!t) return "";

  if (
    t.includes("hits runs rbis") ||
    t.includes("hit runs rbis") ||
    t.includes("hrr")
  ) return "hrr";

  if (t.includes("total bases") || t === "bases") return "bases";
  if (t.includes("singles")) return "singles";

  if (t.includes("hits allowed") || t.includes("pitcher hits")) return "hits_allowed";
  if (t === "hits" || t.includes("batter hits") || t.includes("player hits")) return "hits";

  if (
    t.includes("earned runs") ||
    t.includes("runs allowed") ||
    t.includes("pitcher runs")
  ) return "earned_runs_allowed";

  if (
    t.includes("walks allowed") ||
    t.includes("pitcher walks") ||
    t.includes("walks issued")
  ) return "walks_allowed";
  if (t === "walks" || t.includes("batter walks") || t.includes("player walks")) return "walks";

  if (t.includes("pitcher strikeouts") || t.includes("pitching strikeouts")) return "pitcher_strikeouts";
  if (t.includes("batter strikeouts") || t.includes("hitter strikeouts") || t.includes("batting strikeouts")) return "hitter_strikeouts";
  if (t.includes("strikeouts")) return "strikeouts";

  if (t.includes("pitching outs") || t.includes("outs recorded")) return "pitching_outs";

  if (t.includes("hitter fantasy")) return "hitter_fantasy_score";
  if (t.includes("pitcher fantasy")) return "pitcher_fantasy_score";
  if (t.includes("fantasy")) return "fantasy_score";

  return t.replace(/\s+/g, "_");
}

function marketAliases(market, rawObj = {}) {
  const base = normMarket(market);
  const raw = rawMarketText([
    market,
    rawObj.market,
    rawObj.stat,
    rawObj.projectionType,
    rawObj.type,
    rawObj.name
  ].filter(Boolean).join(" "));

  const set = new Set([base]);

  if (base === "hits") {
    set.add("hits_allowed"); // pitcher prop sometimes labeled just hits in our model
  }

  if (base === "hits_allowed") {
    set.add("hits");
  }

  if (base === "earned_runs_allowed") {
    set.add("runs");
    set.add("runs_allowed");
    set.add("earned_runs");
    set.add("pitcher_runs");
  }

  if (base === "runs") {
    set.add("earned_runs_allowed");
    set.add("runs_allowed");
    set.add("earned_runs");
    set.add("pitcher_runs");
  }

  if (base === "walks") {
    set.add("walks_allowed");
    set.add("pitcher_walks");
  }

  if (base === "walks_allowed") {
    set.add("walks");
    set.add("pitcher_walks");
  }

  if (base === "strikeouts") {
    set.add("pitcher_strikeouts");
    set.add("hitter_strikeouts");
  }

  if (base === "pitcher_strikeouts" || base === "hitter_strikeouts") {
    set.add("strikeouts");
  }

  if (base === "fantasy_score") {
    set.add("hitter_fantasy_score");
    set.add("pitcher_fantasy_score");
  }

  if (base === "hitter_fantasy_score" || base === "pitcher_fantasy_score") {
    set.add("fantasy_score");
  }

  if (raw.includes("hits") && raw.includes("allowed")) set.add("hits_allowed");
  if (raw.includes("earned") && raw.includes("runs")) set.add("earned_runs_allowed");
  if (raw.includes("walks") && raw.includes("allowed")) set.add("walks_allowed");

  return [...set].filter(Boolean);
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

  const looksLikeCandidate =
    v.player || v.playerName || v.player_name || v.name ||
    v.market || v.stat || v.projectionType ||
    v.side || v.pick || v.selection ||
    v.line != null || v.ppLine != null || v.prizepicksLine != null;

  if (looksLikeCandidate) out.push(v);

  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flatten(x, out, seen);
  }

  return out;
}

function appCount(apps) {
  if (Array.isArray(apps)) return apps.length;
  if (apps && typeof apps === "object") return Object.keys(apps).length;
  if (typeof apps === "string" && apps.trim()) return apps.split(",").filter(Boolean).length;
  return 0;
}

function pfPlayer(p) {
  return p.player_name || p.playerName || p.player || p.name || "";
}

function candPlayer(c) {
  return c.player || c.playerName || c.player_name || c.name || "";
}

function pfLine(p) {
  return lineNum(p.line);
}

function candLine(c) {
  return lineNum(c.line ?? c.ppLine ?? c.prizepicksLine);
}

function pfAliases(p) {
  return marketAliases(p.stat || p.market || p.projectionType || p.type, p);
}

function candAliases(c) {
  return marketAliases(c.market || c.stat || c.projectionType || c.type, c);
}

function makeKey(player, market, line) {
  return `${normName(player)}|${market}|${line}`;
}

function addIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function bestPfMatch(matches, candSide) {
  if (!matches || !matches.length) return null;
  return [...matches].sort((a, b) => {
    const score = p => {
      const apps = appCount(p.apps);
      const over = Number(p.consensus_over_ip || 0);
      const under = Number(p.consensus_under_ip || 0);
      const sideIp = candSide === "MORE" ? over : candSide === "LESS" ? under : Math.max(over, under);
      const bestOdds = candSide === "MORE" ? p.best_over_odds : candSide === "LESS" ? p.best_under_odds : null;
      return apps * 10 + sideIp * 100 + (bestOdds != null ? 5 : 0);
    };
    return score(b) - score(a);
  })[0];
}

function findPf(index, candidate) {
  const player = candPlayer(candidate);
  const line = candLine(candidate);
  if (!player || line == null) return null;

  const matches = [];
  for (const market of candAliases(candidate)) {
    const key = makeKey(player, market, line);
    const found = index.get(key);
    if (found) matches.push(...found);
  }

  return bestPfMatch(matches, side(candidate.side || candidate.pick || candidate.selection));
}

function supportClass(pf, candSide) {
  if (!pf) return "PF_NO_MATCH";

  const apps = appCount(pf.apps);
  const overOdds = pf.best_over_odds != null;
  const underOdds = pf.best_under_odds != null;
  const favOver = Number(pf.favorite_count_over || 0);
  const favUnder = Number(pf.favorite_count_under || 0);
  const consensusOver = Number(pf.consensus_over_ip || 0);
  const consensusUnder = Number(pf.consensus_under_ip || 0);

  const sideApps =
    candSide === "MORE" ? (overOdds || favOver > 0 || consensusOver > 0) :
    candSide === "LESS" ? (underOdds || favUnder > 0 || consensusUnder > 0) :
    false;

  const sideConsensus =
    candSide === "MORE" ? consensusOver :
    candSide === "LESS" ? consensusUnder :
    0;

  const sideFav =
    candSide === "MORE" ? favOver :
    candSide === "LESS" ? favUnder :
    0;

  // Conservative: don't upgrade just because a prop exists. Need app depth plus side-specific signal.
  if (apps >= 5 && sideApps && sideConsensus >= 0.62) return "PF_STRONG_SUPPORT";
  if (apps >= 3 && sideApps && (sideConsensus >= 0.56 || sideFav >= 2)) return "PF_SUPPORTED";
  if (apps >= 1 && sideApps) return "PF_THIN_SUPPORT";
  return "PF_MATCH_ONLY";
}

function probability(c) {
  const vals = [
    c.probability,
    c.prob,
    c.finalProbability,
    c.calibratedProbability,
    c.modelProbability,
    c.trueProbability,
    c.winProbability,
    c.p,
    c.edgeProbability,
    c.finalProb,
    c.calibratedProb,
    c.rawProbability,
    c.modelProb,
    c.evProbability,
    c.raw?.probability,
    c.raw?.prob,
    c.raw?.finalProbability,
    c.raw?.calibratedProbability,
    c.raw?.finalProb,
    c.raw?.calibratedProb,
    c.raw?.modelProb,
    c.raw?.evProbability,
    c.leg?.probability,
    c.leg?.prob,
    c.leg?.finalProbability,
    c.leg?.calibratedProbability,
    c.leg?.finalProb,
    c.leg?.calibratedProb,
    c.leg?.modelProb,
    c.legs?.[0]?.probability,
    c.legs?.[0]?.prob,
    c.legs?.[0]?.finalProbability,
    c.legs?.[0]?.calibratedProbability,
    c.legs?.[0]?.finalProb,
    c.legs?.[0]?.calibratedProb,
    c.legs?.[0]?.modelProb
  ];
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

const pfPropsFile = readJson(PF_PROPS, null);
const pfFull = readJson(PF_FULL, null);

let pfProps = [];
if (Array.isArray(pfPropsFile?.props)) pfProps = pfPropsFile.props;
else if (Array.isArray(pfFull?.props)) pfProps = pfFull.props;

const pfIndex = new Map();
for (const p of pfProps) {
  const player = pfPlayer(p);
  const line = pfLine(p);
  if (!player || line == null) continue;
  for (const market of pfAliases(p)) {
    addIndex(pfIndex, makeKey(player, market, line), p);
  }
}

const finalRows = flatten(readJson(FINAL, []));
const blockedRows = flatten(readJson(BLOCKED, []));

const candidates = [
  ...finalRows.map(x => ({...x, __bucket: "final"})),
  ...blockedRows.map(x => ({...x, __bucket: "blocked"}))
].filter(x => candPlayer(x) && candLine(x) != null);

const seenCand = new Set();
const deduped = [];
for (const c of candidates) {
  const key = `${c.__bucket}|${candPlayer(c)}|${candAliases(c).join(",")}|${candLine(c)}|${side(c.side || c.pick || c.selection)}|${probability(c)}`;
  if (seenCand.has(key)) continue;
  seenCand.add(key);
  deduped.push(c);
}

const enriched = deduped.map(c => {
  const s = side(c.side || c.pick || c.selection);
  const pf = findPf(pfIndex, c);
  const cls = supportClass(pf, s);

  return {
    bucket: c.__bucket,
    player: candPlayer(c),
    team: c.team || c.playerTeam || c.rawTeam || null,
    market: normMarket(c.market || c.stat || c.projectionType || c.type),
    marketAliases: candAliases(c),
    side: s,
    line: candLine(c),
    probability: probability(c),
    currentSupportClass: c.supportClass || c.directSupportClass || c.bookSupportClass || c.disabledReason || c.reason || null,
    disabledReason: c.disabledReason || c.reason || c.blockReason || null,
    pickfinderMatched: Boolean(pf),
    pickfinderStat: pf?.stat || null,
    pickfinderSupportClass: cls,
    pickfinderAppsCount: pf ? appCount(pf.apps) : 0,
    pickfinderBestOverApp: pf?.best_over_app || null,
    pickfinderBestUnderApp: pf?.best_under_app || null,
    pickfinderBestOverOdds: pf?.best_over_odds ?? null,
    pickfinderBestUnderOdds: pf?.best_under_odds ?? null,
    pickfinderConsensusOverIp: pf?.consensus_over_ip ?? null,
    pickfinderConsensusUnderIp: pf?.consensus_under_ip ?? null,
    pickfinderFavoriteOver: pf?.favorite_count_over ?? null,
    pickfinderFavoriteUnder: pf?.favorite_count_under ?? null,
    pickfinderHitRateL5: pf?.hitRateLast5 ?? null,
    pickfinderHitRateL10: pf?.hitRateLast10 ?? null,
    pickfinderHitRateL15: pf?.hitRateLast15 ?? null,
    pickfinderAverageL10: pf?.averageLast10 ?? null,
    pickfinderStreak: pf?.streak ?? null,
    raw: c
  };
});

const lowBookUpgradeCandidates = enriched.filter(x =>
  x.pickfinderMatched &&
  ["PF_STRONG_SUPPORT", "PF_SUPPORTED"].includes(x.pickfinderSupportClass) &&
  /low|book|support|direct|weak/i.test(String(x.currentSupportClass || x.disabledReason || ""))
);

const summary = {
  generatedAt: new Date().toISOString(),
  pfProps: pfProps.length,
  pfIndexKeys: pfIndex.size,
  candidates: deduped.length,
  matched: enriched.filter(x => x.pickfinderMatched).length,
  strong: enriched.filter(x => x.pickfinderSupportClass === "PF_STRONG_SUPPORT").length,
  supported: enriched.filter(x => x.pickfinderSupportClass === "PF_SUPPORTED").length,
  thin: enriched.filter(x => x.pickfinderSupportClass === "PF_THIN_SUPPORT").length,
  matchOnly: enriched.filter(x => x.pickfinderSupportClass === "PF_MATCH_ONLY").length,
  lowBookUpgradeCandidates: lowBookUpgradeCandidates.length
};

fs.writeFileSync(OUT, JSON.stringify({summary, enriched}, null, 2) + "\n");

const lines = [];
lines.push("PICKFINDER SUPPORT ENRICHER");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");

lines.push("LOW BOOK / SUPPORT UPGRADE CANDIDATES");
if (!lowBookUpgradeCandidates.length) lines.push("none");
for (const x of lowBookUpgradeCandidates.slice(0, 80)) {
  lines.push(`${x.player} ${x.market} ${x.side} ${x.line} prob=${x.probability} current=${x.currentSupportClass || x.disabledReason} pf=${x.pickfinderSupportClass} apps=${x.pickfinderAppsCount} overIP=${x.pickfinderConsensusOverIp} underIP=${x.pickfinderConsensusUnderIp} pfStat=${x.pickfinderStat}`);
}

lines.push("");
lines.push("TOP PF SUPPORTED MATCHES");
const scoreClass = c => c === "PF_STRONG_SUPPORT" ? 4 : c === "PF_SUPPORTED" ? 3 : c === "PF_THIN_SUPPORT" ? 2 : c === "PF_MATCH_ONLY" ? 1 : 0;
for (const x of enriched.filter(x => x.pickfinderMatched).sort((a,b) => {
  return scoreClass(b.pickfinderSupportClass) - scoreClass(a.pickfinderSupportClass) ||
    (b.pickfinderAppsCount || 0) - (a.pickfinderAppsCount || 0) ||
    Number(b.probability || 0) - Number(a.probability || 0);
}).slice(0, 100)) {
  lines.push(`${x.player} ${x.market} ${x.side} ${x.line} prob=${x.probability} current=${x.currentSupportClass || x.disabledReason || "-"} pf=${x.pickfinderSupportClass} apps=${x.pickfinderAppsCount} pfStat=${x.pickfinderStat}`);
}

lines.push("");
lines.push("UNMATCHED CANDIDATES SAMPLE");
for (const x of enriched.filter(x => !x.pickfinderMatched).slice(0, 80)) {
  lines.push(`${x.player} ${x.market} aliases=${x.marketAliases.join("|")} ${x.side} ${x.line} prob=${x.probability} current=${x.currentSupportClass || x.disabledReason || "-"}`);
}


lines.push("");
lines.push("NEAR PF NAME/LINE MATCHES");
for (const x of enriched.filter(x => !x.pickfinderMatched).slice(0, 40)) {
  const near = pfProps
    .filter(p => normName(pfPlayer(p)) === normName(x.player) || pfLine(p) === x.line)
    .slice(0, 12)
    .map(p => `${pfPlayer(p)} | ${p.stat} | line=${p.line} | apps=${appCount(p.apps)}`);
  lines.push(`${x.player} ${x.market} ${x.side} ${x.line}`);
  for (const n of near) lines.push(`  near: ${n}`);
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
