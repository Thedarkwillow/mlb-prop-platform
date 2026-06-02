const fs = require("fs");
const path = require("path");

function todayPtDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

const DATE =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2] ||
  todayPtDate();

const BASE = "https://statsapi.mlb.com/api/v1";
const LIVE_BASE = "https://statsapi.mlb.com/api/v1.1";

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
function read(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function battingOrderNumber(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // MLB boxscore battingOrder is usually 100, 200, ... 900.
  // Convert to normal batting order 1-9.
  if (n >= 100) return Math.floor(n / 100);
  return n;
}

async function main() {
  const schedule = await getJson(`${BASE}/schedule?sportId=1&date=${DATE}`);
  const games = (schedule.dates || []).flatMap(d => d.games || []);

  const out = {
    date: DATE,
    refreshedAt: new Date().toISOString(),
    source: "MLB Stats API schedule + game feed/live boxscore",
    players: {},
    teams: {},
    games: {}
  };

  for (const g of games) {
    const gamePk = g.gamePk;
    const gameName = `${g.teams?.away?.team?.name || ""} @ ${g.teams?.home?.team?.name || ""}`;
    let feed;
    try {
      feed = await getJson(`${LIVE_BASE}/game/${gamePk}/feed/live`);
    } catch (e) {
      out.games[norm(gameName)] = {
        gamePk,
        game: gameName,
        status: g.status?.detailedState || "UNKNOWN",
        lineupStatus: "UNAVAILABLE",
        note: String(e.message || e)
      };
      continue;
    }

    const box = feed.liveData?.boxscore?.teams || {};
    const metaTeams = feed.gameData?.teams || {};
    const sides = [
      ["away", box.away, metaTeams.away],
      ["home", box.home, metaTeams.home]
    ];

    out.games[norm(gameName)] = {
      gamePk,
      game: gameName,
      status: feed.gameData?.status?.detailedState || g.status?.detailedState || "UNKNOWN",
      lineupStatus: "CHECKED"
    };

    for (const [side, teamBox, teamMeta] of sides) {
      const teamAbbr = String(teamMeta?.abbreviation || teamMeta?.teamCode || "").toUpperCase();
      if (!teamAbbr) continue;

      const batters = Array.isArray(teamBox?.batters) ? teamBox.batters : [];
      const players = teamBox?.players || {};
      let confirmedCount = 0;

      for (const id of batters) {
        const p = players[`ID${id}`];
        if (!p?.person?.fullName) continue;

        const order = battingOrderNumber(p.battingOrder);
        if (!order) continue;

        confirmedCount += 1;
        out.players[norm(p.person.fullName)] = {
          player: p.person.fullName,
          team: teamAbbr,
          status: "confirmed",
          battingOrder: order,
          position: p.position?.abbreviation || null,
          game: gameName,
          gamePk,
          side,
          source: "boxscore.batters"
        };
      }

      out.teams[teamAbbr] = {
        team: teamAbbr,
        status: confirmedCount >= 9 ? "confirmed" : confirmedCount > 0 ? "partial" : "unknown",
        confirmedBatters: confirmedCount,
        game: gameName,
        gamePk
      };
    }
  }

  write("data/context/lineups.json", out);
  console.log("REFRESH LINEUPS");
  console.log("===============");
  console.log(`Date: ${DATE}`);
  console.log(`Games: ${games.length}`);
  console.log(`Confirmed players: ${Object.keys(out.players).length}`);
  console.log("Wrote data/context/lineups.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
