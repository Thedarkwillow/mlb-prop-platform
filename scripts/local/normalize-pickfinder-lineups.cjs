const fs = require("fs");

const IN = "outputs/pickfinder-network.json";
const OUT = "outputs/pickfinder-lineups-normalized.json";

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function arr(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

const rows = readJson(IN, []);
const lineupCalls = rows.filter(r =>
  String(r.url || "").includes("/api/mlb/matches/") &&
  String(r.url || "").includes("/lineups")
);

const games = [];

for (const call of lineupCalls) {
  const url = String(call.url || "");
  const match = url.match(/\/api\/mlb\/matches\/([^/]+)\/lineups/);
  const matchId = match ? match[1] : null;
  const body = call.body || call.response || call.json || call.data;
  if (!body || typeof body !== "object") continue;

  const teams = [];

  for (const [teamSrLongId, teamData] of Object.entries(body)) {
    const pitcher = teamData.pitcher || null;
    const batters = arr(teamData.batters)
      .map(b => ({
        pickfinderId: b.id || null,
        fullName: b.fullName || b.name || null,
        shortName: b.name || null,
        mlbId: b.mlbId || null,
        espnId: b.espnId || null,
        srId: b.srId || null,
        teamSrId: b.team?.srId || teamSrLongId,
        team: b.team?.abbreviation || null,
        isHome: Boolean(b.team?.isHome),
        position: b.position || null,
        battingSpot: Number.isFinite(Number(b.battingSpot)) ? Number(b.battingSpot) : null,
        lineupStatus: b.lineupStatus || null,
        batHand: b.bat_hand || b.batHand || null,
        image: b.image || null,
        splits: b.splits || [],
        vsPitchArsenal: b.vsPitchArsenal || null
      }))
      .sort((a, b) => (a.battingSpot ?? 99) - (b.battingSpot ?? 99));

    teams.push({
      teamSrLongId,
      team: pitcher?.team?.abbreviation || batters[0]?.team || null,
      teamName: pitcher?.team?.displayName || null,
      isHome: Boolean(pitcher?.team?.isHome ?? batters[0]?.isHome),
      pitcher: pitcher ? {
        pickfinderId: pitcher.id || null,
        fullName: pitcher.fullName || pitcher.name || null,
        shortName: pitcher.name || null,
        mlbId: pitcher.mlbId || null,
        espnId: pitcher.espnId || null,
        srId: pitcher.srId || null,
        hand: pitcher.hand || null,
        team: pitcher.team?.abbreviation || null,
        teamName: pitcher.team?.displayName || null,
        isHome: Boolean(pitcher.team?.isHome),
        image: pitcher.image || null,
        splits: pitcher.splits || []
      } : null,
      batters,
      batterCount: batters.length,
      lineupStatusCounts: batters.reduce((m, b) => {
        const k = b.lineupStatus || "UNKNOWN";
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {})
    });
  }

  games.push({
    capturedAt: call.ts || new Date().toISOString(),
    matchId,
    url,
    teams
  });
}

const latestByMatch = {};
for (const g of games) latestByMatch[g.matchId || g.url] = g;

const out = {
  generatedAt: new Date().toISOString(),
  source: IN,
  lineupCalls: lineupCalls.length,
  games: Object.values(latestByMatch)
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log({
  lineupCalls: lineupCalls.length,
  games: out.games.length,
  teams: out.games.reduce((n, g) => n + g.teams.length, 0),
  batters: out.games.reduce((n, g) => n + g.teams.reduce((m, t) => m + t.batterCount, 0), 0),
  out: OUT
});

for (const g of out.games) {
  console.log("\nMATCH:", g.matchId);
  for (const t of g.teams) {
    console.log(`${t.team || "?"} pitcher: ${t.pitcher?.fullName || "?"} ${t.pitcher?.hand || ""}`);
    console.table(t.batters.map(b => ({
      spot: b.battingSpot,
      player: b.fullName,
      pos: b.position,
      hand: b.batHand,
      status: b.lineupStatus,
      mlbId: b.mlbId
    })));
  }
}
