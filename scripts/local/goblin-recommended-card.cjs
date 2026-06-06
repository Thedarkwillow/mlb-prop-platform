const fs = require("fs");

const PLAY = "outputs/goblin-context-playability.json";
const OUT = "outputs/goblin-recommended-card.json";
const TXT = "outputs/goblin-recommended-card.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "?" : `${(n * 100).toFixed(1)}%`;
}

function legProb(leg) {
  return num(
    leg.probability ??
    leg.prob ??
    leg.modelProbability ??
    leg.winProb ??
    0
  );
}

function market(leg) {
  return String(leg.market || leg.statType || leg.type || "").toLowerCase();
}

function player(leg) {
  return String(leg.player || leg.playerName || leg.name || "").trim();
}

function team(leg) {
  return String(leg.team || leg.resolvedTeam || leg.rawTeam || "").trim();
}

function side(leg) {
  return String(leg.side || leg.pick || leg.direction || "").toUpperCase();
}

function line(leg) {
  return leg.line ?? leg.target ?? leg.value ?? "?";
}

function legsOf(slip) {
  return Array.isArray(slip.legs) ? slip.legs : [];
}

function marketsOf(slip) {
  let out = {};
  for (const leg of legsOf(slip)) {
    const m = market(leg) || "unknown";
    out[m] = (out[m] || 0) + 1;
  }
  return out;
}

