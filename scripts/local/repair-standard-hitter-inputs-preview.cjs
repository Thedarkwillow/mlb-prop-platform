const fs = require("fs");

const BOARD = process.env.BOARD || "outputs/priced-board.json";
const OUT = "outputs/standard-hitter-input-repair-preview.json";
const TXT = "outputs/standard-hitter-input-repair-preview.txt";
const OVERRIDE_OUT = "outputs/standard-hitter-team-override-suggestions.json";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function rows(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.rows)) return v.rows;
  if (v && Array.isArray(v.props)) return v.props;
  if (v && Array.isArray(v.projections)) return v.projections;
  return [];
}

function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function market(r) {
  return s(r.market || r.statType || r.projectionType || r.type).toLowerCase();
}
function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}
function team(r) {
  return s(r.team || r.resolvedTeam || r.rawTeam || r.abbrev);
}
function tier(r) {
  return s(r.tier || r.oddsTier || r.projectionTier || r.payoutType || "standard").toLowerCase();
}
function disabled(r) {
  return s(r.disabledReason || r.reason || r.blockReason || r.excludedReason || r.rejectReason);
}
function line(r) {
  return n(r.line ?? r.target ?? r.value ?? r.statValue);
}
function projection(r) {
  return n(r.projection ?? r.projected ?? r.mean ?? r.modelProjection ?? r.proj ?? r.median);
}
function confirmed(r) {
  return Boolean(r.lineupConfirmed ?? r.confirmedLineup ?? r.isConfirmedLineup);
}
function isStandard(r) {
  return !/goblin|demon/.test(tier(r));
}
function isHitter(r) {
  const m = market(r);
  if (!m) return false;
  if (/allowed|pitch|strikeout|earned/.test(m)) return false;
  return /hitter|fantasy|hrr|hit|base|single|double|run|rbi|walk/.test(m);
}
function isFantasy(r) {
  return /fantasy/.test(market(r));
}
function firstNumber(...vals) {
  for (const v of vals) {
    const x = n(v);
    if (x !== null && x > 0) return x;
  }
  return null;
}
function fallbackProjection(r) {
  const m = market(r);

  if (m === "hrr") {
    return {
      value: firstNumber(
        r.contextAdjustedProjection,
        r.hitterLast15HrrPerGame,
        r.hitterSeasonHrrPerGame,
        r.lineupAvgHRR
      ),
      source: "hrr_fallback_context_last15_season_lineup"
    };
  }

  if (m === "hits") {
    return {
      value: firstNumber(
        r.contextAdjustedProjection,
        r.hitterLast15HitsPerGame,
        r.hitterSeasonHitsPerGame,
        r.lineupAvgHits
      ),
      source: "hits_fallback_context_last15_season_lineup"
    };
  }

  if (m === "bases") {
    return {
      value: firstNumber(
        r.contextAdjustedProjection,
        r.hitterLast15TotalBasesPerGame,
        r.hitterSeasonTotalBasesPerGame,
        r.lineupAvgTB
      ),
      source: "bases_fallback_context_last15_season_lineup"
    };
  }

  if (m === "runs") {
    return {
      value: firstNumber(
        r.contextAdjustedProjection,
        r.hitterLast15RunsPerGame
      ),
      source: "runs_fallback_context_last15"
    };
  }

  if (m === "rbis" || m === "rbi") {
    return {
      value: firstNumber(
        r.contextAdjustedProjection,
        r.hitterLast15RbisPerGame
      ),
      source: "rbis_fallback_context_last15"
    };
  }

  if (m === "walks") {
    return {
      value: firstNumber(
        r.contextAdjustedProjection,
        r.hitterLast15WalkRate
      ),
      source: "walks_fallback_context_last15"
    };
  }

  if (m === "singles") {
    const hits = firstNumber(r.hitterLast15HitsPerGame, r.hitterSeasonHitsPerGame);
    const tb = firstNumber(r.hitterLast15TotalBasesPerGame, r.hitterSeasonTotalBasesPerGame);
    if (hits !== null && tb !== null) {
      // Conservative singles proxy: cannot know doubles/triples/HR directly here, so cap below hits.
      return {
        value: Math.max(0, Math.min(hits, hits - Math.max(0, tb - hits) * 0.35)),
        source: "singles_conservative_hits_tb_proxy"
      };
    }
    return {
      value: firstNumber(r.contextAdjustedProjection),
      source: "singles_context_only"
    };
  }

  return {
    value: firstNumber(r.contextAdjustedProjection),
    source: "generic_context_adjusted_projection"
  };
}

const board = rows(readJson(BOARD, []));
const standardHitters = board.filter(r => isStandard(r) && isHitter(r));

const missingProjection = [];
const repairedProjection = [];
const unrepairedProjection = [];
const teamMismatches = [];
const comboSkips = [];

