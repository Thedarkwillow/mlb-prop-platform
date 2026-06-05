const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamAlias(s) {
  const x = String(s || "").toUpperCase().trim();
  const map = {
    ARI: "AZ",
    WSN: "WSH",
    WAS: "WSH",
    CHW: "CWS",
    SDP: "SD",
    SFG: "SF",
    TBR: "TB",
    KCR: "KC",
    OAK: "ATH"
  };
  return map[x] || x;
}

function splitGame(raw) {
  const s = String(raw || "");
  if (!s.includes("@")) return [];
  return s.split("@").map(x => teamAlias(x.trim()));
}

function reverseGameKey(raw) {
  const parts = splitGame(raw);
  if (parts.length !== 2) return "";
  return norm(`${parts[1]} @ ${parts[0]}`);
}

function buildGameKeys(row) {
  const keys = new Set();

  for (const raw of [
    row.resolvedGame,
    row.game,
    row.matchup,
    row.event,
    row.eventName
  ]) {
    if (!raw) continue;
    keys.add(norm(raw));
    const rev = reverseGameKey(raw);
    if (rev) keys.add(rev);
  }

  const team = teamAlias(row.team || row.resolvedTeam || row.playerTeam || row.teamAbbrev);
  const opp = teamAlias(row.opponent || row.resolvedOpponent || row.opponentTeam);
  if (team && opp) {
    keys.add(norm(`${team} @ ${opp}`));
    keys.add(norm(`${opp} @ ${team}`));
  }

  const away = teamAlias(row.awayTeam || row.away || row.awayAbbrev);
  const home = teamAlias(row.homeTeam || row.home || row.homeAbbrev);
  if (away && home) {
    keys.add(norm(`${away} @ ${home}`));
    keys.add(norm(`${home} @ ${away}`));
  }

  return [...keys].filter(Boolean);
}

function normalizeGames(games) {
  const out = {};
  for (const [key, value] of Object.entries(games || {})) {
    if (!value || typeof value !== "object") continue;
    const keys = new Set([norm(key)]);

    if (value.away && value.home) {
      keys.add(norm(`${teamAlias(value.away)} @ ${teamAlias(value.home)}`));
      keys.add(norm(`${teamAlias(value.home)} @ ${teamAlias(value.away)}`));
    }

    if (value.game) {
      keys.add(norm(value.game));
      const rev = reverseGameKey(value.game);
      if (rev) keys.add(rev);
    }

    for (const k of keys) {
      if (k) out[k] = value;
    }
  }
  return out;
}

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  process.env.SLATE_DATE ||
  new Date().toISOString().slice(0, 10);

const boardPath = "outputs/priced-board.json";
const umpirePath = "data/context/umpires.json";

const board = readJson(boardPath, []);
const umpires = readJson(umpirePath, { games: {}, umpires: {} });
const games = normalizeGames(umpires.games || {});

let matchedRows = 0;
let missingRows = 0;
let staleOrInvalidRows = 0;

const out = board.map(row => {
  if (row && row.recordType && row.recordType !== "merged_prop") return row;

  const keys = buildGameKeys(row);
  let ump = null;
  let matchedGameKey = "";

  for (const key of keys) {
    if (games[key]) {
      ump = games[key];
      matchedGameKey = key;
      break;
    }
  }

  if (!ump) {
    missingRows++;
    return {
      ...row,
      umpireContextReady: false
    };
  }

  const assignmentDate = ump.assignmentDate || ump.date || DATE;
  if (assignmentDate && String(assignmentDate) !== String(DATE)) {
    staleOrInvalidRows++;
    return {
      ...row,
      umpireContextReady: false,
      umpireContextSource: "STALE_UMPIRE_ASSIGNMENT",
      umpireAssignmentDate: assignmentDate
    };
  }

  matchedRows++;

  const source =
    ump.source ||
    ump.assignmentStatus ||
    "TODAY_UMPIRE_ASSIGNMENT";

  const kFactor = Number(ump.kFactor || 0);
  const umpireName = ump.umpire || ump.plateUmpire || ump.name || null;

  return {
    ...row,

    // Real assignment fields
    umpireContextReady: true,
    umpireContextSource: source,
    umpireAssignmentDate: assignmentDate,
    umpireAssignmentStatus: ump.assignmentStatus || null,
    umpireGameKey: matchedGameKey,

    // This intentionally overwrites old NEUTRAL_FALLBACK context.
    umpireContext: {
      source,
      umpire: umpireName,
      plateUmpire: umpireName,
      assignmentDate,
      assignmentStatus: ump.assignmentStatus || null,
      gameKey: matchedGameKey,
      kFactor,
      kBoost: !!ump.kBoost,
      kDowngrade: !!ump.kDowngrade,
      accuracyAboveX: ump.accuracyAboveX ?? null,
      overallAccuracy: ump.overallAccuracy ?? ump.accuracy ?? null,
      consistency: ump.consistency ?? null,
      runImpact: ump.runImpact ?? null,
      sampleGames: ump.sampleGames ?? null
    },

    plateUmpire: umpireName,
    umpire: umpireName,
    umpireKFactor: kFactor,
    umpireFramingAdjustment: kFactor,
    umpireFramingAdjusted: true,
    umpireKBoost: !!ump.kBoost,
    umpireKDowngrade: !!ump.kDowngrade,
    umpireAccuracyAboveX: ump.accuracyAboveX ?? null,
    umpireOverallAccuracy: ump.overallAccuracy ?? ump.accuracy ?? null,
    umpireConsistency: ump.consistency ?? null,
    umpireRunImpact: ump.runImpact ?? null,
    umpireSampleGames: ump.sampleGames ?? null
  };
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2) + "\n");

console.log("UMPIRE CONTEXT MERGE REPORT");
console.log("===========================");
console.log({
  date: DATE,
  boardRows: board.length,
  umpireGames: Object.keys(umpires.games || {}).length,
  matchedRows,
  staleOrInvalidRows,
  missingRows,
  matchRate: board.length ? Number((matchedRows / board.length).toFixed(4)) : 0
});
