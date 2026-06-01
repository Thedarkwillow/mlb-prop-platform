const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const MATCHUPS = "data/savant/pitch-type-matchups.json";
const ARSENAL = "data/savant/pitcher-arsenal-compact.json";
const PROBABLE = "data/context/probable-pitcher-hands.json";
const SAVANT = "data/savant-latest.json";

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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

function team(row) {
  return String(row.resolvedTeam || row.team || row.playerTeam || row.teamAbbrev || "")
    .toUpperCase()
    .trim();
}

function gameTeams(row) {
  const raw = String(row.resolvedGame || row.game || "")
    .replace(/\s+at\s+/gi, " @ ")
    .trim();

  if (!raw.includes("@")) return [];
  return raw.split("@").map(x => x.toUpperCase().trim()).filter(Boolean);
}

function inferOpponentTeam(row) {
  const t = team(row);
  const explicit = String(row.opponent || row.opponentTeam || row.resolvedOpponent || "")
    .toUpperCase()
    .trim();

  if (explicit) return explicit;

  const parts = gameTeams(row);
  if (parts.length !== 2 || !t) return "";

  if (parts[0] === t) return parts[1];
  if (parts[1] === t) return parts[0];

  return "";
}

function topPitchTypes(rec) {
  if (!rec || typeof rec !== "object") return [];

  function normalize(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "object") {
      return Object.entries(v).map(([pitchType, x]) => ({
        pitchType,
        ...(x && typeof x === "object" ? x : {})
      }));
    }
    return [];
  }

  const candidates = [
    rec?.windows?.season?.pitchTypes,
    rec?.season?.pitchTypes,
    rec?.pitchTypes,
    rec?.primaryPitches,
    rec?.pitches,
    rec?.arsenal
  ];

  for (const c of candidates) {
    const arr = normalize(c)
      .filter(x => x && typeof x === "object")
      .filter(x => x.pitchType || x.type || x.code || x.name || x.pitch);
    if (arr.length) return arr;
  }

  return [];
}

function collectArsenalRecords(src) {
  const out = [];
  const seenObjects = new Set();

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

  function hasPitchData(rec) {
    return topPitchTypes(rec).length > 0;
  }

  function walk(v, fallbackKey = null) {
    if (!v) return;

    if (Array.isArray(v)) {
      for (const x of v) walk(x, fallbackKey);
      return;
    }

    if (typeof v !== "object") return;
    if (seenObjects.has(v)) return;
    seenObjects.add(v);

    const name = identity(v, fallbackKey);

    if (name && hasPitchData(v)) {
      out.push({
        name,
        rec: {
          ...v,
          pitcher: v.pitcher || v.player || v.name || v.fullName || v.pitcherName || name
        }
      });
    }

    for (const [key, value] of Object.entries(v)) {
      if (value && typeof value === "object") {
        walk(value, key);
      }
    }
  }

  walk(src);

  const byName = new Map();
  for (const x of out) {
    const key = norm(x.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, x.rec);
  }

  return byName;
}

function isExplicitPitcherMarket(row, arsenalByName) {
  const m = market(row);
  const sourceType = String(row.sourceType || row.playerType || row.recordSourceType || "")
    .toLowerCase()
    .trim();
  const position = String(row.position || row.playerPosition || "")
    .toUpperCase()
    .trim();

  // Explicit pitcher markets must win over dirty PrizePicks sourceType.
  // Plain "strikeouts" is intentionally handled separately because it can be hitter Ks or pitcher Ks.
  if (
    m.includes("pitching") ||
    m.includes("outs") ||
    m.includes("earned_runs_allowed") ||
    m.includes("hits_allowed") ||
    m.includes("walks_allowed") ||
    m.includes("pitches_thrown") ||
    m.includes("pitcher_fantasy") ||
    m.includes("1st_inning_runs_allowed")
  ) {
    return true;
  }

  if (sourceType === "pitcher" || position === "P") return true;
  if (sourceType === "batter" || sourceType === "hitter") return false;

  if (m === "strikeouts") {
    return arsenalByName.has(norm(row.player));
  }

  return false;
}

