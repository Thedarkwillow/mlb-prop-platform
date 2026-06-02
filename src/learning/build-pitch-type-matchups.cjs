const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const ARSENAL = "data/savant/pitcher-arsenal-compact.json";
const HANDS = "data/context/probable-pitcher-hands.json";
const SAVANT = "data/savant-latest.json";
const OUT = "data/savant/pitch-type-matchups.json";

const HITTER_MARKETS = new Set([
  "hits",
  "strikeouts",
  "bases",
  "hrr",
  "runs",
  "rbis",
  "hr",
  "home_runs",
  "singles",
  "doubles",
  "walks",
  "stolen_bases",
  "hitter_fantasy_score"
]);

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function market(row) {
  return String(row.market || row.stat || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function side(row) {
  return String(row.recommendedSide || row.side || "").toUpperCase();
}

function isHitterMarket(row) {
  const m = market(row);
  return HITTER_MARKETS.has(m) || HITTER_MARKETS.has(m.replace("home_runs", "hr"));
}
function isLikelyPitcherRow(row) {
  const m = market(row);
  const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || "").toLowerCase();
  const position = String(row.position || row.playerPosition || "").toUpperCase();
  if (sourceType === "pitcher" || position === "P") return true;
  return (
    m.includes("pitching") ||
    m.includes("outs") ||
    m.includes("earned_runs_allowed") ||
    m.includes("hits_allowed") ||
    m.includes("walks_allowed") ||
    m.includes("pitches_thrown") ||
    m.includes("pitcher_fantasy")
  );
}

function team(row) {
  return String(row.resolvedTeam || row.team || "").toUpperCase().trim();
}

function opponentPitcherFromRow(row, probable) {
  const teamKey = team(row);

  // Prefer current slate probable pitcher context over board-row pitcher fields.
  // Board rows can hold stale opponentPitcher values from an older snapshot.
  const directProbable = probable.opponentPitcherByTeam?.[teamKey] || null;
  if (directProbable?.pitcher) {
    return {
      pitcher: directProbable.pitcher,
      hand: directProbable.hand || directProbable.pitcherHand || directProbable.opponentPitcherHand || null,
      opponent: directProbable.opponent || directProbable.opponentTeam || null,
      gamePk: directProbable.gamePk || null,
      source: "probable_pitcher_hands"
    };
  }

  for (const g of Object.values(probable.games || {})) {
    if (g.awayTeam === teamKey && g.homeProbablePitcher) {
      return {
        pitcher: g.homeProbablePitcher,
        hand: g.homePitcherHand || null,
        opponent: g.homeTeam || null,
        gamePk: g.gamePk || null,
        source: "probable_pitcher_hands_game"
      };
    }

    if (g.homeTeam === teamKey && g.awayProbablePitcher) {
      return {
        pitcher: g.awayProbablePitcher,
        hand: g.awayPitcherHand || null,
        opponent: g.awayTeam || null,
        gamePk: g.gamePk || null,
        source: "probable_pitcher_hands_game"
      };
    }
  }

  const fromBoard =
    row.opposingPitcher ||
    row.opponentPitcher ||
    row.probablePitcher ||
    row.handednessContext?.opposingPitcher ||
    row.handednessAdjustment?.opposingPitcher ||
    row.pitchTypeOpponentPitcher ||
    row.starter ||
    row.opponentStarter ||
    null;

  if (fromBoard) {
    return {
      pitcher: fromBoard,
      hand:
        row.opposingPitcherHand ||
        row.pitcherHand ||
        row.handednessContext?.opposingPitcherHand ||
        row.handednessAdjustment?.opposingPitcherHand ||
        null,
      opponent: row.opponent || row.opponentTeam || null,
      source: "board_row_fallback"
    };
  }

  return null;
}

function buildHitterIndex(rows) {
  const idx = {};

  for (const r of rows) {
    if (r?.recordType !== "savant_player") continue;
    if (String(r.playerType || "").toLowerCase() !== "batter") continue;

    idx[norm(r.player)] = {
      player: r.player,
      pa: Number(r.pa || 0),
      xwoba: Number(r.xwoba || 0),
      xslg: Number(r.xslg || 0),
      xba: Number(r.xba || 0),
      barrelRate: Number(r.barrelRate || 0),
      hardHitRate: Number(r.hardHitRate || 0),
      whiffRate: Number(r.whiffRate || 0),
      kRate: Number(r.kRate || 0),
      avgExitVelocity: Number(r.avgExitVelocity || 0)
    };
  }

  return idx;
}

function topPitchTypes(pitcherRec) {
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizePitchArray(v) {
    if (!v) return [];

    let arr = [];

    if (Array.isArray(v)) {
      arr = v;
    } else if (typeof v === "object") {
      arr = Object.entries(v).map(([pitchType, rec]) => ({
        pitchType,
        ...(rec && typeof rec === "object" ? rec : {})
      }));
    }

    return arr
      .map((r, i) => ({
        pitchType:
          r.pitchType ||
          r.type ||
          r.code ||
          r.name ||
          r.pitch ||
          `P${i + 1}`,
        usage: num(
          r.usage ??
          r.pitchPercent ??
          r.pitch_pct ??
          r.pitchPct ??
          r.percent ??
          r.pct
        ),
        velocity: num(
          r.velocity ??
          r.velo ??
          r.avgVelocity ??
          r.avgVelo
        ),
        whiffRate: num(
          r.whiffRate ??
          r.whiff ??
          r.whiff_pct ??
          r.whiffPct
        ),
        xwoba: num(
          r.xwoba ??
          r.xwOBA ??
          r.expectedWoba
        ),
        xslg: num(
          r.xslg ??
          r.xSLG ??
          r.expectedSlg
        ),
        hardHitRate: num(
          r.hardHitRate ??
          r.hardHit ??
          r.hard_hit_pct ??
          r.hardHitPct
        ),
        runValuePer100: num(
          r.runValuePer100 ??
          r.rv100 ??
          r.run_value_per_100 ??
          r.runValue
        ),
        pitches: num(
          r.pitches ??
          r.count ??
          r.n ??
          r.total ??
          1
        )
      }))
      .filter(r => r.pitchType && (r.pitches > 0 || r.usage > 0))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5);
  }

  const candidates = [
    pitcherRec?.windows?.season?.pitchTypes,
    pitcherRec?.season?.pitchTypes,
    pitcherRec?.pitchTypes,
    pitcherRec?.primaryPitches,
    pitcherRec?.pitches,
    pitcherRec?.arsenal
  ];

  for (const c of candidates) {
    const out = normalizePitchArray(c);
    if (out.length) return out;
  }

  return [];
}

