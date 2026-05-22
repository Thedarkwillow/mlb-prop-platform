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
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

const board = readJson("outputs/priced-board.json", []);
const framing = readJson("data/context/catcher-framing.json", []);

const framingByName = new Map();
for (const c of framing) framingByName.set(norm(c.catcher), c);

const teamCatchers = new Map();

for (const row of board) {
  const player = row.player || row.playerName || row.name;
  const team = normTeam(row.team || row.playerTeam || row.teamAbbrev || row.resolvedTeam);
  if (!player || !team) continue;

  const c = framingByName.get(norm(player));
  if (!c) continue;

  if (!teamCatchers.has(team)) teamCatchers.set(team, new Map());
  const bucket = teamCatchers.get(team);

  const key = norm(player);
  if (!bucket.has(key)) {
    bucket.set(key, {
      team,
      catcher: c.catcher,
      catcherId: c.id,
      pitches: c.pitches,
      framingRunValue: c.framingRunValue,
      framingPct: c.framingPct,
      framingTier: c.framingTier,
      boardRows: 0
    });
  }

  bucket.get(key).boardRows++;
}

const out = [];

for (const [team, catchersMap] of teamCatchers.entries()) {
  const catchers = Array.from(catchersMap.values())
    .sort((a, b) => {
      const tierRank = { ELITE: 5, POSITIVE: 4, NEUTRAL: 3, NEGATIVE: 2, POOR: 1, LOW_SAMPLE: 0 };
      return (
        (b.boardRows - a.boardRows) ||
        ((tierRank[b.framingTier] || 0) - (tierRank[a.framingTier] || 0)) ||
        ((b.pitches || 0) - (a.pitches || 0))
      );
    });

  const primary = catchers[0];

  out.push({
    team,
    primaryCatcher: primary.catcher,
    primaryCatcherId: primary.catcherId,
    catcherFramingReady: true,
    catcherFramingSource: "board_catcher_name_match",
    catcherFramingCandidates: catchers.length,
    catcherFramingPitches: primary.pitches,
    catcherFramingRunValue: primary.framingRunValue,
    catcherFramingPct: primary.framingPct,
    catcherFramingTier: primary.framingTier,
    catchers
  });
}

out.sort((a, b) => String(a.team).localeCompare(String(b.team)));

fs.mkdirSync("data/context", { recursive: true });
fs.writeFileSync("data/context/team-catcher-framing.json", JSON.stringify(out, null, 2));

console.log("TEAM CATCHER FRAMING REPORT");
console.log("===========================");
console.log({ teams: out.length });

console.table(out.map(x => ({
  team: x.team,
  catcher: x.primaryCatcher,
  candidates: x.catcherFramingCandidates,
  pitches: x.catcherFramingPitches,
  rv: x.catcherFramingRunValue,
  tier: x.catcherFramingTier
})));

console.log("Wrote data/context/team-catcher-framing.json");