const HITTER_MARKETS = new Set([
  "hits",
  "strikeouts",
  "bases",
  "hrr",
  "runs",
  "rbis",
  "rbi",
  "hr",
  "home_runs",
  "singles",
  "doubles",
  "walks",
  "stolen_bases",
  "hitter_fantasy_score"
]);

function isHitterMarket(row, arsenalByName) {
  if (isExplicitPitcherMarket(row, arsenalByName)) return false;
  const m = market(row);
  return HITTER_MARKETS.has(m) || HITTER_MARKETS.has(m.replace("home_runs", "hr"));
}

function opponentPitcherFromRow(row, probable) {
  const direct =
    row.pitchTypeOpponentPitcher ||
    row.opposingPitcher ||
    row.opponentPitcher ||
    row.probablePitcher ||
    row.handednessContext?.opposingPitcher ||
    row.handednessAdjustment?.opposingPitcher ||
    row.starter ||
    row.opponentStarter ||
    null;

  if (direct) {
    return {
      pitcher: direct,
      source: "board_row",
      hand:
        row.opposingPitcherHand ||
        row.pitcherHand ||
        row.handednessContext?.opposingPitcherHand ||
        row.handednessAdjustment?.opposingPitcherHand ||
        null
    };
  }

  const t = team(row);
  const byTeam = probable?.opponentPitcherByTeam?.[t];

  if (byTeam?.pitcher) {
    return {
      pitcher: byTeam.pitcher,
      hand: byTeam.hand || null,
      source: "probable_pitcher_hands"
    };
  }

  const opp = inferOpponentTeam(row);
  const byOpponent =
    probable?.pitcherByTeam?.[opp] ||
    probable?.teamPitcherByTeam?.[opp] ||
    null;

  if (byOpponent?.pitcher) {
    return {
      pitcher: byOpponent.pitcher,
      hand: byOpponent.hand || null,
      source: "probable_pitcher_hands_opponent"
    };
  }

  return null;
}


function buildPitcherProfileIndex(rows) {
  const out = new Map();
  const arr = Array.isArray(rows) ? rows : rows?.rows || [];

  for (const r of arr) {
    if (!r || typeof r !== "object") continue;
    if (String(r.playerType || "").toLowerCase() !== "pitcher") continue;

    const name = r.player || r.pitcher || r.name || r.fullName || r.pitcherName;
    const key = norm(name);
    if (!key) continue;

    const hasProfile =
      Number.isFinite(Number(r.xwoba)) ||
      Number.isFinite(Number(r.xslg)) ||
      Number.isFinite(Number(r.hardHitRate)) ||
      Number.isFinite(Number(r.whiffRate)) ||
      Number.isFinite(Number(r.kRate));

    if (!hasProfile) continue;

    out.set(key, {
      player: name,
      playerId: r.playerId || r.id || null,
      pa: Number.isFinite(Number(r.pa)) ? Number(r.pa) : null,
      xwoba: Number.isFinite(Number(r.xwoba)) ? Number(r.xwoba) : null,
      xslg: Number.isFinite(Number(r.xslg)) ? Number(r.xslg) : null,
      xba: Number.isFinite(Number(r.xba)) ? Number(r.xba) : null,
      barrelRate: Number.isFinite(Number(r.barrelRate)) ? Number(r.barrelRate) : null,
      hardHitRate: Number.isFinite(Number(r.hardHitRate)) ? Number(r.hardHitRate) : null,
      whiffRate: Number.isFinite(Number(r.whiffRate)) ? Number(r.whiffRate) : null,
      kRate: Number.isFinite(Number(r.kRate)) ? Number(r.kRate) : null,
      avgExitVelocity: Number.isFinite(Number(r.avgExitVelocity)) ? Number(r.avgExitVelocity) : null
    });
  }

  return out;
}

