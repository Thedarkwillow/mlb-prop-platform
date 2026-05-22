const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const boardPath = "outputs/priced-board.json";

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

function teamAlias(s) {
  const x = normTeam(s);
  const map = {
    "ARIZONA DIAMONDBACKS": "AZ",
    "ATLANTA BRAVES": "ATL",
    "BALTIMORE ORIOLES": "BAL",
    "BOSTON RED SOX": "BOS",
    "CHICAGO CUBS": "CHC",
    "CHICAGO WHITE SOX": "CWS",
    "CINCINNATI REDS": "CIN",
    "CLEVELAND GUARDIANS": "CLE",
    "COLORADO ROCKIES": "COL",
    "DETROIT TIGERS": "DET",
    "HOUSTON ASTROS": "HOU",
    "KANSAS CITY ROYALS": "KC",
    "LOS ANGELES ANGELS": "LAA",
    "LOS ANGELES DODGERS": "LAD",
    "MIAMI MARLINS": "MIA",
    "MILWAUKEE BREWERS": "MIL",
    "MINNESOTA TWINS": "MIN",
    "NEW YORK METS": "NYM",
    "NEW YORK YANKEES": "NYY",
    "ATHLETICS": "ATH",
    "PHILADELPHIA PHILLIES": "PHI",
    "PITTSBURGH PIRATES": "PIT",
    "SAN DIEGO PADRES": "SD",
    "SAN FRANCISCO GIANTS": "SF",
    "SEATTLE MARINERS": "SEA",
    "ST. LOUIS CARDINALS": "STL",
    "ST LOUIS CARDINALS": "STL",
    "TAMPA BAY RAYS": "TB",
    "TEXAS RANGERS": "TEX",
    "TORONTO BLUE JAYS": "TOR",
    "WASHINGTON NATIONALS": "WSH",
    ARI: "AZ",
    WSN: "WSH",
    WAS: "WSH",
    CHW: "CWS",
    SDP: "SD",
    SFG: "SF",
    TBR: "TB",
    KCR: "KC",
    OAK: "ATH",
    ATHLETICS: "ATH"
  };
  return map[x] || x;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function main() {
  const board = readJson(boardPath, []);
  const sched = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}`);

  const gamesByTeam = new Map();

  for (const d of sched.dates || []) {
    for (const g of d.games || []) {
      const awayName = g.teams?.away?.team?.name;
      const homeName = g.teams?.home?.team?.name;
      const awayAbbrev = teamAlias(g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name);
      const homeAbbrev = teamAlias(g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name);

      const game = `${awayAbbrev} @ ${homeAbbrev}`;
      const resolvedGame = `${awayName} @ ${homeName}`;

      for (const team of [awayAbbrev, homeAbbrev]) {
        if (!team) continue;
        gamesByTeam.set(team, {
          gamePk: g.gamePk,
          game,
          resolvedGame,
          awayTeam: awayAbbrev,
          homeTeam: homeAbbrev,
          opponent: team === awayAbbrev ? homeAbbrev : awayAbbrev
        });
      }
    }
  }

  let candidates = 0;
  let fixed = 0;

  const out = board.map(row => {
    const market = String(row.market || "").toLowerCase();
    const isPitcherMarket = [
      "strikeouts",
      "hits_allowed",
      "earned_runs_allowed",
      "walks_allowed",
      "pitching_outs",
      "pitcher_fantasy_score"
    ].includes(market);

    const brokenGame =
      row.game === " @ " ||
      !row.game ||
      row.gamePk == null ||
      row.resolvedGamePk == null;

    if (!isPitcherMarket || !brokenGame) return row;

    candidates++;

    const team = teamAlias(row.team || row.playerTeam || row.teamAbbrev || row.resolvedTeam);
    const g = gamesByTeam.get(team);

    if (!g) return row;

    fixed++;

    return {
      ...row,
      game: row.game && row.game !== " @ " ? row.game : g.game,
      resolvedGame: row.resolvedGame || g.resolvedGame,
      gamePk: row.gamePk || g.gamePk,
      resolvedGamePk: row.resolvedGamePk || g.gamePk,
      awayTeam: row.awayTeam || g.awayTeam,
      homeTeam: row.homeTeam || g.homeTeam,
      opponent: row.opponent || g.opponent,
      teamResolved: true,
      teamResolverStatus: row.teamResolverStatus || "pitcher_game_context_repaired"
    };
  });

  fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

  console.log("PITCHER GAME CONTEXT REPAIR");
  console.log("===========================");
  console.log({
    date: DATE,
    boardRows: board.length,
    scheduleTeams: gamesByTeam.size,
    candidates,
    fixed,
    fixRate: candidates ? Number((fixed / candidates).toFixed(4)) : 0
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
