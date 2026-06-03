const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);
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


async function fetchWithRetry(url) {
  const headers = {
    "Accept": "application/json,text/plain,*/*",
    "User-Agent": "Mozilla/5.0 MLBPropPlatform/1.0",
    "Origin": "https://www.mlb.com",
    "Referer": "https://www.mlb.com/"
  };

  const urls = [url];

  // MLB Stats API sometimes rejects hydrate=team with 406.
  if (url.includes("/schedule?") && url.includes("hydrate=team")) {
    urls.push(url.replace(/([?&])hydrate=team(&?)/, (m, p1, p2) => p2 ? p1 : ""));
  }

  // Clean accidental trailing ? or &.
  for (let i = 0; i < urls.length; i++) {
    urls[i] = urls[i].replace(/[?&]$/, "");
  }

  let lastErr = null;

  for (const u of [...new Set(urls)]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await fetch(u, { headers });

      if (r.ok) return await r.json();

      const text = await r.text().catch(() => "");
      lastErr = new Error(`${r.status} ${r.statusText || ""}: ${u} ${text.slice(0, 200)}`.trim());

      if (![403, 406, 429, 500, 502, 503, 504].includes(r.status)) break;

      await new Promise(resolve => setTimeout(resolve, 350 * attempt));
    }
  }

  throw lastErr || new Error(`Fetch failed: ${url}`);
}

async function getJson(url) { return fetchWithRetry(url); }

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
