function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function cleanMarket(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .trim();
}

function cleanName(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function rowProjection(r) {
  return num(
    r?.contextAdjustedProjection,
    r?.projection,
    r?.projected,
    r?.mean,
    r?.lineProjection
  );
}

function keyFor(r) {
  return [
    cleanName(r.player),
    String(r.team || "").toUpperCase(),
    String(r.game || "").toUpperCase()
  ].join("|");
}

function buildComponentIndex(rows) {
  const byKey = new Map();

  for (const r of rows || []) {
    if (!r || !r.player) continue;
    const k = keyFor(r);
    const market = cleanMarket(r.market || r.stat);
    if (!market) continue;

    if (!byKey.has(k)) byKey.set(k, {});
    const slot = byKey.get(k);

    const existing = slot[market];
    const incoming = {
      market,
      projection: rowProjection(r),
      sourceRow: r,
      oddsTier: r.oddsTier || null
    };

    if (!existing) {
      slot[market] = incoming;
      continue;
    }

    if (existing.oddsTier !== "standard" && incoming.oddsTier === "standard") {
      slot[market] = incoming;
    }
  }

  return byKey;
}

function getComp(comps, market) {
  return num(comps?.[market]?.projection);
}

function projectHitterFantasy(comps = {}) {
  const singles = getComp(comps, "singles");
  const doubles = getComp(comps, "doubles");
  const triples = getComp(comps, "triples");
  const homeRuns = getComp(comps, "home_runs") || getComp(comps, "hr");
  const runs = getComp(comps, "runs");
  const rbis = getComp(comps, "rbis") || getComp(comps, "rbi");
  const walks = getComp(comps, "walks");
  const hbp = getComp(comps, "hit_by_pitch") || getComp(comps, "hbp");
  const stolenBases = getComp(comps, "stolen_bases") || getComp(comps, "stolen_base");

  const baseScore =
    singles * 3 +
    doubles * 5 +
    triples * 8 +
    homeRuns * 10 +
    runs * 2 +
    rbis * 2 +
    walks * 2 +
    hbp * 2 +
    stolenBases * 5;

  // Conservative correlation layer.
  // HRs often carry run/RBI value beyond the raw HR points.
  // Other hits and walks create smaller run/RBI paths.
  const correlationBoost =
    homeRuns * 2.0 +
    (singles + doubles + triples) * 0.3 +
    walks * 0.25;

  const used = {
    singles,
    doubles,
    triples,
    homeRuns,
    runs,
    rbis,
    walks,
    hbp,
    stolenBases
  };

  const available = Object.values(used).filter(v => Number.isFinite(v) && v !== 0).length;
  const tier =
    available >= 6 ? "HIGH" :
    available >= 4 ? "MEDIUM" :
    available >= 2 ? "LOW" :
    "VERY_LOW";

  const coverageMultiplier =
    tier === "HIGH" ? 1 :
    tier === "MEDIUM" ? 0.92 :
    tier === "LOW" ? 0.85 :
    0.75;

  const rawScore = baseScore + correlationBoost;
  const score = rawScore * coverageMultiplier;

  return {
    projection: Number(score.toFixed(3)),
    baseProjection: Number(baseScore.toFixed(3)),
    correlationBoost: Number(correlationBoost.toFixed(3)),
    coverageMultiplier,
    components: used,
    coverage: {
      available,
      possible: 9,
      tier
    }
  };
}

function projectPitcherFantasy(comps = {}) {
  const strikeouts = getComp(comps, "strikeouts");
  const outs = getComp(comps, "pitching_outs");
  const earnedRuns = getComp(comps, "earned_runs_allowed");
  const winProb = getComp(comps, "win_probability") || getComp(comps, "wins");
  const qsProb = getComp(comps, "quality_start_probability") || getComp(comps, "quality_starts");

  const score =
    winProb * 6 +
    qsProb * 4 +
    earnedRuns * -3 +
    strikeouts * 3 +
    outs;

  const used = {
    winProb,
    qsProb,
    earnedRuns,
    strikeouts,
    outs
  };

  const available = Object.values(used).filter(v => Number.isFinite(v) && v !== 0).length;

  return {
    projection: Number(score.toFixed(3)),
    components: used,
    coverage: {
      available,
      possible: 5,
      tier:
        available >= 4 ? "HIGH" :
        available >= 3 ? "MEDIUM" :
        available >= 2 ? "LOW" :
        "VERY_LOW"
    }
  };
}

function projectPitchesThrown(comps = {}) {
  const outs = getComp(comps, "pitching_outs");
  const strikeouts = getComp(comps, "strikeouts");
  const walksAllowed = getComp(comps, "walks_allowed");
  const earnedRuns = getComp(comps, "earned_runs_allowed");

  // Conservative shell: outs drive volume, Ks/BB/ER add inefficiency.
  const projection =
    outs * 4.35 +
    strikeouts * 0.75 +
    walksAllowed * 3.5 +
    earnedRuns * 1.25;

  return {
    projection: Number(projection.toFixed(3)),
    components: { outs, strikeouts, walksAllowed, earnedRuns },
    coverage: {
      available: [outs, strikeouts, walksAllowed, earnedRuns].filter(v => Number.isFinite(v) && v !== 0).length,
      possible: 4,
      tier: outs && strikeouts ? "MEDIUM" : "LOW"
    }
  };
}

function projectPlateAppearances(comps = {}) {
  const runs = getComp(comps, "runs");
  const rbis = getComp(comps, "rbis") || getComp(comps, "rbi");
  const hits = getComp(comps, "hits");
  const walks = getComp(comps, "walks");

  // Track-only shell. Real PA model needs lineup slot and team run environment.
  const projection = 3.85 + runs * 0.15 + rbis * 0.08 + hits * 0.1 + walks * 0.05;

  return {
    projection: Number(projection.toFixed(3)),
    components: { runs, rbis, hits, walks },
    coverage: {
      available: [runs, rbis, hits, walks].filter(v => Number.isFinite(v) && v !== 0).length,
      possible: 4,
      tier: "LOW"
    }
  };
}

function applyFantasyProjection(row, componentIndex) {
  const market = cleanMarket(row.market || row.stat);
  const trackOnlyMarkets = new Set([
    "hitter_fantasy_score",
    "pitcher_fantasy_score",
    "pitches_thrown",
    "plate_appearances",
    "batter_strikeouts",
    "triples"
  ]);

  if (!trackOnlyMarkets.has(market)) return row;

  const comps = componentIndex.get(keyFor(row)) || {};
  const projected =
    market === "hitter_fantasy_score" ? projectHitterFantasy(comps) :
    market === "pitcher_fantasy_score" ? projectPitcherFantasy(comps) :
    market === "pitches_thrown" ? projectPitchesThrown(comps) :
    market === "plate_appearances" ? projectPlateAppearances(comps) :
    market === "batter_strikeouts" ? { projection: getComp(comps, "strikeouts"), components: { hitterStrikeouts: getComp(comps, "strikeouts") }, coverage: { available: 0, possible: 1, tier: "LOW" } } :
    market === "triples" ? { projection: getComp(comps, "triples"), components: { triples: getComp(comps, "triples") }, coverage: { available: 0, possible: 1, tier: "VERY_LOW" } } :
    { projection: null, components: {}, coverage: { available: 0, possible: 0, tier: "NONE" } };

  const line = Number(row.line);
  const fantasyEdge = Number.isFinite(line)
    ? Number((projected.projection - line).toFixed(3))
    : null;

  return {
    ...row,
    market,
    fantasyProjection: projected.projection,
    fantasyBaseProjection: projected.baseProjection ?? null,
    fantasyCorrelationBoost: projected.correlationBoost ?? 0,
    fantasyCoverageMultiplier: projected.coverageMultiplier ?? 1,
    fantasyEdge,
    fantasyProjectionComponents: projected.components,
    fantasyProjectionCoverage: projected.coverage,
    trackOnly: true,
    rankEligible: false,
    promotionEligible: false,
    playableEligible: false,
    disabledReason: `${market}_track_only_until_calibrated`
  };
}

module.exports = {
  cleanMarket,
  buildComponentIndex,
  projectHitterFantasy,
  projectPitcherFantasy,
  applyFantasyProjection
};