function scoreMatchup(hitter, pitcherRec) {
  const pitchTypes = topPitchTypes(pitcherRec);

  if (!hitter || !pitchTypes.length) {
    const flags = [];
    if (!hitter) flags.push("MISSING_HITTER_PROFILE");
    if (!pitchTypes.length) flags.push("MISSING_PITCHER_ARSENAL");
    return {
      matched: false,
      score: 0,
      tier: "unknown",
      flags,
      missingHitterProfile: !hitter,
      missingPitcherArsenal: !pitchTypes.length,
      pitchTypes
    };
  }

  let score = 0;
  const flags = [];

  const hitterPower =
    (hitter.xwoba >= 0.380 ? 1 : 0) +
    (hitter.xslg >= 0.500 ? 1 : 0) +
    (hitter.barrelRate >= 12 ? 1 : 0) +
    (hitter.hardHitRate >= 48 ? 1 : 0);

  const hitterRisk =
    (hitter.whiffRate >= 30 ? 1 : 0) +
    (hitter.kRate >= 27 ? 1 : 0);

  if (hitterPower >= 3) {
    score += 2;
    flags.push("HITTER_POWER_PROFILE");
  } else if (hitterPower >= 2) {
    score += 1;
    flags.push("HITTER_SOLID_CONTACT_PROFILE");
  }

  if (hitterRisk >= 2) {
    score -= 1;
    flags.push("HITTER_SWING_MISS_RISK");
  }

  for (const p of pitchTypes) {
    const weight = Math.min(1, Math.max(0, p.usage / 40));

    if (p.xwoba >= 0.380) {
      score += 1.5 * weight;
      flags.push(`PITCH_${p.pitchType}_DAMAGE_ALLOWED`);
    }

    if (p.xslg >= 0.500) {
      score += 1.25 * weight;
      flags.push(`PITCH_${p.pitchType}_POWER_ALLOWED`);
    }

    if (p.hardHitRate >= 45) {
      score += 1 * weight;
      flags.push(`PITCH_${p.pitchType}_HARD_HIT_ALLOWED`);
    }

    if (p.whiffRate >= 32 && hitter.whiffRate >= 28) {
      score -= 1.25 * weight;
      flags.push(`PITCH_${p.pitchType}_WHIFF_THREAT`);
    }

    if (p.velocity >= 96 && hitter.whiffRate >= 30) {
      score -= 0.75 * weight;
      flags.push(`HIGH_VELO_SWING_MISS_RISK`);
    }
  }

  const rounded = Number(score.toFixed(3));

  const tier =
    rounded >= 3 ? "strong_boost" :
    rounded >= 1.25 ? "boost" :
    rounded <= -2 ? "strong_downgrade" :
    rounded <= -0.75 ? "downgrade" :
    "neutral";

  return {
    matched: true,
    score: rounded,
    tier,
    hitterProfile: {
      pa: hitter.pa,
      xwoba: hitter.xwoba,
      xslg: hitter.xslg,
      xba: hitter.xba,
      barrelRate: hitter.barrelRate,
      hardHitRate: hitter.hardHitRate,
      whiffRate: hitter.whiffRate,
      kRate: hitter.kRate,
      avgExitVelocity: hitter.avgExitVelocity
    },
    pitcherTrend: {
      baselineFastballVelo: pitcherRec.baselineFastballVelo,
      currentFastballVelo: pitcherRec.currentFastballVelo,
      velocityDelta: pitcherRec.velocityDelta,
      trend: pitcherRec.trend
    },
    pitchTypes,
    flags: [...new Set(flags)]
  };
}