function teamsOf(slip) {
  let out = {};
  for (const leg of legsOf(slip)) {
    const t = team(leg) || "UNK";
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}

function hasFlag(slip, text) {
  const flags = Array.isArray(slip.flags) ? slip.flags : [];
  return flags.map(String).some(x => x.toLowerCase().includes(text.toLowerCase()));
}

function scoreSlip(slip) {
  const size = Number(slip.size || legsOf(slip).length);
  const entryType = String(slip.entryType || slip.type || "").toUpperCase();
  const lane = String(slip.lane || "");
  const playability = String(slip.playability || slip.label || "");
  const avgProb = num(slip.avgProb ?? slip.averageProbability ?? 0);
  const minProb = num(slip.minProb ?? slip.minimumProbability ?? 0);
  const markets = marketsOf(slip);

  let score = num(slip.score, 0);

  // Start with probability survival.
  score += avgProb * 500;
  score += minProb * 850;

  // We learned HRR controlled is the real goblin lane so far.
  if (lane.includes("hrr_controlled")) score += 90;
  if (lane.includes("highprob_clean")) score -= 55;

  // Safer construction preference.
  if (size === 2) score += 85;
  if (size === 3 && entryType === "FLEX") score += 80;
  if (size === 3 && entryType === "POWER") score += 45;
  if (size === 4 && entryType === "FLEX") score += 25;
  if (size >= 5) score -= 45;
  if (size >= 6) score -= 75;

  // Context labels.
  if (playability === "PRIMARY_TRACK") score += 80;
  if (playability === "WATCHLIST") score += 20;
  if (playability === "DO_NOT_PLAY") score -= 160;

  // Context flags.
  if (hasFlag(slip, "hrr_anchor_context_boost")) score += 45;
  if (hasFlag(slip, "hitter_confirmed")) score += 25;
  if (hasFlag(slip, "opponent_lineup_confirmed")) score += 25;
  if (hasFlag(slip, "strong_damage_lineup")) score += 30;
  if (hasFlag(slip, "flex_survivability")) score += 35;
  if (hasFlag(slip, "market_cluster")) score -= 40;
  if (hasFlag(slip, "recent_unmatched_or_bad_context_name")) score -= 35;

  // Market shape.
  if (markets.hrr === 1) score += 55;
  if ((markets.earned_runs_allowed || 0) >= 1) score += 20;
  if ((markets.hits_allowed || 0) >= 1) score += 10;
  if ((markets.earned_runs_allowed || 0) >= 4) score -= 25;
  if (markets.bases || markets.hits || markets.walks || markets.fantasy) score -= 180;

  return score;
}

function bucketFor(slip) {
  const size = Number(slip.size || legsOf(slip).length);
  const entryType = String(slip.entryType || "").toUpperCase();
  const lane = String(slip.lane || "");

  if (lane.includes("hrr_controlled") && size === 2 && entryType === "POWER") {
    return "PRIMARY_2_MAN_POWER";
  }
  if (lane.includes("hrr_controlled") && size === 3 && entryType === "FLEX") {
    return "PRIMARY_3_MAN_FLEX";
  }
  if (lane.includes("hrr_controlled") && size === 3 && entryType === "POWER") {
    return "SECONDARY_3_MAN_POWER";
  }
  if (lane.includes("hrr_controlled") && size === 4 && entryType === "FLEX") {
    return "UPSIDE_4_MAN_FLEX";
  }
  if (lane.includes("highprob_clean")) {
    return "SHADOW_HIGHPROB_CLEAN";
  }
  return "WATCH_ONLY";
}

const data = readJson(PLAY, {});
const rows = Array.isArray(data.slips) ? data.slips : [];

const ranked = rows
  .map(slip => ({
    ...slip,
    finalScore: scoreSlip(slip),
    recommendationBucket: bucketFor(slip)
  }))
  .sort((a, b) => b.finalScore - a.finalScore);

function playableRow(x) {
  const p = String(x.playability || "").toUpperCase();
  return p === "PRIMARY_TRACK" || p === "WATCHLIST";
}

const playableRanked = ranked.filter(playableRow);
const doNotPlayRanked = ranked.filter(x => !playableRow(x));

const primary = playableRanked.filter(x =>
  ["PRIMARY_2_MAN_POWER", "PRIMARY_3_MAN_FLEX"].includes(x.recommendationBucket)
).slice(0, 8);

const secondary = playableRanked.filter(x =>
  ["SECONDARY_3_MAN_POWER", "UPSIDE_4_MAN_FLEX"].includes(x.recommendationBucket)
).slice(0, 8);

const shadow = playableRanked.filter(x =>
  x.recommendationBucket === "SHADOW_HIGHPROB_CLEAN"
).slice(0, 8);

const doNotPlay = doNotPlayRanked.slice(0, 12);

const report = {
  generatedAt: new Date().toISOString(),
  source: PLAY,
  totalRows: rows.length,
  rules: {
    finalGoblinCard: true,
    currentPolicy: [
      "HRR controlled is preferred over clean highprob.",
      "2-man POWER and 3-man FLEX are the preferred playable goblin shapes.",
      "Clean highprob remains shadow/watch until slip-level results improve.",
      "Do not auto-play DO_NOT_PLAY rows.",
      "If every goblin row is DO_NOT_PLAY, output NO_PLAYABLE_GOBLIN_CARD instead of a fake primary card."
    ]
  },
  counts: {
    primary: primary.length,
    secondary: secondary.length,
    shadow: shadow.length,
    doNotPlay: doNotPlay.length,
    playableRows: playableRanked.length,
    allRanked: ranked.length
  },
  primary,
  secondary,
  doNotPlay,
  shadow,
  status: primary.length ? "PLAYABLE_GOBLIN_CARD_AVAILABLE" : "NO_PLAYABLE_GOBLIN_CARD"
};

function formatSlip(slip, idx) {
  const lines = [];
  const size = Number(slip.size || legsOf(slip).length);
  const entryType = String(slip.entryType || "").toUpperCase();
  lines.push(`${idx}. ${slip.id || slip.name || "unknown"} | ${slip.lane || "?"} | ${size}-man ${entryType} | ${slip.playability || "?"} | bucket=${slip.recommendationBucket} | finalScore=${num(slip.finalScore).toFixed(2)} | minProb=${pct(slip.minProb)} | avgProb=${pct(slip.avgProb)}`);
  lines.push(`   Teams: ${Object.entries(teamsOf(slip)).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  lines.push(`   Markets: ${Object.entries(marketsOf(slip)).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  legsOf(slip).forEach((leg, i) => {
    lines.push(`   ${i + 1}. ${player(leg)} | ${team(leg)} | ${market(leg)} ${side(leg)} ${line(leg)} | prob=${pct(legProb(leg))}`);
  });
  return lines.join("\n");
}

const txt = [];
txt.push("FINAL GOBLIN RECOMMENDED CARD");
txt.push("=============================");
txt.push(JSON.stringify({
  generatedAt: report.generatedAt,
  totalRows: report.totalRows,
  counts: report.counts,
  policy: report.rules.currentPolicy
}, null, 2));

txt.push("");
txt.push("PRIMARY CARD");
txt.push("------------");
if (!primary.length) {
  txt.push("NO_PLAYABLE_GOBLIN_CARD: every candidate is currently DO_NOT_PLAY or failed playability filters.");
} else {
  primary.forEach((s, i) => txt.push(formatSlip(s, i + 1)));
}

txt.push("");
txt.push("SECONDARY / UPSIDE");
txt.push("------------------");
secondary.forEach((s, i) => txt.push(formatSlip(s, i + 1)));

txt.push("");
txt.push("SHADOW ONLY");
txt.push("-----------");
shadow.forEach((s, i) => txt.push(formatSlip(s, i + 1)));

txt.push("");
txt.push("DO NOT PLAY");
txt.push("-----------");
doNotPlay.forEach((s, i) => txt.push(formatSlip(s, i + 1)));


function enforceNoDoNotPlayInRecommendedCard(card) {
  const out = card && typeof card === "object" ? card : {};
  const playable = row => {
    const p = String(row?.playability || "").toUpperCase();
    return p === "PRIMARY_TRACK" || p === "WATCHLIST";
  };

  const cleanArray = arr => Array.isArray(arr) ? arr.filter(playable) : [];

  out.primary = cleanArray(out.primary);
  out.secondary = cleanArray(out.secondary);
  out.shadow = cleanArray(out.shadow);

  if (!out.primary.length) {
    out.status = "NO_PLAYABLE_GOBLIN_CARD";
    out.primary = [];
    out.secondary = [];
    out.shadow = [];
  } else {
    out.status = out.status || "PLAYABLE_GOBLIN_CARD";
  }

  out.counts = out.counts && typeof out.counts === "object" ? out.counts : {};
  out.counts.primary = out.primary.length;
  out.counts.secondary = out.secondary.length;
  out.counts.shadow = out.shadow.length;
  out.counts.playableRows =
    out.primary.length + out.secondary.length + out.shadow.length;

  return out;
}

enforceNoDoNotPlayInRecommendedCard(report);
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
fs.writeFileSync(TXT, txt.join("\n"));

console.log({
  generatedAt: report.generatedAt,
  source: PLAY,
  totalRows: rows.length,
  counts: report.counts,
  status: report.status,
  topPrimary: primary.slice(0, 5).map(x => ({
    id: x.id,
    lane: x.lane,
    size: x.size,
    entryType: x.entryType,
    playability: x.playability,
    bucket: x.recommendationBucket,
    finalScore: Number(x.finalScore.toFixed(2)),
    minProb: x.minProb,
    avgProb: x.avgProb
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
