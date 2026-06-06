const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const FINAL = "outputs/final-slips.json";
const PLAYABLE = "outputs/playable-final-slips.json";
const OFFICIAL = "outputs/official-slip.json";
const GOBLIN_CARD = "outputs/goblin-recommended-card.json";
const OVERRIDES = "data/manual-pitcher-risk-overrides.json";

const OUT = "outputs/rookie-pitcher-risk-audit.json";
const TXT = "outputs/rookie-pitcher-risk-audit.txt";

const STRICT = process.env.STRICT_ROOKIE_PITCHER_GUARD === "1";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    v.player ||
    v.playerName ||
    v.name ||
    v.market ||
    v.legs ||
    v.slipId ||
    v.id
  ) out.push(v);

  for (const val of Object.values(v)) flatten(val, out);
  return out;
}

function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function norm(v) {
  return s(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}
function team(r) {
  return s(r.team || r.resolvedTeam || r.rawTeam || r.abbrev);
}
function market(r) {
  return s(r.market || r.statType || r.projectionType || r.type).toLowerCase();
}
function side(r) {
  return s(r.side || r.pick || r.direction || r.recommendation).toUpperCase();
}
function line(r) {
  return n(r.line ?? r.target ?? r.value ?? r.statValue);
}
function prob(r) {
  return n(
    r.probability ??
    r.prob ??
    r.calibratedProbability ??
    r.modelProbability ??
    r.hitProbability ??
    r.winProb ??
    r.underProb ??
    r.overProb
  );
}
function projection(r) {
  return n(
    r.projection ??
    r.projected ??
    r.mean ??
    r.modelProjection ??
    r.proj ??
    r.contextAdjustedProjection ??
    r.median
  );
}
function hasHitterSignals(r) {
  const m = market(r);
  return Boolean(
    r.battingOrder ||
    r.lineupPosition ||
    r.hitterLast15Games ||
    r.hitterSeasonGames ||
    r.hitterLast15HitsPerGame ||
    r.hitterSeasonHitsPerGame ||
    r.lineupConfirmed ||
    r.confirmedLineup ||
    r.isConfirmedLineup ||
    (m === "strikeouts" && (
      r.hitterLast15KRate ||
      r.hitterLast15Games ||
      r.hitterSeasonGames ||
      r.battingOrder ||
      r.lineupPosition
    ))
  );
}

function hasPitcherSignals(r) {
  return Boolean(
    r.pitcherSeasonStarts ||
    r.starterSeasonStarts ||
    r.pitcherSeasonGames ||
    r.starterSeasonGames ||
    r.pitcherSeasonInnings ||
    r.starterSeasonInnings ||
    r.pitcherLast15Games ||
    r.pitcherLast10Games ||
    r.pitcherRollingReady ||
    r.pitcherFormReady ||
    r.probablePitcher ||
    r.pitcherHand ||
    r.pitcherArsenalReady ||
    r.pitchTypeOpponentPitcher
  );
}

function isPitcherMarket(r) {
  const m = market(r);

  // Explicit pitcher markets are always pitcher-risk eligible.
  if ([
    "pitching_outs",
    "earned_runs_allowed",
    "hits_allowed",
    "walks_allowed",
    "pitcher_fantasy_score"
  ].includes(m)) return true;

  if (/pitching|earned_runs_allowed|hits_allowed|walks_allowed|pitcher_fantasy/.test(m)) {
    return true;
  }

  // Plain "strikeouts" can be hitter strikeouts or pitcher strikeouts.
  // Only treat it as pitcher risk if the row has pitcher signals and no hitter lineup signals.
  if (m === "strikeouts" || /strikeouts/.test(m)) {
    if (hasHitterSignals(r)) return false;
    return hasPitcherSignals(r);
  }

  return false;
}
function getAnyNumber(r, names) {
  for (const k of names) {
    const x = n(r[k]);
    if (x !== null) return x;
  }
  return null;
}
function boolFalse(v) {
  return v === false || s(v).toLowerCase() === "false";
}

function sampleInfo(r) {
  const starts = getAnyNumber(r, [
    "pitcherSeasonStarts",
    "starterSeasonStarts",
    "seasonStarts",
    "mlbStarts",
    "gamesStarted",
    "pitcherGamesStarted",
    "starterGamesStarted"
  ]);

  const games = getAnyNumber(r, [
    "pitcherSeasonGames",
    "starterSeasonGames",
    "seasonGames",
    "mlbGames",
    "pitcherGames",
    "pitcherLast15Games",
    "pitcherLast10Games",
    "pitcherLast5Games",
    "starterLast15Games",
    "starterLast10Games"
  ]);

  const innings = getAnyNumber(r, [
    "pitcherSeasonInnings",
    "starterSeasonInnings",
    "seasonInnings",
    "mlbInnings",
    "inningsPitched",
    "pitcherInnings",
    "starterInnings"
  ]);

  return { starts, games, innings };
}

function overrideFor(overrides, r) {
  const key = norm(player(r));
  return overrides[key] || null;
}

function riskReasons(r, overrides) {
  const reasons = [];
  const p = player(r);
  const sample = sampleInfo(r);
  const ov = overrideFor(overrides, r);

  if (ov) {
    reasons.push(`manual_override:${ov.risk || "rookie_debut_risk"}`);
  }

  if (!p) reasons.push("missing_player");

  const sourceBlob = JSON.stringify({
    projectionSource: r.projectionSource,
    modelSource: r.modelSource,
    source: r.source,
    disabledReason: r.disabledReason,
    marketIntelligence: r.marketIntelligence
  }).toLowerCase();

  if (/fallback|default|minor|no mlb|unknown|debut|rookie/.test(sourceBlob)) {
    reasons.push("projection_source_fallback_or_unknown");
  }

  if (sample.starts === 0 || sample.games === 0) {
    reasons.push("zero_mlb_pitcher_sample");
  }

  if (sample.starts === null && sample.games === null && sample.innings === null) {
    reasons.push("missing_mlb_pitcher_sample");
  }

  if (sample.starts !== null && sample.starts < 2) {
    reasons.push("low_mlb_starts_sample");
  }

  if (sample.games !== null && sample.games < 3) {
    reasons.push("low_mlb_games_sample");
  }

  if (sample.innings !== null && sample.innings < 10) {
    reasons.push("low_mlb_innings_sample");
  }

  if (boolFalse(r.gameLogFormReady) || boolFalse(r.pitcherRollingReady) || boolFalse(r.pitcherFormReady)) {
    reasons.push("pitcher_form_not_ready");
  }

  if (r.pitchTypeNeutralFallback || r.pitchTypeFallbackApplied) {
    reasons.push("pitch_type_fallback");
  }

  if (r.disabledReason && /missing|zero|unresolved|mismatch/i.test(r.disabledReason)) {
    reasons.push(`disabled_context:${r.disabledReason}`);
  }

  return { reasons: [...new Set(reasons)], sample, override: ov };
}

function classify(r, source, overrides) {
  const pr = prob(r);
  const pj = projection(r);
  const risk = riskReasons(r, overrides);

  const highProb = pr !== null && pr >= 0.70;
  const extremeProb = pr !== null && pr >= 0.80;

  const isDerivedOutput = ["goblin_card"].includes(source);
  const hasManualOverride = risk.reasons.some(x => x.includes("manual_override"));

  const derivedMissingOnly =
    isDerivedOutput &&
    !hasManualOverride &&
    risk.reasons.length === 1 &&
    risk.reasons[0] === "missing_mlb_pitcher_sample";

  const hasHardRisk =
    risk.reasons.some(x =>
      x.includes("manual_override") ||
      x === "zero_mlb_pitcher_sample" ||
      x === "missing_mlb_pitcher_sample" ||
      x === "projection_source_fallback_or_unknown"
    );

  const hasSoftRisk =
    risk.reasons.some(x =>
      x === "low_mlb_starts_sample" ||
      x === "low_mlb_games_sample" ||
      x === "low_mlb_innings_sample" ||
      x === "pitcher_form_not_ready" ||
      x === "pitch_type_fallback"
    );

  let riskStatus = "OK";
  let recommendedAction = "ALLOW";

  if (derivedMissingOnly) {
    riskStatus = "RESEARCH_ONLY";
    recommendedAction = "DERIVED_OUTPUT_SAMPLE_NOT_CARRIED";
  } else if (hasHardRisk && highProb) {
    riskStatus = "HARD_BLOCK";
    recommendedAction = "BLOCK_FROM_OFFICIAL_AND_PLAYABLE";
  } else if (hasHardRisk || (hasSoftRisk && extremeProb)) {
    riskStatus = "RESEARCH_ONLY";
    recommendedAction = "CAP_OR_RESEARCH_ONLY";
  } else if (hasSoftRisk) {
    riskStatus = "WATCHLIST";
    recommendedAction = "DOWNGRADE";
  }

  return {
    source,
    player: player(r),
    team: team(r),
    market: market(r),
    side: side(r) || null,
    line: line(r),
    projection: pj,
    probability: pr,
    oddsTier: r.oddsTier || r.tier || null,
    playability: r.playability || r.bridgeStatus || r.lessWatchStatus || null,
    riskStatus,
    recommendedAction,
    reasons: risk.reasons,
    sample: risk.sample,
    manualOverride: risk.override || null
  };
}

fs.mkdirSync("data", { recursive: true });
if (!fs.existsSync(OVERRIDES)) {
  fs.writeFileSync(OVERRIDES, JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Manual pitcher risk overrides. Use for MLB debut, first MLB start, opener, unknown workload, or minor-league-only projection risk.",
    players: {
      "kademorris": {
        player: "Kade Morris",
        risk: "first_mlb_start_or_unknown_mlb_sample",
        action: "research_only",
        reason: "Do not allow high-prob pitcher props into official slips without MLB starter sample validation."
      }
    }
  }, null, 2));
}