const board = read(BOARD, []);
const arsenal = read(ARSENAL, { pitchers: {} });
const probable = read(HANDS, {});
const savantRows = read(SAVANT, []);

const hitters = buildHitterIndex(Array.isArray(savantRows) ? savantRows : savantRows.rows || []);
function collectPitcherArsenalMap(src) {
  const map = {};

  function normName(v) {
    return norm(v);
  }

  function identity(rec, fallbackKey = null) {
    return (
      rec?.pitcher ||
      rec?.player ||
      rec?.name ||
      rec?.fullName ||
      rec?.pitcherName ||
      fallbackKey ||
      null
    );
  }

  function addRecord(rec, fallbackKey = null) {
    if (!rec || typeof rec !== "object") return;

    const name = identity(rec, fallbackKey);
    const key = normName(name);
    if (!key) return;

    const hasPitchTypes = topPitchTypes(rec).length > 0;
    if (!hasPitchTypes) return;

    if (!map[key] || topPitchTypes(map[key]).length === 0) {
      map[key] = {
        ...rec,
        pitcher: rec.pitcher || rec.player || rec.name || rec.fullName || rec.pitcherName || name
      };
    }
  }

  function walk(v, fallbackKey = null) {
    if (!v) return;

    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }

    if (typeof v !== "object") return;

    addRecord(v, fallbackKey);

    for (const [key, value] of Object.entries(v)) {
      if (Array.isArray(value) || (value && typeof value === "object")) {
        walk(value, key);
      }
    }
  }

  if (src.pitchers && typeof src.pitchers === "object" && !Array.isArray(src.pitchers)) {
    for (const [key, rec] of Object.entries(src.pitchers)) {
      addRecord(rec, key);
    }
  }

  walk(src);

  return map;
}

