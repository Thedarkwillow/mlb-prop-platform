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

const byKey = new Map();
for (const m of Object.values(matchups)) {
  byKey.set(`${norm(m.player)}__${norm(m.opponentPitcher)}`, m);
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

  const key = `${norm(player)}__${norm(oppPitcher)}`;
  const m = byKey.get(key);

  if (!m) {
    return {
      ...row,
      pitchTypeMatchupReady: false
    };
  }

  matched++;

  return {
    ...row,
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
  matchupKeys: byKey.size,
  matchedRows: matched,
  matchRate: board.length ? Number((matched / board.length).toFixed(4)) : 0
});