const rawOverrides = readJson(OVERRIDES, {});
const overrides = rawOverrides.players || {};

const sources = [
  ["board", flatten(readJson(BOARD, []))],
  ["final", flatten(readJson(FINAL, []))],
  ["playable", flatten(readJson(PLAYABLE, []))],
  ["official", flatten(readJson(OFFICIAL, []))],
  ["goblin_card", flatten(readJson(GOBLIN_CARD, []))]
];

const all = [];
for (const [source, rows] of sources) {
  for (const r of rows) {
    if (!isPitcherMarket(r)) continue;
    const row = classify(r, source, overrides);
    if (row.riskStatus !== "OK") all.push(row);
  }
}

const byStatus = {};
const bySource = {};
for (const r of all) {
  byStatus[r.riskStatus] = (byStatus[r.riskStatus] || 0) + 1;
  bySource[r.source] = (bySource[r.source] || 0) + 1;
}

const officialBlocks = all.filter(r =>
  ["official", "playable"].includes(r.source) &&
  r.riskStatus === "HARD_BLOCK"
);

const summary = {
  generatedAt: new Date().toISOString(),
  mode: STRICT ? "strict_guard" : "audit_only",
  files: { BOARD, FINAL, PLAYABLE, OFFICIAL, GOBLIN_CARD, OVERRIDES },
  totals: {
    riskRows: all.length,
    hardBlocks: all.filter(x => x.riskStatus === "HARD_BLOCK").length,
    researchOnly: all.filter(x => x.riskStatus === "RESEARCH_ONLY").length,
    watchlist: all.filter(x => x.riskStatus === "WATCHLIST").length,
    officialPlayableHardBlocks: officialBlocks.length
  },
  byStatus,
  bySource,
  riskRows: all
};

