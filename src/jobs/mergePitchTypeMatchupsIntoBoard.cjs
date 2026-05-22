const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const boardPath = "outputs/priced-board.json";
const matchupPath = "data/savant/pitch-type-matchups.json";

const board = readJson(boardPath, []);
const data = readJson(matchupPath, {});
const matchups = data.matchups || {};

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

function inferOpponent(row) {
  const team = normTeam(row.team || row.resolvedTeam);
  const raw = String(row.resolvedGame || row.game || "");
  if (!raw.includes("@")) return "";
  const parts = raw.split("@").map(x => normTeam(x));
  if (parts.length !== 2) return "";
  if (parts[0] === team) return parts[1];
  if (parts[1] === team) return parts[0];
  return "";
}

const hitterMarkets = new Set([
  "hits", "bases", "hrr", "runs", "rbis", "hr",
  "singles", "doubles", "walks", "stolen_bases",
  "hitter_fantasy_score"
]);

const byPitcherKey = new Map();
const byOpponentTeamKey = new Map();

for (const m of Object.values(matchups)) {
  byPitcherKey.set(`${norm(m.player)}__${norm(m.opponentPitcher)}`, m);
  byOpponentTeamKey.set(`${norm(m.player)}__${normTeam(m.opponent)}`, m);
}

let matched = 0;

const out = board.map(row => {
  const player = row.player || row.playerName || row.name;
  const oppPitcher =
    row.opponentPitcher ||
    row.probablePitcher ||
    row.opposingPitcher ||
    row.handednessContext?.opposingPitcher ||
    row.handednessAdjustment?.opposingPitcher ||
    row.starter ||
    row.opponentStarter;

  const market = String(row.market || "").toLowerCase();
  const eligible = hitterMarkets.has(market);
  const opponentTeam = inferOpponent(row);

  const pitcherKey = `${norm(player)}__${norm(oppPitcher)}`;
  const opponentTeamKey = `${norm(player)}__${normTeam(opponentTeam)}`;

  const m = byPitcherKey.get(pitcherKey) || byOpponentTeamKey.get(opponentTeamKey);

  if (!eligible || !m) {
    return {
      ...row,
      pitchTypeMatchupEligible: eligible,
      pitchTypeMatchupReady: false
    };
  }

  matched++;

  return {
    ...row,
    pitchTypeMatchupEligible: true,
    pitchTypeMatchupReady: true,
    pitchTypeOpponentPitcher: m.opponentPitcher,
    pitchTypeOpponentPitcherHand: m.opponentPitcherHand,
    pitchTypeMatchupScore: m.score,
    pitchTypeMatchupTier: m.tier,
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

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

console.log("PITCH TYPE MATCHUP MERGE REPORT");
console.log("===============================");
console.log({
  boardRows: board.length,
  matchupKeys: byPitcherKey.size,
  matchedRows: matched,
  matchRate: board.length ? Number((matched / board.length).toFixed(4)) : 0
});