function attachPitcherProfileOnly(next, pitcherName, pitcherProfiles) {
  const profile = pitcherProfiles.get(norm(pitcherName));
  if (!profile) return false;

  next.pitchTypePitcherProfileAvailable = true;
  next.pitchTypePitcherProfileOnly = true;
  next.pitchTypePitcherProfile = profile;
  next.pitchTypeMatchupFlags = [
    ...new Set([
      ...(Array.isArray(next.pitchTypeMatchupFlags) ? next.pitchTypeMatchupFlags : []),
      "PITCHER_PROFILE_AVAILABLE",
      "MISSING_PITCHER_ARSENAL"
    ])
  ];

  return true;
}

function compactPitchTypes(rec) {
  return topPitchTypes(rec).slice(0, 5).map(p => ({
    pitchType: p.pitchType || p.type || p.code || p.name || p.pitch || null,
    usage: p.usage ?? p.pitchPercent ?? p.pitch_pct ?? p.pitchPct ?? p.percent ?? p.pct ?? null,
    velocity: p.velocity ?? p.velo ?? p.avgVelocity ?? p.avgVelo ?? null,
    whiffRate: p.whiffRate ?? p.whiff ?? p.whiff_pct ?? p.whiffPct ?? null,
    xwoba: p.xwoba ?? p.xwOBA ?? p.expectedWoba ?? null,
    xslg: p.xslg ?? p.xSLG ?? p.expectedSlg ?? null,
    hardHitRate: p.hardHitRate ?? p.hardHit ?? p.hard_hit_pct ?? p.hardHitPct ?? null,
    runValuePer100: p.runValuePer100 ?? p.rv100 ?? p.run_value_per_100 ?? p.runValue ?? null
  }));
}

const board = readJson(BOARD, []);
const matchupFile = readJson(MATCHUPS, { matchups: {} });
const arsenalFile = readJson(ARSENAL, {});
const probable = readJson(PROBABLE, { opponentPitcherByTeam: {} });
const savantRows = readJson(SAVANT, []);
const pitcherProfiles = buildPitcherProfileIndex(savantRows);

const matchups = matchupFile.matchups || {};
const arsenalByName = collectArsenalRecords(arsenalFile);

let eligibleRows = 0;
let hitterAvailable = 0;
let hitterScored = 0;
let pitcherArsenalReady = 0;
let readyRows = 0;
let fallbackRows = 0;

