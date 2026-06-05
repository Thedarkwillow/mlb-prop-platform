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

function normMarket(v) {
  let m = String(v || "").toLowerCase().trim();

  m = m.replace(/\s+/g, "_");
  m = m.replace(/\+/g, "_plus_");
  m = m.replace(/[^a-z0-9_]+/g, "_");
  m = m.replace(/^_+|_+$/g, "");

  if (m.includes("hits_runs_rbis") || m.includes("hits_plus_runs_plus_rbis")) return "hrr";
  if (m.includes("total_bases") || m === "bases") return "bases";
  if (m === "hits" || m.includes("batter_hits")) return "hits";
  if (m.includes("singles")) return "singles";
  if (m.includes("walks")) return "walks";
  if (m.includes("runs_allowed") || m.includes("earned_runs")) return "earned_runs_allowed";
  if (m.includes("hits_allowed")) return "hits_allowed";
  if (m.includes("pitcher_walks") || m.includes("walks_allowed")) return "walks_allowed";
  if (m.includes("strikeouts") || m.includes("pitcher_strikeouts")) return "strikeouts";
  if (m.includes("outs")) return "pitching_outs";
  if (m.includes("fantasy")) return "fantasy_score";

  return m;
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

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    v.player || v.playerName || v.player_name ||
    v.market || v.stat ||
    v.side || v.line != null
  ) out.push(v);

  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flatten(x, out);
  }
  return out;
}

function candidateKey(x) {
  const player = normName(x.player || x.playerName || x.player_name || x.name);
  const market = normMarket(x.market || x.stat || x.projectionType || x.type);
  const line = lineNum(x.line || x.ppLine || x.prizepicksLine);
  return `${player}|${market}|${line}`;
}

function pfKey(x) {
  const player = normName(x.player_name || x.playerName || x.player);
  const market = normMarket(x.stat || x.market);
  const line = lineNum(x.line);
  return `${player}|${market}|${line}`;
}

function appCount(apps) {
  if (Array.isArray(apps)) return apps.length;
  if (apps && typeof apps === "object") return Object.keys(apps).length;
  if (typeof apps === "string" && apps.trim()) return apps.split(",").filter(Boolean).length;
  return 0;
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

  if (apps >= 4 && sideApps && sideConsensus >= 0.60) return "PF_STRONG_SUPPORT";
  if (apps >= 2 && sideApps && sideConsensus >= 0.55) return "PF_SUPPORTED";
  if (apps >= 1 && sideApps) return "PF_THIN_SUPPORT";
  return "PF_MATCH_ONLY";
}

const pfPropsFile = readJson(PF_PROPS, null);
const pfFull = readJson(PF_FULL, null);

let pfProps = [];
if (Array.isArray(pfPropsFile?.props)) pfProps = pfPropsFile.props;
else if (Array.isArray(pfFull?.props)) pfProps = pfFull.props;

const pfIndex = new Map();
for (const p of pfProps) {
  const k = pfKey(p);
  if (!k.includes("||") && !pfIndex.has(k)) pfIndex.set(k, p);
}

const finalRows = flatten(readJson(FINAL, []));
const blockedRows = flatten(readJson(BLOCKED, []));

const candidates = [
  ...finalRows.map(x => ({...x, __bucket: "final"})),
  ...blockedRows.map(x => ({...x, __bucket: "blocked"}))
];

const enriched = candidates.map(c => {
  const k = candidateKey(c);
  const pf = pfIndex.get(k);
  const s = side(c.side || c.pick || c.selection);
  const cls = supportClass(pf, s);

  return {
    bucket: c.__bucket,
    player: c.player || c.playerName || c.player_name || c.name || null,
    team: c.team || c.playerTeam || null,
    market: normMarket(c.market || c.stat || c.projectionType || c.type),
    side: s,
    line: lineNum(c.line || c.ppLine || c.prizepicksLine),
    probability: c.probability ?? c.prob ?? c.finalProbability ?? c.calibratedProbability ?? null,
    currentSupportClass: c.supportClass || c.directSupportClass || c.bookSupportClass || c.disabledReason || c.reason || null,
    disabledReason: c.disabledReason || c.reason || c.blockReason || null,
    pickfinderMatched: Boolean(pf),
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

const summary = {
  generatedAt: new Date().toISOString(),
  pfProps: pfProps.length,
  candidates: candidates.length,
  matched: enriched.filter(x => x.pickfinderMatched).length,
  strong: enriched.filter(x => x.pickfinderSupportClass === "PF_STRONG_SUPPORT").length,
  supported: enriched.filter(x => x.pickfinderSupportClass === "PF_SUPPORTED").length,
  thin: enriched.filter(x => x.pickfinderSupportClass === "PF_THIN_SUPPORT").length,
  lowBookUpgradeCandidates: enriched.filter(x =>
    x.pickfinderMatched &&
    ["PF_STRONG_SUPPORT", "PF_SUPPORTED"].includes(x.pickfinderSupportClass) &&
    /low|book|support|direct/i.test(String(x.currentSupportClass || x.disabledReason || ""))
  ).length
};

fs.writeFileSync(OUT, JSON.stringify({summary, enriched}, null, 2) + "\n");

const lines = [];
lines.push("PICKFINDER SUPPORT ENRICHER");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");
lines.push("LOW BOOK / SUPPORT UPGRADE CANDIDATES");
for (const x of enriched.filter(x =>
  x.pickfinderMatched &&
  ["PF_STRONG_SUPPORT", "PF_SUPPORTED"].includes(x.pickfinderSupportClass) &&
  /low|book|support|direct/i.test(String(x.currentSupportClass || x.disabledReason || ""))
).slice(0, 80)) {
  lines.push(`${x.player} ${x.market} ${x.side} ${x.line} prob=${x.probability} current=${x.currentSupportClass || x.disabledReason} pf=${x.pickfinderSupportClass} apps=${x.pickfinderAppsCount} overIP=${x.pickfinderConsensusOverIp} underIP=${x.pickfinderConsensusUnderIp}`);
}

lines.push("");
lines.push("TOP PF SUPPORTED MATCHES");
for (const x of enriched.filter(x => x.pickfinderMatched).sort((a,b) => {
  const score = c => (c.pickfinderSupportClass === "PF_STRONG_SUPPORT" ? 3 : c.pickfinderSupportClass === "PF_SUPPORTED" ? 2 : c.pickfinderSupportClass === "PF_THIN_SUPPORT" ? 1 : 0);
  return score(b) - score(a);
}).slice(0, 80)) {
  lines.push(`${x.player} ${x.market} ${x.side} ${x.line} prob=${x.probability} current=${x.currentSupportClass || x.disabledReason || "-"} pf=${x.pickfinderSupportClass} apps=${x.pickfinderAppsCount}`);
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
