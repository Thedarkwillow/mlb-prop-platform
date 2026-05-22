const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const boardPath = "outputs/priced-board.json";
const formPath = "data/context/player-game-log-form.json";

const board = readJson(boardPath, []);
const form = readJson(formPath, []);

const byPlayer = new Map();
for (const r of form) byPlayer.set(norm(r.player), r);

let matched = 0;

const out = board.map(row => {
  const player = row.player || row.playerName || row.name;
  const f = byPlayer.get(norm(player));

  if (!f) {
    return {
      ...row,
      gameLogFormReady: false
    };
  }

  matched++;

  return {
    ...row,
    gameLogFormReady: true,

    hitterSeasonGames: f.hitter?.season?.games ?? 0,
    hitterLast5Games: f.hitter?.last5?.games ?? 0,
    hitterLast10Games: f.hitter?.last10?.games ?? 0,
    hitterLast15Games: f.hitter?.last15?.games ?? 0,

    hitterLast15HitsPerGame: f.hitter?.last15?.hitsPerGame ?? null,
    hitterLast15TotalBasesPerGame: f.hitter?.last15?.totalBasesPerGame ?? null,
    hitterLast15RunsPerGame: f.hitter?.last15?.runsPerGame ?? null,
    hitterLast15RbisPerGame: f.hitter?.last15?.rbisPerGame ?? null,
    hitterLast15HrrPerGame: f.hitter?.last15?.hrrPerGame ?? null,
    hitterLast15HrPerGame: f.hitter?.last15?.hrPerGame ?? null,
    hitterLast15WalkRate: f.hitter?.last15?.walkRate ?? null,
    hitterLast15KRate: f.hitter?.last15?.kRate ?? null,
    hitterLast15Avg: f.hitter?.last15?.avg ?? null,
    hitterLast15Slug: f.hitter?.last15?.slug ?? null,

    hitterSeasonHitsPerGame: f.hitter?.season?.hitsPerGame ?? null,
    hitterSeasonTotalBasesPerGame: f.hitter?.season?.totalBasesPerGame ?? null,
    hitterSeasonHrrPerGame: f.hitter?.season?.hrrPerGame ?? null,
    hitterSeasonAvg: f.hitter?.season?.avg ?? null,
    hitterSeasonSlug: f.hitter?.season?.slug ?? null,

    pitcherSeasonGames: f.pitcher?.season?.games ?? 0,
    pitcherLast5Games: f.pitcher?.last5?.games ?? 0,
    pitcherLast10Games: f.pitcher?.last10?.games ?? 0,
    pitcherLast15Games: f.pitcher?.last15?.games ?? 0,

    pitcherLast5OutsPerGame: f.pitcher?.last5?.outsPerGame ?? null,
    pitcherLast5InningsPerGame: f.pitcher?.last5?.inningsPerGame ?? null,
    pitcherLast5EarnedRunsPerGame: f.pitcher?.last5?.earnedRunsPerGame ?? null,
    pitcherLast5HitsAllowedPerGame: f.pitcher?.last5?.hitsAllowedPerGame ?? null,
    pitcherLast5StrikeoutsPerGame: f.pitcher?.last5?.strikeoutsPerGame ?? null,
    pitcherLast5WalksAllowedPerGame: f.pitcher?.last5?.walksAllowedPerGame ?? null,
    pitcherLast5PitchesPerGame: f.pitcher?.last5?.pitchesPerGame ?? null,
    pitcherLast5QualityStartRate: f.pitcher?.last5?.qualityStartRate ?? null,

    pitcherSeasonOutsPerGame: f.pitcher?.season?.outsPerGame ?? null,
    pitcherSeasonEarnedRunsPerGame: f.pitcher?.season?.earnedRunsPerGame ?? null,
    pitcherSeasonHitsAllowedPerGame: f.pitcher?.season?.hitsAllowedPerGame ?? null,
    pitcherSeasonStrikeoutsPerGame: f.pitcher?.season?.strikeoutsPerGame ?? null,
    pitcherSeasonWalksAllowedPerGame: f.pitcher?.season?.walksAllowedPerGame ?? null,
    pitcherSeasonPitchesPerGame: f.pitcher?.season?.pitchesPerGame ?? null,
    pitcherSeasonQualityStartRate: f.pitcher?.season?.qualityStartRate ?? null
  };
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

console.log("PLAYER GAME LOG FORM MERGE REPORT");
console.log("=================================");
console.log({
  boardRows: board.length,
  formPlayers: form.length,
  matchedRows: matched,
  matchRate: board.length ? Number((matched / board.length).toFixed(4)) : 0
});