const out = board.map(row => {
  if (!row || typeof row !== "object") return row;
  if (row.recordType === "pricing_summary") return row;

  const next = { ...row };

  next.pitchTypeMatchupReady = false;
  next.pitchTypeMatchupAvailable = false;
  next.pitchTypeMatchupScored = false;
  next.pitchTypeMatchupTier = null;
  next.pitchTypeMatchupScore = null;
  next.pitchTypeMatchupSource = null;
  next.pitchTypeSource = null;
  next.pitchTypeNeutralFallback = false;
  next.pitchTypePitcherArsenalReady = false;
  next.pitchTypePitcherProfileAvailable = false;
  next.pitchTypePitcherProfileOnly = false;
  next.pitchTypePitcherProfile = null;
  next.pitchTypePrimaryPitches = [];
  next.pitchTypeMatchupFlags = [];

  if (isExplicitPitcherMarket(row, arsenalByName)) {
    eligibleRows += 1;

    const pitcherName = row.player || row.playerName || row.name;
    const pitcherRec = arsenalByName.get(norm(pitcherName));

    if (pitcherRec) {
      const pitches = compactPitchTypes(pitcherRec);

      next.pitchTypeMatchupReady = true;
      next.pitchTypeMatchupAvailable = true;
      next.pitchTypeMatchupScored = true;
      next.pitchTypeMatchupTier = "neutral";
      next.pitchTypeMatchupScore = 0;
      next.pitchTypeMatchupSource = "REAL_PITCHER_ARSENAL";
      next.pitchTypeSource = "REAL_PITCHER_ARSENAL";
      next.pitchTypePitcherArsenalReady = true;
      next.pitchTypePrimaryPitches = pitches;
      next.pitchTypeMatchupFlags = ["PITCHER_PROP_ARSENAL_READY"];

      pitcherArsenalReady += 1;
      readyRows += 1;
    } else {
      next.pitchTypeMatchupAvailable = false;
      next.pitchTypeMatchupTier = "unknown";
      next.pitchTypeMatchupFlags = ["MISSING_PITCHER_PROP_ARSENAL"];
      attachPitcherProfileOnly(next, pitcherName, pitcherProfiles);
      fallbackRows += 1;
    }

    return next;
  }

  if (!isHitterMarket(row, arsenalByName)) {
    return next;
  }

  eligibleRows += 1;

  const opp = opponentPitcherFromRow(row, probable);

  if (!opp?.pitcher) {
    next.pitchTypeMatchupAvailable = false;
    next.pitchTypeMatchupTier = "unknown";
    next.pitchTypeMatchupFlags = ["MISSING_OPPOSING_PITCHER"];
    fallbackRows += 1;
    return next;
  }

  const pitcherRec = arsenalByName.get(norm(opp.pitcher));
  const pitcherPitches = pitcherRec ? compactPitchTypes(pitcherRec) : [];

  next.pitchTypeOpponentPitcher = opp.pitcher;
  next.pitchTypeOpponentPitcherHand = opp.hand || null;
  next.pitchTypeOpponentPitcherSource = opp.source || null;
  next.pitchTypePitcherArsenalReady = Boolean(pitcherRec);
  next.pitchTypePrimaryPitches = pitcherPitches;

  const key = `${norm(row.player)}__${norm(opp.pitcher)}`;
  const matchup = matchups[key];

  if (matchup) {
    next.pitchTypeMatchupAvailable = true;
    next.pitchTypeMatchupTier = matchup.tier || "unknown";
    next.pitchTypeMatchupScore =
      matchup.score === undefined || matchup.score === null ? null : Number(matchup.score);
    next.pitchTypeMatchupFlags = Array.isArray(matchup.flags) ? matchup.flags : [];
    next.pitchTypePrimaryPitches = Array.isArray(matchup.pitchTypes)
      ? matchup.pitchTypes
      : pitcherPitches;

    hitterAvailable += 1;

    if (matchup.matched === true) {
      next.pitchTypeMatchupReady = true;
      next.pitchTypeMatchupScored = true;
      next.pitchTypeMatchupSource = "REAL_HITTER_PITCH_TYPE_MATCHUP";
      next.pitchTypeSource = "REAL_HITTER_PITCH_TYPE_MATCHUP";
      hitterScored += 1;
      readyRows += 1;
    } else {
      next.pitchTypeMatchupReady = false;
      next.pitchTypeMatchupScored = false;
      next.pitchTypeMatchupSource = null;
      next.pitchTypeSource = null;
      fallbackRows += 1;
    }

    return next;
  }

  if (pitcherRec) {
    next.pitchTypeMatchupAvailable = true;
    next.pitchTypeMatchupReady = false;
    next.pitchTypeMatchupScored = false;
    next.pitchTypeMatchupTier = "unknown";
    next.pitchTypeMatchupFlags = ["MISSING_HITTER_PITCH_TYPE_MATCHUP"];
    hitterAvailable += 1;
    fallbackRows += 1;
    return next;
  }

  next.pitchTypeMatchupAvailable = false;
  next.pitchTypeMatchupReady = false;
  next.pitchTypeMatchupScored = false;
  next.pitchTypeMatchupTier = "unknown";
  next.pitchTypeMatchupFlags = ["MISSING_PITCHER_ARSENAL"];
  fallbackRows += 1;

  return next;
});

writeJson(BOARD, out);

const boardRows = Array.isArray(board) ? board.length : 0;
const matchRate = boardRows ? Number((readyRows / boardRows).toFixed(4)) : 0;

console.log("PITCH TYPE MATCHUP MERGE REPORT");
console.log("===============================");
console.log({
  boardRows,
  matchupKeys: Object.keys(matchups).length,
  eligibleRows,
  hitterAvailable,
  hitterScored,
  arsenalIndexSize: arsenalByName.size,
  pitcherArsenalReady,
  readyRows,
  fallbackRows,
  matchRate
});