const pitcherArsenal = collectPitcherArsenalMap(arsenal);

const props = board.filter(r => r.recordType === "merged_prop");
const matchups = {};
const rows = [];

for (const r of props) {
  if (isLikelyPitcherRow(r)) continue;
  if (!isHitterMarket(r)) continue;

  const t = team(r);
  const opp = opponentPitcherFromRow(r, probable);
  if (!opp?.pitcher) continue;

  const hitter = hitters[norm(r.player)];
  const pitcherRec = pitcherArsenal[norm(opp.pitcher)];
  const result = scoreMatchup(hitter, pitcherRec);

  const key = `${norm(r.player)}__${norm(opp.pitcher)}`;

  if (!matchups[key]) {
    matchups[key] = {
      key,
      player: r.player,
      team: t,
      market: market(r),
      side: side(r),
      opponentPitcher: opp.pitcher,
      opponentPitcherHand: opp.hand || null,
      opponent: opp.opponent || null,
      pitcherSource: opp.source || null,
      missingHitterProfile: result.missingHitterProfile || false,
      missingPitcherArsenal: result.missingPitcherArsenal || false,
      ...result
    };
  }

  rows.push({
    player: r.player,
    team: t,
    market: market(r),
    side: side(r),
    opponentPitcher: opp.pitcher,
    pitcherSource: opp.source || null,
    tier: result.tier,
    score: result.score,
    matched: result.matched
  });
}

const byTier = rows.reduce((a, r) => {
  a[r.tier] = (a[r.tier] || 0) + 1;
  return a;
}, {});

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: [BOARD, ARSENAL, HANDS, SAVANT].filter(fs.existsSync),
  note: "Pitch-type matchup report only. No probability movement applied yet.",
  totalBoardProps: props.length,
  hitterMarketRows: rows.length,
  uniqueMatchups: Object.keys(matchups).length,
  matched: Object.values(matchups).filter(m => m.matched).length,
  byTier,
  matchups
};

fs.mkdirSync("data/savant", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("PITCH-TYPE MATCHUP ENGINE");
console.log("=========================");
console.log(`Hitter market rows: ${rows.length}`);
console.log(`Unique matchups: ${out.uniqueMatchups}`);
console.log(`Matched: ${out.matched}`);
console.log(`Wrote ${OUT}`);

console.log("\nBy tier:");
console.table(Object.entries(byTier).map(([tier, count]) => ({ tier, count })));

console.log("\nTop boost examples:");
console.table(
  Object.values(matchups)
    .filter(m => ["strong_boost", "boost"].includes(m.tier))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(m => ({
      player: m.player,
      team: m.team,
      pitcher: m.opponentPitcher,
      score: m.score,
      tier: m.tier,
      xwoba: m.hitterProfile?.xwoba,
      xslg: m.hitterProfile?.xslg,
      topPitches: (m.pitchTypes || []).slice(0, 3).map(p => `${p.pitchType}:${p.usage}%`).join(", "),
      flags: (m.flags || []).slice(0, 3).join(",")
    }))
);

console.log("\nTop downgrade examples:");
console.table(
  Object.values(matchups)
    .filter(m => ["strong_downgrade", "downgrade"].includes(m.tier))
    .sort((a, b) => a.score - b.score)
    .slice(0, 12)
    .map(m => ({
      player: m.player,
      team: m.team,
      pitcher: m.opponentPitcher,
      score: m.score,
      tier: m.tier,
      whiff: m.hitterProfile?.whiffRate,
      kRate: m.hitterProfile?.kRate,
      topPitches: (m.pitchTypes || []).slice(0, 3).map(p => `${p.pitchType}:${p.usage}%`).join(", "),
      flags: (m.flags || []).slice(0, 3).join(",")
    }))
);
