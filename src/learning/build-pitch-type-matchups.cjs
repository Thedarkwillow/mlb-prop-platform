const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const ARSENAL = "data/savant/pitcher-arsenal-compact.json";
const HANDS = "data/context/probable-pitcher-hands.json";
const SAVANT = "data/savant-latest.json";
const OUT = "data/savant/pitch-type-matchups.json";

const HITTER_MARKETS = new Set([
  "hits",
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

function team(row) {
  return String(row.resolvedTeam || row.team || "").toUpperCase().trim();
}

function opponentPitcherFromRow(row, probable) {
  const teamKey = team(row);
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
      source: "board_row"
    };
  }

  const fromProbable = probable.opponentPitcherByTeam?.[teamKey] || null;
  if (fromProbable?.pitcher) {
    return {
      ...fromProbable,
      source: "probable_pitcher_hands"
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
  const types = pitcherRec?.windows?.season?.pitchTypes || {};
  return Object.entries(types)
    .map(([pitchType, r]) => ({
      pitchType,
      usage: Number(r.pitchPercent || 0),
      velocity: Number(r.velocity || 0),
      whiffRate: Number(r.whiffRate || 0),
      xwoba: Number(r.xwoba || 0),
      xslg: Number(r.xslg || 0),
      hardHitRate: Number(r.hardHitRate || 0),
      runValuePer100: Number(r.runValuePer100 || 0),
      pitches: Number(r.pitches || 0)
    }))
    .filter(r => r.pitches > 0)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 5);
}

function scoreMatchup(hitter, pitcherRec) {
  const pitchTypes = topPitchTypes(pitcherRec);

  if (!hitter || !pitchTypes.length) {
    return {
      matched: false,
      score: 0,
      tier: "unknown",
      flags: ["MISSING_HITTER_OR_PITCHER_ARSENAL"],
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

  function addRecord(rec) {
    if (!rec || typeof rec !== "object") return;

    const name =
      rec.pitcher ||
      rec.player ||
      rec.name ||
      rec.fullName ||
      rec.pitcherName ||
      null;

    const key = normName(name);
    if (!key) return;

    const hasPitchTypes =
      rec.windows?.season?.pitchTypes ||
      rec.season?.pitchTypes ||
      rec.pitchTypes;

    if (!hasPitchTypes) return;

    map[key] = rec;
  }

  function walk(v) {
    if (!v) return;

    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }

    if (typeof v !== "object") return;

    addRecord(v);

    for (const value of Object.values(v)) {
      if (Array.isArray(value) || (value && typeof value === "object")) {
        walk(value);
      }
    }
  }

  if (src.pitchers && typeof src.pitchers === "object" && !Array.isArray(src.pitchers)) {
    for (const [key, rec] of Object.entries(src.pitchers)) {
      if (rec && typeof rec === "object") {
        map[normName(rec.pitcher || rec.player || rec.name || key)] = rec;
      }
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
