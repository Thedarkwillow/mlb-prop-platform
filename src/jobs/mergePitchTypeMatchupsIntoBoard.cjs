const fs = require("fs");

const boardPath = "outputs/priced-board.json";
const matchupPath = "data/savant/pitch-type-matchups.json";
const arsenalPath = "data/savant/pitcher-arsenal-compact.json";

function readJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

function inferOpponent(row) {
  const team = normTeam(row.team || row.resolvedTeam);
  const raw = String(row.resolvedGame || row.game || "")
    .replace(/\s+at\s+/gi, " @ ")
    .trim();

  if (!raw.includes("@")) return "";
  const parts = raw.split("@").map(x => normTeam(x));
  if (parts.length !== 2) return "";
  if (parts[0] === team) return parts[1];
  if (parts[1] === team) return parts[0];
  return "";
}

function isPitcherMarket(row) {
  const m = String(row.market || row.stat || "").toLowerCase();
  return (
    m.includes("strikeout") ||
    m.includes("pitching") ||
    m.includes("outs") ||
    m.includes("earned_runs_allowed") ||
    m.includes("hits_allowed") ||
    m.includes("walks_allowed") ||
    m.includes("pitches_thrown") ||
    m.includes("pitcher_fantasy")
  );
}

function pitcherArsenalForRow(row, arsenal) {
  const player = row.player || row.playerName || row.name;
  const key = norm(player);
  return arsenal.pitchers?.[key] || null;
}

const hitterMarkets = new Set([
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

const board = readJson(boardPath, []);
const data = readJson(matchupPath, {});
const arsenal = readJson(arsenalPath, {});
const matchups = data.matchups || {};

const byPitcherKey = new Map();
const byOpponentTeamKey = new Map();

for (const m of Object.values(matchups)) {
  byPitcherKey.set(`${norm(m.player)}__${norm(m.opponentPitcher)}`, m);
  byOpponentTeamKey.set(`${norm(m.player)}__${normTeam(m.opponent)}`, m);
}

let hitterAvailable = 0;
let hitterScored = 0;
let pitcherArsenalReady = 0;
let eligibleRows = 0;

const out = board.map(row => {
  if (row.recordType && row.recordType !== "merged_prop") return row;

  const player = row.player || row.playerName || row.name;
  const market = String(row.market || row.stat || "").toLowerCase();
  const pitcherMarket = isPitcherMarket(row);
  const hitterMarket = hitterMarkets.has(market);
  const eligible = pitcherMarket || hitterMarket;

  if (!eligible) {
    return {
      ...row,
      pitchTypeMatchupEligible: false,
      pitchTypeMatchupAvailable: false,
      pitchTypeMatchupReady: false,
      pitchTypeMatchupScored: false,
      pitchTypePitcherArsenalReady: false,
      pitchTypeMatchupTier: null,
      pitchTypeMatchupScore: null
    };
  }

  eligibleRows++;

  if (pitcherMarket) {
    const arm = pitcherArsenalForRow(row, arsenal);

    if (!arm) {
      return {
        ...row,
        pitchTypeMatchupEligible: true,
        pitchTypeMatchupAvailable: false,
        pitchTypeMatchupReady: false,
        pitchTypeMatchupScored: false,
        pitchTypePitcherArsenalReady: false,
        pitchTypeMatchupTier: "unknown",
        pitchTypeMatchupScore: null,
        pitchTypeMatchupFlags: [
          ...(row.pitchTypeMatchupFlags || []),
          "MISSING_PITCHER_PROP_ARSENAL"
        ]
      };
    }

    pitcherArsenalReady++;

    return {
      ...row,
      pitchTypeMatchupEligible: true,
      pitchTypeMatchupAvailable: true,
      pitchTypeMatchupReady: true,
      pitchTypeMatchupScored: true,
      pitchTypePitcherArsenalReady: true,
      pitchTypeOpponentPitcher: arm.pitcher || arm.player || player,
      pitchTypeOpponentPitcherHand: arm.hand || null,
      pitchTypeMatchupScore: row.pitchTypeMatchupScore ?? 0,
      pitchTypeMatchupTier: row.pitchTypeMatchupTier || "pitcher_arsenal_ready",
      pitchTypeMatchupFlags: [
        ...(row.pitchTypeMatchupFlags || []),
        "PITCHER_PROP_ARSENAL_READY"
      ],
      pitchTypePrimaryPitches: (arm.season?.pitchTypes || []).slice(0, 5)
    };
  }

  const oppPitcher =
    row.opponentPitcher ||
    row.probablePitcher ||
    row.opposingPitcher ||
    row.handednessContext?.opposingPitcher ||
    row.handednessAdjustment?.opposingPitcher ||
    row.starter ||
    row.opponentStarter;

  const opponentTeam = inferOpponent(row);
  const pitcherKey = `${norm(player)}__${norm(oppPitcher)}`;
  const opponentTeamKey = `${norm(player)}__${normTeam(opponentTeam)}`;
  const m = byPitcherKey.get(pitcherKey) || byOpponentTeamKey.get(opponentTeamKey);

  if (!m) {
    return {
      ...row,
      pitchTypeMatchupEligible: true,
      pitchTypeMatchupAvailable: false,
      pitchTypeMatchupReady: false,
      pitchTypeMatchupScored: false,
      pitchTypeMatchupTier: null,
      pitchTypeMatchupScore: null
    };
  }

  hitterAvailable++;

  const tier = String(m.tier || "").toLowerCase();
  const scored = m.matched === true && tier !== "unknown";

  if (scored) hitterScored++;

  return {
    ...row,
    pitchTypeMatchupEligible: true,
    pitchTypeMatchupAvailable: true,
    pitchTypeMatchupReady: scored,
    pitchTypeMatchupScored: scored,
    pitchTypePitcherArsenalReady: false,
    pitchTypeOpponentPitcher: m.opponentPitcher,
    pitchTypeOpponentPitcherHand: m.opponentPitcherHand,
    pitchTypeMatchupScore: scored ? m.score : null,
    pitchTypeMatchupTier: scored ? m.tier : "unknown",
    pitchTypeMatchupFlags: m.flags || [],
    pitchTypePrimaryPitches: (m.pitchTypes || []).slice(0, 5).map(p => ({
      pitchType: p.pitchType,
      usage: p.usage,
      velocity: p.velocity,
      whiffRate: p.whiffRate,
      xwoba: p.xwoba,
      xslg: p.xslg,
      hardHitRate: p.hardHitRate,
      runValuePer100: p.runValuePer100
    }))
  };
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2) + "\n");

const readyRows = out.filter(r => r.recordType === "merged_prop" && r.pitchTypeMatchupReady === true).length;

console.log("PITCH TYPE MATCHUP MERGE REPORT");
console.log("===============================");
console.log({
  boardRows: board.length,
  matchupKeys: byPitcherKey.size,
  eligibleRows,
  hitterAvailable,
  hitterScored,
  pitcherArsenalReady,
  readyRows,
  matchRate: board.length ? Number((readyRows / board.length).toFixed(4)) : 0
});