for (const r of standardHitters) {
  const d = disabled(r);
  const p = projection(r);
  const m = market(r);

  if (isFantasy(r) && /fantasy scale not verified/i.test(d)) continue;

  if (/combo player team resolver skip/i.test(d)) {
    comboSkips.push({
      player: player(r),
      team: team(r),
      market: m,
      line: line(r),
      disabledReason: d,
      note: "combo props should stay out of standard hitter bridge until combo identity logic is built"
    });
    continue;
  }

  if (/player\/team unresolved|mismatch/i.test(d)) {
    teamMismatches.push({
      player: player(r),
      observedTeam: team(r),
      market: m,
      line: line(r),
      disabledReason: d,
      suggestedOverride: {
        player: player(r),
        team: team(r),
        reason: d
      }
    });
    continue;
  }

  if (/missing_or_zero_projection/i.test(d) || p === null || p === 0) {
    missingProjection.push(r);
    const fb = fallbackProjection(r);
    const ln = line(r);
    const usable = fb.value !== null && fb.value > 0 && ln !== null;

    const item = {
      player: player(r),
      team: team(r),
      market: m,
      line: ln,
      currentProjection: p,
      fallbackProjection: fb.value,
      fallbackSource: fb.source,
      lineupConfirmed: confirmed(r),
      battingOrder: n(r.battingOrder),
      disabledReason: d || null,
      repairStatus: usable ? "REPAIR_CANDIDATE" : "NO_SAFE_FALLBACK"
    };

    if (usable) repairedProjection.push(item);
    else unrepairedProjection.push(item);
  }
}

repairedProjection.sort((a, b) =>
  Number(b.lineupConfirmed) - Number(a.lineupConfirmed) ||
  (a.battingOrder || 99) - (b.battingOrder || 99)
);

const overrides = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  mode: "suggestions_only_not_applied",
  teamOverrides: teamMismatches.map(x => x.suggestedOverride)
};

const summary = {
  generatedAt: new Date().toISOString(),
  source: BOARD,
  mode: "read_only_standard_hitter_input_repair_preview",
  livePickGenerationChanged: false,
  totals: {
    boardRows: board.length,
    standardHitterRows: standardHitters.length,
    missingProjectionRows: missingProjection.length,
    repairedProjectionCandidates: repairedProjection.length,
    unrepairedProjectionRows: unrepairedProjection.length,
    teamMismatchRows: teamMismatches.length,
    comboResolverSkipRows: comboSkips.length
  },
  repairedProjectionCandidates: repairedProjection,
  unrepairedProjectionRows: unrepairedProjection,
  teamMismatches,
  comboSkips,
  suggestedOverridesFile: OVERRIDE_OUT
};

const lines = [];
lines.push("STANDARD HITTER INPUT REPAIR PREVIEW");
lines.push("====================================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  mode: summary.mode,
  livePickGenerationChanged: summary.livePickGenerationChanged,
  totals: summary.totals,
  suggestedOverridesFile: summary.suggestedOverridesFile
}, null, 2));

lines.push("");
lines.push("REPAIR CANDIDATES FOR MISSING PROJECTION");
lines.push("----------------------------------------");
if (!repairedProjection.length) lines.push("No safe fallback projection candidates found.");
repairedProjection.slice(0, 80).forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.line} | fallback=${x.fallbackProjection} | source=${x.fallbackSource} | order=${x.battingOrder ?? "?"} | lineup=${x.lineupConfirmed ? "confirmed" : "not_confirmed"} | disabled=${x.disabledReason || "none"}`);
});

lines.push("");
lines.push("UNREPAIRED MISSING PROJECTION ROWS");
lines.push("----------------------------------");
unrepairedProjection.slice(0, 50).forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.line} | fallback=${x.fallbackProjection ?? "?"} | source=${x.fallbackSource} | disabled=${x.disabledReason || "none"}`);
});

lines.push("");
lines.push("TEAM MISMATCH / OVERRIDE SUGGESTIONS");
lines.push("------------------------------------");
if (!teamMismatches.length) lines.push("No team mismatch rows.");
teamMismatches.forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | observedTeam=${x.observedTeam} | ${x.market} ${x.line} | disabled=${x.disabledReason}`);
});

lines.push("");
lines.push("COMBO RESOLVER SKIPS");
lines.push("--------------------");
if (!comboSkips.length) lines.push("No combo resolver skips.");
comboSkips.forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.line} | ${x.note}`);
});

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n"));
fs.writeFileSync(OVERRIDE_OUT, JSON.stringify(overrides, null, 2));

console.log({
  generatedAt: summary.generatedAt,
  totals: summary.totals,
  topRepairCandidates: repairedProjection.slice(0, 10)
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
console.log(`saved: ${OVERRIDE_OUT}`);
