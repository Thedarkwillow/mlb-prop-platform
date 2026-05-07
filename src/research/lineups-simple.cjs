const fs = require("fs");

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function getGames() {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}`;
  const data = await fetchJson(url);
  return (data.dates || []).flatMap(d => d.games || []);
}

async function getLineupFromGame(gamePk) {
  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
  const data = await fetchJson(url);

  const players = [];

  for (const side of ["away", "home"]) {
    const team = data.teams?.[side];
    const teamAbbr = team?.team?.abbreviation || team?.team?.teamName || side;

    for (const id of team?.batters || []) {
      const p = team.players?.[`ID${id}`];
      if (!p) continue;

      // battingOrder exists when official lineup is posted
      if (!p.battingOrder) continue;

      players.push({
        player: p.person?.fullName,
        norm: normName(p.person?.fullName),
        team: teamAbbr,
        gamePk,
        battingOrder: Number(p.battingOrder)
      });
    }
  }

  return players;
}

(async () => {
  fs.mkdirSync("outputs", { recursive: true });

  const games = await getGames();
  const confirmed = [];

  for (const g of games) {
    try {
      const rows = await getLineupFromGame(g.gamePk);
      confirmed.push(...rows);
    } catch (err) {
      console.warn(`lineup fetch failed gamePk=${g.gamePk}: ${err.message}`);
    }
  }

  const manual = readJson("data/confirmed-lineups.json", []);
  for (const x of manual) {
    if (!x?.player) continue;
    confirmed.push({
      player: x.player,
      norm: normName(x.player),
      team: x.team || null,
      source: "manual"
    });
  }

  const byName = new Map();
  for (const x of confirmed) {
    if (!x.norm) continue;
    byName.set(x.norm, x);
  }

  const out = [...byName.values()].sort((a, b) =>
    String(a.team || "").localeCompare(String(b.team || "")) ||
    String(a.player || "").localeCompare(String(b.player || ""))
  );

  fs.writeFileSync("outputs/confirmed-lineups-full.json", JSON.stringify(out, null, 2));
  fs.writeFileSync("outputs/confirmed-lineups.json", JSON.stringify(out.map(x => x.player), null, 2));

  console.log("date:", DATE);
  console.log("games:", games.length);
  console.log("confirmed players:", out.length);
  console.table(out.slice(0, 30).map(x => ({
    player: x.player,
    team: x.team,
    battingOrder: x.battingOrder || null,
    source: x.source || "mlb"
  })));
})();
