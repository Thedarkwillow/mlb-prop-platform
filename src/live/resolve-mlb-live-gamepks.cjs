const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = "data/live/mlb-live-board-history.json";
const OUT = `outputs/live/mlb-live-board-resolved-${date}.json`;
const LATEST = "outputs/live/mlb-live-board-resolved-latest.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function normTeam(x) {
  const s = String(x || "").toUpperCase().replace(/\./g, "").trim();
  const map = {
    ARIZONA: "ARI", "D-BACKS": "ARI", DIAMONDBACKS: "ARI", ARI: "ARI", AZ: "ARI",
    ATLANTA: "ATL", BRAVES: "ATL", ATL: "ATL",
    BALTIMORE: "BAL", ORIOLES: "BAL", BAL: "BAL",
    BOSTON: "BOS", "RED SOX": "BOS", BOS: "BOS",
    CUBS: "CHC", CHC: "CHC",
    "WHITE SOX": "CWS", CWS: "CWS", CHW: "CWS",
    CINCINNATI: "CIN", REDS: "CIN", CIN: "CIN",
    CLEVELAND: "CLE", GUARDIANS: "CLE", CLE: "CLE",
    COLORADO: "COL", ROCKIES: "COL", COL: "COL",
    DETROIT: "DET", TIGERS: "DET", DET: "DET",
    HOUSTON: "HOU", ASTROS: "HOU", HOU: "HOU",
    KANSAS: "KC", ROYALS: "KC", KC: "KC", KCR: "KC",
    ANGELS: "LAA", LAA: "LAA",
    DODGERS: "LAD", LAD: "LAD",
    MIAMI: "MIA", MARLINS: "MIA", MIA: "MIA",
    MILWAUKEE: "MIL", BREWERS: "MIL", MIL: "MIL",
    MINNESOTA: "MIN", TWINS: "MIN", MIN: "MIN",
    METS: "NYM", NYM: "NYM",
    YANKEES: "NYY", NYY: "NYY",
    ATHLETICS: "ATH", ATH: "ATH", OAK: "ATH",
    PHILADELPHIA: "PHI", PHILLIES: "PHI", PHI: "PHI",
    PITTSBURGH: "PIT", PIRATES: "PIT", PIT: "PIT",
    PADRES: "SD", SD: "SD", SDP: "SD",
    GIANTS: "SF", SF: "SF", SFG: "SF",
    SEATTLE: "SEA", MARINERS: "SEA", SEA: "SEA",
    CARDINALS: "STL", STL: "STL",
    RAYS: "TB", TB: "TB", TBR: "TB",
    TEXAS: "TEX", RANGERS: "TEX", TEX: "TEX",
    TORONTO: "TOR", "BLUE JAYS": "TOR", TOR: "TOR",
    WASHINGTON: "WSH", NATIONALS: "WSH", WSH: "WSH", WAS: "WSH"
  };
  return map[s] || s;
}

function teamsFromGame(game) {
  const txt = String(game || "").replace(/\s+/g, " ").trim();

  if (txt.includes("@")) {
    const parts = txt.split("@").map(x => normTeam(x.trim()));
    return parts.length === 2 ? parts : [];
  }

  if (txt.includes("/")) {
    const parts = txt.split("/").map(x => normTeam(x.trim()));
    return parts.length === 2 ? parts : [];
  }

  return [];
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

async function scheduleIndex(date) {
  const schedule = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team`);
  const games = [];
  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      const away = normTeam(g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name);
      const home = normTeam(g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name);
      games.push({
        gamePk: g.gamePk,
        away,
        home,
        game: `${away} @ ${home}`
      });
    }
  }
  return games;
}

function resolveRow(row, games) {
  if (row.gamePk) return { ...row, resolvedGamePk: row.gamePk, resolveStatus: "already_has_gamePk" };

  const teams = teamsFromGame(row.game);
  const team = normTeam(row.team);

  let match = null;

  if (teams.length === 2) {
    const [a, b] = teams;
    match = games.find(g =>
      (g.away === a && g.home === b) ||
      (g.away === b && g.home === a)
    );
  }

  if (!match && team) {
    const teamGames = games.filter(g => g.away === team || g.home === team);
    if (teamGames.length === 1) match = teamGames[0];
  }

  return {
    ...row,
    resolvedGamePk: match?.gamePk || null,
    resolvedGame: match?.game || null,
    resolveStatus: match ? "resolved" : "unresolved"
  };
}

async function main() {
  const rows = read(INPUT, []).filter(r => r.date === date);
  const games = await scheduleIndex(date);
  const resolved = rows.map(r => resolveRow(r, games));

  write(OUT, resolved);
  write(LATEST, resolved);

  console.log("MLB LIVE GAMEPK RESOLVER");
  console.log("------------------------");
  console.log("date:", date);
  console.log("input rows:", rows.length);
  console.log("resolved:", resolved.filter(r => r.resolvedGamePk).length);
  console.log("unresolved:", resolved.filter(r => !r.resolvedGamePk).length);
  if (!process.argv.includes("--quiet")) {
    console.table(resolved.slice(0, 40).map(r => ({
      player: r.player,
      team: r.team,
      game: r.game,
      market: r.market,
      inning: r.inningWindow,
      resolvedGamePk: r.resolvedGamePk,
      status: r.resolveStatus
    })));
  }
  console.log("saved:", OUT);
  console.log("saved:", LATEST);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
