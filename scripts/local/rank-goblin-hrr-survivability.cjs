const fs = require("fs");

const IN = "outputs/goblin-hrr-controlled-slips.json";
const OUT = "outputs/goblin-hrr-survivability-ranked.json";
const TXT = "outputs/goblin-hrr-survivability-ranked.txt";

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
  return String(leg?.market || leg?.stat || leg?.projectionType || "").toLowerCase();
}

function side(leg) {
  return String(leg?.side || leg?.recommendedSide || "").toUpperCase();
}

function prob(leg) {
  return num(
    leg?.prob ??
    leg?.probability ??
    leg?.recommendedProb ??
    leg?.modelProb ??
    0
  );
}

function role(leg) {
  return String(leg?.role || "").toUpperCase();
}

function countMap(values) {
  const m = new Map();
  for (const v of values.filter(Boolean)) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

function maxCount(values) {
  const m = countMap(values);
  let max = 0;
  for (const v of m.values()) max = Math.max(max, v);
  return max;
}

function duplicateCount(values) {
  const m = countMap(values);
  let dup = 0;
  for (const v of m.values()) {
    if (v > 1) dup += v - 1;
  }
  return dup;
}

function entryTypeOf(slip) {
  const raw = String(slip.entryType || slip.type || slip.name || slip.id || "").toLowerCase();
  if (raw.includes("flex")) return "FLEX";
  return "POWER";
}

function sizeOf(slip) {
  return Number(slip.size || (Array.isArray(slip.legs) ? slip.legs.length : 0));
}

function slipId(slip, idx) {
  return String(slip.id || slip.name || `hrr_slip_${idx + 1}`);
}

function scoreSlip(slip, idx) {
  const legs = Array.isArray(slip.legs) ? slip.legs : [];
  const size = sizeOf(slip);
  const entryType = entryTypeOf(slip);
  const probs = legs.map(prob).filter(Number.isFinite);
  const minProb = probs.length ? Math.min(...probs) : 0;
  const avgProb = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : 0;

  const players = legs.map(player).filter(Boolean).map(norm);
  const teams = legs.map(team).filter(Boolean);
  const markets = legs.map(market).filter(Boolean);
  const roles = legs.map(role);

  const hrrAnchors = roles.filter(x => x === "HRR_ANCHOR").length;
  const fillerCount = roles.filter(x => x === "FILLER").length;

  const maxTeam = maxCount(teams);
  const teamDupes = duplicateCount(teams);
  const playerDupes = duplicateCount(players);
  const marketDupes = duplicateCount(markets);

  const hasBadStructure =
    hrrAnchors !== 1 ||
    fillerCount !== size - 1 ||
    new Set(teams).size < 2 ||
    size < 2 ||
    size > 6;

  let score = 0;

  // Core quality.
  score += minProb * 1000;
  score += avgProb * 350;

  // Lower-leg slips convert edge better; bigger slips are kept but treated as upside.
  if (size === 2) score += 42;
  if (size === 3) score += 32;
  if (size === 4) score += 16;
  if (size === 5) score += 8;
  if (size === 6) score += 2;

  // Flex helps survive one miss on 3+ legs, but power is still cleaner for 2-man.
  if (entryType === "FLEX" && size >= 3) score += 9;
  if (entryType === "POWER" && size === 2) score += 10;

  // Penalize concentration and repeated failure paths.
  score -= Math.max(0, maxTeam - 2) * 18;
  score -= teamDupes * 4;
  score -= playerDupes * 32;
  score -= Math.max(0, marketDupes - 2) * 3;

  // Strongly reject malformed slips.
  if (hasBadStructure) score -= 10000;

  let lane = "TRACK_ONLY";
  if (!hasBadStructure && size <= 3 && minProb >= 0.80) lane = "PRIMARY_TRACK";
  else if (!hasBadStructure && size <= 3 && minProb >= 0.76) lane = "SECONDARY_TRACK";
  else if (!hasBadStructure && size >= 4 && minProb >= 0.80) lane = "UPSIDE_TRACK";
  else if (!hasBadStructure) lane = "DEEP_TRACK";

  return {
    id: slipId(slip, idx),
    size,
    entryType,
    lane,
    score,
    avgProb,
    minProb,
    maxTeam,
    uniqueTeams: new Set(teams).size,
    teamDupes,
    playerDupes,
    marketDupes,
    hrrAnchors,
    fillerCount,
    hasBadStructure,
    teams: Object.fromEntries([...countMap(teams).entries()]),
    markets: Object.fromEntries([...countMap(markets).entries()]),
    legs
  };
}

function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a";
}

const data = readJson(IN, {});
const slips = Array.isArray(data.slips) ? data.slips : [];

const ranked = slips
  .map(scoreSlip)
  .sort((a, b) => b.score - a.score);

const bySize = {};
for (const r of ranked) {
  bySize[r.size] ||= [];
  bySize[r.size].push(r);
}

const byEntryType = {};
for (const r of ranked) {
  const key = `${r.size}-${r.entryType}`;
  byEntryType[key] ||= [];
  byEntryType[key].push(r);
}

const summary = {
  generatedAt: new Date().toISOString(),
  input: IN,
  slips: ranked.length,
  cleanBuilderV2: Boolean(
    data?.rules?.cleanBuilderV2 ||
    data?.summary?.rules?.cleanBuilderV2 ||
    data?.meta?.rules?.cleanBuilderV2
  ),
  rules: {
    rankFocus: [
      "weakest-leg probability",
      "average probability",
      "2/3-man survivability",
      "POWER/FLEX separation",
      "team/player/market concentration penalties",
      "one HRR anchor per slip",
      "pitcher-damage fillers only"
    ],
    status: "TRACK_ONLY"
  },
  bySize: Object.fromEntries(Object.entries(bySize).map(([k, v]) => [k, v.length])),
  topOverall: ranked.slice(0, 15).map(x => ({
    id: x.id,
    size: x.size,
    entryType: x.entryType,
    lane: x.lane,
    score: Number(x.score.toFixed(2)),
    avgProb: x.avgProb,
    minProb: x.minProb,
    teams: x.teams,
    markets: x.markets
  }))
};

const out = {
  ...summary,
  ranked
};

const lines = [];
lines.push("HRR GOBLIN SURVIVABILITY RANKING");
lines.push("=================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");
lines.push("TOP OVERALL");
lines.push("-----------");

for (const r of ranked.slice(0, 20)) {
  lines.push(`${r.id} | ${r.size}-man ${r.entryType} | ${r.lane} | score=${r.score.toFixed(1)} | avg=${pct(r.avgProb)} | min=${pct(r.minProb)} | teams=${r.uniqueTeams} | maxTeam=${r.maxTeam}`);
  lines.push(`Teams: ${Object.entries(r.teams).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  r.legs.forEach((l, i) => {
    lines.push(`${i + 1}. ${role(l)} | ${player(l)} | ${team(l)} | ${market(l)} ${side(l)} ${l.line ?? "?"} | prob=${pct(prob(l))}`);
  });
  lines.push("");
}

lines.push("TOP BY SIZE / ENTRY TYPE");
lines.push("------------------------");
for (const key of Object.keys(byEntryType).sort()) {
  const top = byEntryType[key].slice(0, 5);
  lines.push(key);
  for (const r of top) {
    lines.push(`- ${r.id} | ${r.lane} | score=${r.score.toFixed(1)} | avg=${pct(r.avgProb)} | min=${pct(r.minProb)} | teams=${r.uniqueTeams}`);
  }
}

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: summary.generatedAt,
  slips: ranked.length,
  top: summary.topOverall.slice(0, 5).map(x => ({
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
