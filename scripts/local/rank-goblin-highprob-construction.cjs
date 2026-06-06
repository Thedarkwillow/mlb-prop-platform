const fs = require("fs");

const IN = "outputs/goblin-highprob-slips.json";
const OUT = "outputs/goblin-highprob-construction-ranked.json";
const TXT = "outputs/goblin-highprob-construction-ranked.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function norm(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function player(leg) {
  return String(leg?.player || leg?.playerName || leg?.name || "").trim();
}
function team(leg) {
  return String(leg?.team || leg?.resolvedTeam || leg?.rawTeam || "").trim();
}
function market(leg) {
  const t = String(leg?.market || leg?.stat || leg?.projectionType || "").toLowerCase();
  if (t.includes("hrr") || t.includes("hits+runs+rbis")) return "hrr";
  if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
  if (t.includes("earned") || t.includes("runs_allowed")) return "earned_runs_allowed";
  if (t.includes("hits_allowed") || t.includes("hits allowed")) return "hits_allowed";
  if (t.includes("strikeout")) return "strikeouts";
  if (t.includes("pitching_outs") || t.includes("pitching outs")) return "pitching_outs";
  if (t.includes("bases") || t.includes("total bases")) return "bases";
  if (t.includes("walks_allowed") || t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walk")) return "walks";
  if (t.includes("hit")) return "hits";
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function side(leg) {
  return String(leg?.side || leg?.recommendedSide || leg?.playableSide || "").toUpperCase();
}
function prob(leg) {
  return num(
    leg?.prob ??
    leg?.probability ??
    leg?.recommendedProb ??
    leg?.modelProb ??
    leg?.p,
    0
  );
}
function teamCounts(legs) {
  const out = {};
  for (const leg of legs) {
    const t = team(leg);
    if (t) out[t] = (out[t] || 0) + 1;
  }
  return out;
}
function marketCounts(legs) {
  const out = {};
  for (const leg of legs) {
    const m = market(leg);
    if (m) out[m] = (out[m] || 0) + 1;
  }
  return out;
}
function playerCounts(legs) {
  const out = {};
  for (const leg of legs) {
    const p = norm(player(leg));
    if (p) out[p] = (out[p] || 0) + 1;
  }
  return out;
}
function maxVal(obj) {
  return Math.max(0, ...Object.values(obj || {}).map(Number));
}
function collectSlips(data) {
  const out = [];
  function walk(x, path = "root") {
    if (!x) return;
    if (Array.isArray(x)) {
      x.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof x !== "object") return;
    if (Array.isArray(x.legs)) {
      out.push({
        id: x.id || x.name || x.slipId || path,
        size: Number(x.size || x.legs.length),
        status: x.status || x.recommendation || "TRACK_ONLY",
        legs: x.legs
      });
      return;
    }
    for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`);
  }
  walk(data);
  return out;
}
function expandEntryTypes(slip) {
  const size = Number(slip.size || slip.legs.length);
  const types = size === 2 ? ["POWER"] : ["POWER", "FLEX"];
  return types.map(entryType => ({
    ...slip,
    id: `${slip.id}_${entryType.toLowerCase()}`,
    entryType,
    size
  }));
}
function scoreSlip(slip) {
  const legs = slip.legs || [];
  const ps = legs.map(prob).filter(Number.isFinite);
  const minProb = ps.length ? Math.min(...ps) : 0;
  const avgProb = ps.length ? ps.reduce((a,b)=>a+b,0) / ps.length : 0;
  const tc = teamCounts(legs);
  const mc = marketCounts(legs);
  const pc = playerCounts(legs);

  let score = 0;
  score += minProb * 1000;
  score += avgProb * 220;

  if (slip.size === 2) score += 30;
  if (slip.size === 3 && slip.entryType === "FLEX") score += 24;
  if (slip.size === 3 && slip.entryType === "POWER") score += 12;
  if (slip.size >= 4 && slip.entryType === "FLEX") score += 8;
  if (slip.size >= 5) score -= 12;
  if (slip.size === 6) score -= 18;

  const maxTeam = maxVal(tc);
  const maxMarket = maxVal(mc);
  const maxPlayer = maxVal(pc);

  if (maxTeam >= 3) score -= (maxTeam - 2) * 16;
  if (maxMarket >= 4) score -= (maxMarket - 3) * 10;
  if (maxPlayer >= 2) score -= (maxPlayer - 1) * 28;

  const hasHrr = legs.some(l => market(l) === "hrr");
  const hasFantasy = legs.some(l => market(l).includes("fantasy"));
  const hasHitsMore = legs.some(l => market(l) === "hits" && side(l) === "MORE");

  if (hasFantasy) score -= 80;
  if (hasHitsMore) score -= 40;
  if (hasHrr) score += 10;

  return {
    score,
    minProb,
    avgProb,
    teamCounts: tc,
    marketCounts: mc,
    playerCounts: pc
  };
}

const data = readJson(IN, {});
const rawSlips = collectSlips(data)
  .filter(s => Array.isArray(s.legs) && s.legs.length >= 2 && s.legs.length <= 6);

const variants = [];
const seen = new Set();
for (const slip of rawSlips) {
  for (const v of expandEntryTypes(slip)) {
    const key = `${v.id}|${v.entryType}|${v.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sc = scoreSlip(v);
    variants.push({
      id: v.id,
      baseId: slip.id,
      size: v.size,
      entryType: v.entryType,
      lane: v.size <= 3 ? "PRIMARY_TRACK" : "UPSIDE_TRACK",
      score: Number(sc.score.toFixed(2)),
      minProb: sc.minProb,
      avgProb: sc.avgProb,
      teamCounts: sc.teamCounts,
      marketCounts: sc.marketCounts,
      playerCounts: sc.playerCounts,
      status: "TRACK_ONLY",
      legs: v.legs
    });
  }
}
variants.sort((a,b) => b.score - a.score);

const bySize = {};
for (const v of variants) bySize[v.size] = (bySize[v.size] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  input: IN,
  slips: variants.length,
  bySize,
  rules: {
    focus: [
      "weakest-leg probability",
      "average probability",
      "2/3-man survivability",
      "POWER/FLEX separation",
      "team concentration",
      "player concentration",
      "market concentration",
      "fantasy/hits-more downgrades"
    ],
    status: "TRACK_ONLY"
  },
  topOverall: variants.slice(0, 25),
  ranked: variants
};

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

const lines = [];
lines.push("GOBLIN HIGH-PROB CONSTRUCTION RANKING");
lines.push("=====================================");
lines.push(JSON.stringify({
  generatedAt: report.generatedAt,
  slips: report.slips,
  bySize: report.bySize
}, null, 2));
lines.push("");
for (const s of variants.slice(0, 30)) {
  lines.push(`${s.id} | ${s.size}-man ${s.entryType} | ${s.lane} | score=${s.score} | minProb=${(s.minProb*100).toFixed(1)}% | avgProb=${(s.avgProb*100).toFixed(1)}%`);
  lines.push(`Teams: ${Object.entries(s.teamCounts).map(([k,v])=>`${k}:${v}`).join(", ")}`);
  lines.push(`Markets: ${Object.entries(s.marketCounts).map(([k,v])=>`${k}:${v}`).join(", ")}`);
  s.legs.forEach((l, i) => {
    lines.push(`${i+1}. ${player(l)} | ${team(l)} | ${market(l)} ${side(l)} ${l.line ?? ""} | prob=${(prob(l)*100).toFixed(1)}%`);
  });
  lines.push("");
}
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: report.generatedAt,
  slips: report.slips,
  bySize: report.bySize,
  top: variants.slice(0, 5).map(x => ({
    id: x.id,
    size: x.size,
    entryType: x.entryType,
    lane: x.lane,
    minProb: x.minProb,
    avgProb: x.avgProb
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
