const fs = require("fs");

const SOURCES = [
  "outputs/pickfinder-lineups-normalized.json",
  "outputs/pickfinder-mlb-lineups.json",
  "outputs/pickfinder-mlb-full-capture.json"
];

const OUT = "outputs/pickfinder-mlb-pitcher-profiles.json";
const OUT_TXT = "outputs/pickfinder-mlb-pitcher-profiles.txt";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function cleanStatName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function num(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "-") return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractStats(split) {
  const out = {};
  for (const row of split?.stats || []) {
    const key = cleanStatName(row.stat);
    out[key] = row.value;
  }
  return out;
}

function getStat(stats, names) {
  for (const n of names) {
    if (stats[n] != null) return stats[n];
  }
  return null;
}

function profileFromPitcher({ matchId, fixture, teamObj, pitcher, opponent }) {
  const splits = Array.isArray(pitcher?.splits) ? pitcher.splits : [];

  const seasonSplit = splits.find(s => s.isSeason || String(s.label || "").match(/^20\d\d$/)) || splits[0] || {};
  const vsOpponentSplit = splits.find(s => /vs\s+/i.test(String(s.label || "")) && !s.hand && !s.vsPitcher) || {};
  const vsLHBSplit = splits.find(s => String(s.label || "").toLowerCase().includes("lhb") || String(s.hand || "").toUpperCase() === "L") || {};
  const vsRHBSplit = splits.find(s => String(s.label || "").toLowerCase().includes("rhb") || String(s.hand || "").toUpperCase() === "R") || {};

  const season = extractStats(seasonSplit);
  const vsOpponent = extractStats(vsOpponentSplit);
  const vsLHB = extractStats(vsLHBSplit);
  const vsRHB = extractStats(vsRHBSplit);

  return {
    matchId: matchId || fixture?.fixtureId || null,
    gameString: fixture?.gameString || null,
    startDate: fixture?.startDate || null,

    pitcher: pitcher.fullName || pitcher.name || null,
    shortName: pitcher.name || null,
    hand: pitcher.hand || null,
    mlbId: pitcher.mlbId || null,
    espnId: pitcher.espnId || null,
    srId: pitcher.srId || null,
    pickfinderId: pitcher.pickfinderId || pitcher.id || null,

    team: pitcher.team || teamObj?.team || pitcher.team?.abbreviation || null,
    teamName: pitcher.teamName || pitcher.team?.displayName || teamObj?.teamName || null,
    isHome: Boolean(pitcher.isHome ?? pitcher.team?.isHome ?? teamObj?.isHome),
    opponent: opponent || null,

    seasonLabel: seasonSplit.label || null,
    record: getStat(season, ["record"]),
    inningsPitched: num(getStat(season, ["innings_pitched"])),
    earnedRunsAllowedPer9: num(getStat(season, ["earned_runs_allowed_per_9"])),
    strikeoutsPer9: num(getStat(season, ["strikeouts_per_9"])),
    whip: num(getStat(season, ["walks_plus_hits_per_inning_pitched"])),
    homeRunsAllowedPer9: num(getStat(season, ["home_runs_allowed_per_9"])),
    battingAverageAgainst: num(getStat(season, ["batting_average_against"])),
    opsAgainst: num(getStat(season, ["ops_against"])),

    vsOpponentLabel: vsOpponentSplit.label || null,
    vsOpponentBaa: num(getStat(vsOpponent, ["batting_average_against"])),
    vsOpponentOps: num(getStat(vsOpponent, ["ops_against"])),

    vsLHBLabel: vsLHBSplit.label || null,
    vsLhbBaa: num(getStat(vsLHB, ["batting_average_against"])),
    vsLhbOps: num(getStat(vsLHB, ["ops_against"])),
    vsLhbK9: num(getStat(vsLHB, ["strikeouts_per_9"])),

    vsRHBLabel: vsRHBSplit.label || null,
    vsRhbBaa: num(getStat(vsRHB, ["batting_average_against"])),
    vsRhbOps: num(getStat(vsRHB, ["ops_against"])),
    vsRhbK9: num(getStat(vsRHB, ["strikeouts_per_9"])),

    rawSplits: splits
  };
}

function teamsFromNormalized(data) {
  const rows = [];
  for (const game of data.games || []) {
    for (const team of game.teams || []) {
      if (!team.pitcher) continue;
      rows.push({
        matchId: game.matchId,
        fixture: { fixtureId: game.matchId, startDate: game.startDate || null, gameString: game.gameString || null },
        teamObj: team,
        pitcher: team.pitcher,
        opponent: null
      });
    }
  }
  return rows;
}

function teamsFromMlbLineups(data) {
  const rows = [];
  for (const entry of data.lineups || []) {
    const body = entry.body;
    if (!body || typeof body !== "object") continue;
    for (const teamData of Object.values(body)) {
      if (!teamData?.pitcher) continue;
      rows.push({
        matchId: entry.fixture?.fixtureId || null,
        fixture: entry.fixture || null,
        teamObj: null,
        pitcher: teamData.pitcher,
        opponent: null
      });
    }
  }
  return rows;
}

let sourceUsed = null;
let rawRows = [];

const full = readJson("outputs/pickfinder-mlb-full-capture.json", null);
if (full?.lineups?.length) {
  sourceUsed = "outputs/pickfinder-mlb-full-capture.json";
  rawRows = teamsFromMlbLineups({ lineups: full.lineups });
} else {
  const mlbLineups = readJson("outputs/pickfinder-mlb-lineups.json", null);
  if (mlbLineups?.lineups?.length) {
    sourceUsed = "outputs/pickfinder-mlb-lineups.json";
    rawRows = teamsFromMlbLineups(mlbLineups);
  } else {
    const normalized = readJson("outputs/pickfinder-lineups-normalized.json", null);
    if (normalized?.games?.length) {
      sourceUsed = "outputs/pickfinder-lineups-normalized.json";
      rawRows = teamsFromNormalized(normalized);
    }
  }
}

const profiles = rawRows.map(profileFromPitcher);

const out = {
  generatedAt: new Date().toISOString(),
  sourceUsed,
  pitcherProfiles: profiles
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

const lines = [];
lines.push("PICKFINDER MLB PITCHER PROFILES");
lines.push(JSON.stringify({
  generatedAt: out.generatedAt,
  sourceUsed,
  pitcherProfiles: profiles.length
}, null, 2));
lines.push("");

for (const p of profiles) {
  lines.push(`${p.team || "?"} ${p.pitcher || "?"} ${p.hand || ""} match=${p.matchId || "?"}`);
  lines.push(`  IP=${p.inningsPitched} K9=${p.strikeoutsPer9} WHIP=${p.whip} ER9=${p.earnedRunsAllowedPer9} HR9=${p.homeRunsAllowedPer9} BAA=${p.battingAverageAgainst} OPS=${p.opsAgainst}`);
  lines.push(`  vsLHB BAA=${p.vsLhbBaa} OPS=${p.vsLhbOps} K9=${p.vsLhbK9} | vsRHB BAA=${p.vsRhbBaa} OPS=${p.vsRhbOps} K9=${p.vsRhbK9}`);
}
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log({
  sourceUsed,
  pitcherProfiles: profiles.length,
  out: OUT,
  txt: OUT_TXT
});