const lines = [];
lines.push("ROOKIE / DEBUT PITCHER RISK AUDIT");
lines.push("==================================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  mode: summary.mode,
  totals: summary.totals,
  byStatus: summary.byStatus,
  bySource: summary.bySource,
  overrides: OVERRIDES
}, null, 2));

lines.push("");
lines.push("RISK ROWS");
lines.push("---------");
if (!all.length) {
  lines.push("No rookie/debut/unknown-sample pitcher risk rows found.");
} else {
  all.slice(0, 120).forEach((x, i) => {
    lines.push(`${i + 1}. [${x.source}] ${x.player} | ${x.team || "?"} | ${x.market} ${x.side || ""} ${x.line ?? "?"} | prob=${x.probability ?? "?"} | proj=${x.projection ?? "?"} | ${x.riskStatus} | action=${x.recommendedAction}`);
    lines.push(`   reasons=${x.reasons.join(", ") || "none"} | sample=${JSON.stringify(x.sample)}`);
  });
}

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  mode: summary.mode,
  totals: summary.totals,
  byStatus: summary.byStatus,
  officialPlayableHardBlocks: officialBlocks.map(x => ({
    source: x.source,
    player: x.player,
    market: x.market,
    side: x.side,
    line: x.line,
    probability: x.probability,
    reasons: x.reasons
  }))
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);

if (STRICT && officialBlocks.length) {
  console.error("ROOKIE/DEBUT PITCHER GUARD FAILED: official/playable output contains hard-block pitcher risk.");
  process.exit(1);
}
