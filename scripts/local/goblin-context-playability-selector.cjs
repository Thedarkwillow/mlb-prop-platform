const fs = require("fs");

const SOURCES = [
  {
    lane: "goblin_highprob_clean",
    file: "outputs/goblin-highprob-slips.json",
    ranked: "outputs/goblin-highprob-construction-ranked.json"
  },
  {
    lane: "goblin_hrr_controlled",
    file: "outputs/goblin-hrr-controlled-slips.json",
    ranked: "outputs/goblin-hrr-survivability-ranked.json"
  }
];

const OUT = "outputs/goblin-context-playability.json";
const TXT = "outputs/goblin-context-playability.txt";

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
  if (n === null) return "?";
  return `${(n * 100).toFixed(1)}%`;
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
  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis")) return "hrr";
  if (t.includes("earned") || t.includes("runs allowed")) return "earned_runs_allowed";
  if (t.includes("hits allowed")) return "hits_allowed";
  if (t.includes("total bases") || t === "bases") return "bases";
  if (t === "hits" || t.includes("batter hits") || t.includes("player hits")) return "hits";
  if (t.includes("strikeout")) return "strikeouts";
  if (t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walks")) return "walks";
  if (t.includes("fantasy")) return "fantasy";
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

function legsOf(slip) {
  return Array.isArray(slip?.legs) ? slip.legs.map(l => l?.raw || l) : [];
}

function entryTypeOf(slip) {
  return String(slip?.entryType || slip?.type || slip?.playType || "POWER").toUpperCase();
}

function sizeOf(slip) {
  return Number(slip?.size || legsOf(slip).length || 0);
}

function slipId(slip, idx, lane) {
  return String(slip?.id || slip?.name || `${lane}_${idx + 1}`);
}

function legContextScore(raw) {
  const m = market(raw);
  const p = player(raw);
  let score = 0;
  const flags = [];

  const isHitterMarket = ["hrr", "bases", "hits"].includes(m);
  const isPitcherDamage = ["earned_runs_allowed", "hits_allowed"].includes(m);

  const lineupConfirmed =
    raw?.lineupConfirmed === true ||
    raw?.confirmedLineup === true ||
    raw?.isConfirmedLineup === true ||
    String(raw?.lineupPlayerStatus || "").toLowerCase() === "confirmed";

  const lineupStatus = String(raw?.lineupStatus || "").toLowerCase();
  const lineupPlayerStatus = String(raw?.lineupPlayerStatus || "").toLowerCase();

  if (isHitterMarket) {
    if (lineupConfirmed) {
      score += 35;
      flags.push("hitter_confirmed");
    } else if (lineupStatus.includes("confirmed") && !lineupPlayerStatus.includes("not")) {
      score += 10;
      flags.push("lineup_confirmed_status");
    } else {
      score -= 80;
      flags.push("hitter_not_confirmed");
    }
  }

  if (isPitcherDamage) {
    const lineupStrength = num(raw?.lineupStrength, null);
    const lineupTier = String(raw?.lineupTier || "").toUpperCase();

    if (lineupStatus.includes("confirmed")) {
      score += 18;
      flags.push("opponent_lineup_confirmed");
    }

    if (lineupStrength !== null) {
      if (lineupStrength >= 1.12) {
        score += 22;
        flags.push("strong_damage_lineup");
      } else if (lineupStrength <= 0.92) {
        score -= 18;
        flags.push("weak_damage_lineup");
      }
    }

    if (["GOOD", "STRONG", "ELITE"].includes(lineupTier)) {
      score += 10;
      flags.push(`lineup_tier_${lineupTier}`);
    }
  }

  const pitchTypeFlags = Array.isArray(raw?.pitchTypeMatchupFlags) ? raw.pitchTypeMatchupFlags.join("|") : "";
  const pitchTypeSource = String(raw?.pitchTypeMatchupSource || raw?.pitchTypeSource || "");
  const pitchTypeAvailable = raw?.pitchTypeMatchupAvailable === true || raw?.pitchTypeMatchupScored === true;

  if (pitchTypeAvailable && !/NEUTRAL_FALLBACK/i.test(pitchTypeSource)) {
    score += 18;
    flags.push("pitch_type_context_available");
  }

  if (/MISSING_PITCHER_ARSENAL|NEUTRAL_FALLBACK/i.test(pitchTypeFlags + "|" + pitchTypeSource)) {
    score -= 10;
    flags.push("pitch_type_neutral_or_missing");
  }

  const support = String(raw?.support || raw?.currentSupportClass || raw?.pfSupport || "").toUpperCase();
  if (support.includes("STRONG")) {
    score += 24;
    flags.push("strong_support");
  } else if (support.includes("OK") || support.includes("SUPPORTED")) {
    score += 10;
    flags.push("support_ok");
  } else if (support.includes("THIN") || support.includes("LOW")) {
    score -= 18;
    flags.push("thin_support");
  }

  const badNames = new Set(["reiddetmers", "jackperkins", "fostergriffin", "frambervaldez"]);
  if (badNames.has(norm(p))) {
    score -= 45;
    flags.push("recent_unmatched_or_bad_context_name");
  }

  if (["bases", "hits"].includes(m)) {
    score -= 60;
    flags.push("hitter_simple_market_downgrade");
  }

  if (m === "hrr") {
    score += 24;
    flags.push("hrr_anchor_context_boost");
  }

  if (m === "hits_allowed") {
    score += 12;
    flags.push("hits_allowed_context_boost");
  }

  if (side(raw) !== "MORE") {
    score -= 100;
    flags.push("not_more");
  }

  return { score, flags };
}

function slipContextScore(slip, lane, idx) {
  const legs = legsOf(slip);
  const size = sizeOf(slip);
  const entryType = entryTypeOf(slip);
  const probabilities = legs.map(prob).filter(Boolean);
  const avgProb = probabilities.length ? probabilities.reduce((a, b) => a + b, 0) / probabilities.length : 0;
  const minProb = probabilities.length ? Math.min(...probabilities) : 0;

  let score = 0;
  const flags = [];

  score += minProb * 650;
  score += avgProb * 300;

  if (size === 2) score += 80;
  else if (size === 3) score += 60;
  else if (size === 4) score += 25;
  else if (size === 5) score -= 20;
  else if (size === 6) score -= 45;

  if (entryType === "FLEX" && size >= 3) {
    score += 18;
    flags.push("flex_survivability");
  }

  if (lane.includes("hrr")) {
    score += 20;
    flags.push("controlled_hrr_lane");
  }

  const markets = {};
  const teams = {};
  for (const leg of legs) {
    markets[market(leg)] = (markets[market(leg)] || 0) + 1;
    teams[team(leg)] = (teams[team(leg)] || 0) + 1;

    const ctx = legContextScore(leg);
    score += ctx.score;
    flags.push(...ctx.flags);
  }

  const uniqueTeams = Object.keys(teams).filter(Boolean).length;
  if (uniqueTeams < 2) {
    score -= 500;
    flags.push("invalid_one_team");
  }

  const maxMarketCount = Math.max(0, ...Object.values(markets));
  if (maxMarketCount >= 5) {
    score -= 35;
    flags.push("heavy_market_cluster");
  } else if (maxMarketCount >= 4) {
    score -= 18;
    flags.push("market_cluster");
  }

  const hrrCount = markets.hrr || 0;
  if (lane.includes("hrr") && hrrCount !== 1) {
    score -= 200;
    flags.push("bad_hrr_anchor_count");
  }

  const badMarketCount =
    (markets.bases || 0) +
    (markets.hits || 0) +
    (markets.walks || 0) +
    (markets.walks_allowed || 0) +
    (markets.fantasy || 0);

  if (badMarketCount > 0) {
    score -= badMarketCount * 60;
    flags.push("contains_downgraded_market");
  }

  let playability = "DO_NOT_PLAY";
  if (score >= 1030 && size <= 3 && minProb >= 0.80) playability = "PRIMARY_TRACK";
  else if (score >= 940 && minProb >= 0.75) playability = "WATCHLIST";
  else if (lane.includes("hrr") && score >= 900 && minProb >= 0.72) playability = "WATCHLIST";

  return {
    id: slipId(slip, idx, lane),
    lane,
    size,
    entryType,
    playability,
    score: Number(score.toFixed(2)),
    avgProb,
    minProb,
    teams,
    markets,
    flags: [...new Set(flags)].slice(0, 18),
    legs: legs.map(leg => ({
      player: player(leg),
      team: team(leg),
      market: market(leg),
      side: side(leg),
      line: leg?.line,
      prob: prob(leg)
    }))
  };
}

const all = [];

for (const src of SOURCES) {
  const data = readJson(src.file, {});
  const ranked = readJson(src.ranked, {});
  const rawSlips = Array.isArray(data.slips) ? data.slips
    : Array.isArray(data?.summary?.slips) ? data.summary.slips
    : [];

  // Prefer expanded ranked slips when present because they include POWER/FLEX variants.
  const rankedSlips = Array.isArray(ranked?.ranked) ? ranked.ranked
    : Array.isArray(ranked?.topOverall) ? ranked.topOverall
    : [];

  const useSlips = rankedSlips.length && rankedSlips.every(x => Array.isArray(x.legs))
    ? rankedSlips
    : rawSlips;

  useSlips.forEach((slip, idx) => all.push(slipContextScore(slip, src.lane, idx)));
}

all.sort((a, b) => b.score - a.score);

const summary = {
  generatedAt: new Date().toISOString(),
  slips: all.length,
  byPlayability: all.reduce((acc, s) => {
    acc[s.playability] = (acc[s.playability] || 0) + 1;
    return acc;
  }, {}),
  byLane: all.reduce((acc, s) => {
    acc[s.lane] = (acc[s.lane] || 0) + 1;
    return acc;
  }, {}),
  rules: {
    contextWeighted: true,
    labels: ["PRIMARY_TRACK", "WATCHLIST", "DO_NOT_PLAY"],
    notes: [
      "Uses context already present on priced-board legs.",
      "Boosts confirmed hitter/lineup context, HRR anchors, pitcher-damage context, support, and safer sizes.",
      "Penalizes bases/hits, weak/missing context, unmatched-prone names, one-team slips, and heavy market clusters."
    ]
  }
};

const out = { summary, slips: all };
fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

const lines = [];
lines.push("GOBLIN CONTEXT PLAYABILITY SELECTOR");
lines.push("===================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");

for (const s of all.slice(0, 40)) {
  lines.push(`${s.id} | ${s.lane} | ${s.size}-man ${s.entryType} | ${s.playability} | score=${s.score} | minProb=${pct(s.minProb)} | avgProb=${pct(s.avgProb)}`);
  lines.push(`Teams: ${Object.entries(s.teams).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  lines.push(`Markets: ${Object.entries(s.markets).map(([k,v]) => `${k}:${v}`).join(", ")}`);
  lines.push(`Flags: ${s.flags.join(", ") || "-"}`);
  s.legs.forEach((l, i) => {
    lines.push(`${i + 1}. ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | prob=${pct(l.prob)}`);
  });
  lines.push("");
}

fs.writeFileSync(TXT, lines.join("\n"));

console.log(summary);
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
