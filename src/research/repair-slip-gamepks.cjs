const fs = require("fs");

const DATE = process.argv[2] || "2026-05-05";
const IN = "outputs/slips.json";
const OUT = "outputs/slips.gamepk-fixed.json";

const TEAM = {
  ARI:"ARI", ATL:"ATL", BAL:"BAL", BOS:"BOS", CHC:"CHC", CWS:"CWS", CHW:"CWS",
  CIN:"CIN", CLE:"CLE", COL:"COL", DET:"DET", HOU:"HOU", KC:"KC", KCR:"KC",
  LAA:"LAA", LAD:"LAD", MIA:"MIA", MIL:"MIL", MIN:"MIN", NYM:"NYM", NYY:"NYY",
  ATH:"ATH", OAK:"ATH", PHI:"PHI", PIT:"PIT", SD:"SD", SDP:"SD", SEA:"SEA",
  SF:"SF", SFG:"SF", STL:"STL", TB:"TB", TBR:"TB", TEX:"TEX", TOR:"TOR", WSH:"WSH", WAS:"WSH"
};

function normTeam(t) {
  return TEAM[String(t || "").toUpperCase().trim()] || String(t || "").toUpperCase().trim();
}

function parseGame(g) {
  const [a,b] = String(g || "").split("@").map(x => normTeam(x.trim()));
  return { away:a, home:b };
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

(async () => {
  const raw = JSON.parse(fs.readFileSync(IN, "utf8"));
  const slips = raw.slips || raw;

  const schedule = await getJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}&hydrate=team`
  );

  const gameMap = new Map();

  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      const away = normTeam(g.teams?.away?.team?.abbreviation);
      const home = normTeam(g.teams?.home?.team?.abbreviation);
      if (!away || !home) continue;

      gameMap.set(`${away}@${home}`, {
        gamePk: g.gamePk,
        game: `${away} @ ${home}`,
        status: g.status?.detailedState || null
      });
    }
  }

  let fixed = 0;
  let missing = 0;

  for (const slip of slips) {
    for (const leg of slip.legs || []) {
      const parsed = parseGame(leg.game);
      const hit =
        gameMap.get(`${parsed.away}@${parsed.home}`) ||
        gameMap.get(`${parsed.home}@${parsed.away}`);

      if (hit) {
        leg.oldGamePk = leg.gamePk || null;
        leg.gamePk = hit.gamePk;
        leg.game = hit.game;
        leg.gameStatus = hit.status;
        fixed++;
      } else {
        leg.gamePkRepairMissing = true;
        missing++;
      }
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(raw, null, 2));
  fs.copyFileSync(OUT, IN);

  console.log("schedule games:", gameMap.size);
  console.log("fixed legs:", fixed);
  console.log("missing legs:", missing);
  console.log("wrote", OUT, "and updated", IN);
})();
