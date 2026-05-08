const fs = require("fs");

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);
const IN = "outputs/watchlist-final-slips.json";
const OUT = `outputs/watchlist-final-slips-graded-${DATE}.json`;
const HISTORY = "data/history/all-graded-slips.jsonl";

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function result(actual, side, line) {
  if (actual === null || actual === undefined) return "UNKNOWN";
  if (Number(actual) === Number(line)) return "PUSH";
  if (side === "MORE") return Number(actual) > Number(line) ? "HIT" : "MISS";
  if (side === "LESS") return Number(actual) < Number(line) ? "HIT" : "MISS";
  return "UNKNOWN";
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch failed ${r.status}: ${url}`);
  return r.json();
}

async function getSchedule(date) {
  return fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team`);
}


const TEAM_ALIAS = {
  "ARIZONA DIAMONDBACKS":"ARI","ARIZONA D-BACKS":"ARI","D-BACKS":"ARI","DIAMONDBACKS":"ARI","ATLANTA BRAVES":"ATL","BALTIMORE ORIOLES":"BAL","BOSTON RED SOX":"BOS",
  "CHICAGO CUBS":"CHC","CHICAGO WHITE SOX":"CWS","CINCINNATI REDS":"CIN","CLEVELAND GUARDIANS":"CLE",
  "COLORADO ROCKIES":"COL","DETROIT TIGERS":"DET","HOUSTON ASTROS":"HOU","KANSAS CITY ROYALS":"KC",
  "LOS ANGELES ANGELS":"LAA","LOS ANGELES DODGERS":"LAD","MIAMI MARLINS":"MIA","MILWAUKEE BREWERS":"MIL",
  "MINNESOTA TWINS":"MIN","NEW YORK METS":"NYM","NEW YORK YANKEES":"NYY","ATHLETICS":"ATH",
  "OAKLAND ATHLETICS":"ATH","PHILADELPHIA PHILLIES":"PHI","PITTSBURGH PIRATES":"PIT","SAN DIEGO PADRES":"SD",
  "SAN FRANCISCO GIANTS":"SF","SEATTLE MARINERS":"SEA","ST. LOUIS CARDINALS":"STL","ST LOUIS CARDINALS":"STL",
  "TAMPA BAY RAYS":"TB","TEXAS RANGERS":"TEX","TORONTO BLUE JAYS":"TOR","WASHINGTON NATIONALS":"WSH",
  "ARI":"ARI","AZ":"ARI","ATL":"ATL","BAL":"BAL","BOS":"BOS","CHC":"CHC","CWS":"CWS","CHW":"CWS","CIN":"CIN",
  "CLE":"CLE","COL":"COL","DET":"DET","HOU":"HOU","KC":"KC","KCR":"KC","LAA":"LAA","LAD":"LAD",
  "MIA":"MIA","MIL":"MIL","MIN":"MIN","NYM":"NYM","NYY":"NYY","ATH":"ATH","OAK":"ATH","PHI":"PHI",
  "PIT":"PIT","SD":"SD","SDP":"SD","SF":"SF","SFG":"SF","SEA":"SEA","STL":"STL","TB":"TB","TBR":"TB",
  "TEX":"TEX","TOR":"TOR","WSH":"WSH","WAS":"WSH"
};
function normTeamName(x) {
  const s = String(x || "").replace(/\./g, "").replace(/\s+/g, " ").trim().toUpperCase();
  return TEAM_ALIAS[s] || s;
}

function resolveGamePkFromSchedule(schedule, game) {
  const target = String(game || "").replace(/\s+/g, " ").trim().toUpperCase();
  const parts = target.split("@").map(x => normTeamName(x.trim()));
  if (parts.length !== 2) return null;
  const a = parts[0];
  const b = parts[1];

  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      const away = normTeamName(g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name);
      const home = normTeamName(g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name);
      if ((away === a && home === b) || (away === b && home === a)) return g.gamePk;
    }
  }
  return null;
}

async function getGameFeed(gamePk) {
  return fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
}

function isFinalGame(feed) {
  const detailed = String(feed?.gameData?.status?.detailedState || "").toLowerCase();
  const abstract = String(feed?.gameData?.status?.abstractGameState || "").toLowerCase();
  return detailed === "final" || abstract === "final";
}

function findPlayerRecord(box, playerName) {
  const target = normName(playerName);

  for (const side of ["away", "home"]) {
    const players = box?.teams?.[side]?.players || {};
    for (const p of Object.values(players)) {
      const name = p.person?.fullName || "";
      if (normName(name) === target) return p;
    }
  }

  return null;
}

function actualForMarket(playerRecord, market) {
  if (!playerRecord) return null;

  const batting = playerRecord.stats?.batting || {};
  const pitching = playerRecord.stats?.pitching || {};
  const m = String(market || "").toLowerCase();

  if (m === "hits") return Number(batting.hits ?? 0);
  if (m === "runs") return Number(batting.runs ?? 0);
  if (m === "rbis" || m === "rbi") return Number(batting.rbi ?? 0);
  if (m === "home_runs" || m === "home runs" || m === "hr") return Number(batting.homeRuns ?? 0);

  if (m === "bases") {
    const hits = Number(batting.hits ?? 0);
    const doubles = Number(batting.doubles ?? 0);
    const triples = Number(batting.triples ?? 0);
    const homeRuns = Number(batting.homeRuns ?? 0);
    const singles = hits - doubles - triples - homeRuns;
    return singles + doubles * 2 + triples * 3 + homeRuns * 4;
  }

  if (m === "hrr") {
    return Number(batting.hits ?? 0) + Number(batting.runs ?? 0) + Number(batting.rbi ?? 0);
  }

  if (m === "strikeouts") return Number(pitching.strikeOuts ?? 0);
  if (m === "pitching_outs" || m === "outs") return Number(pitching.outs ?? 0);
  if (m === "hits_allowed") return Number(pitching.hits ?? 0);
  if (m === "earned_runs_allowed") return Number(pitching.earnedRuns ?? 0);

  return null;
}

function gradeSlip(legs) {
  const hits = legs.filter(x => x.result === "HIT").length;
  const misses = legs.filter(x => x.result === "MISS").length;
  const pushes = legs.filter(x => x.result === "PUSH").length;
  const unknown = legs.filter(x => x.result === "UNKNOWN").length;

  return {
    hits,
    misses,
    pushes,
    unknown,
    clean: unknown === 0,
    result: unknown > 0 ? "UNKNOWN" : misses === 0 ? "HIT" : "MISS"
  };
}

(async () => {
  if (!fs.existsSync(IN)) {
    throw new Error(`Missing ${IN}. Run: node src/research/playable-final-slips.cjs`);
  }

  const playableSlips = JSON.parse(fs.readFileSync(IN, "utf8"));
  const schedule = await getSchedule(DATE);
  const cache = new Map();

  const gradedSlips = [];

  for (const slip of playableSlips) {
    const gradedLegs = [];

    for (const leg of slip.legs || []) {
      // Never trust stored gamePk for grading.
      // It can be stale from archived/previous slates.
      const gamePk = resolveGamePkFromSchedule(schedule, leg.game);

      if (!gamePk) {
        gradedLegs.push({
          ...leg,
          gamePk: null,
          actual: null,
          result: "UNKNOWN",
          note: "could not resolve gamePk"
        });
        continue;
      }

      if (!cache.has(gamePk)) {
        cache.set(gamePk, await getGameFeed(gamePk));
      }

      const feed = cache.get(gamePk);

      if (!isFinalGame(feed)) {
        gradedLegs.push({
          ...leg,
          gamePk,
          actual: null,
          result: "UNKNOWN",
          note: "game not final"
        });
        continue;
      }

      const box = feed.liveData?.boxscore;
      const player = findPlayerRecord(box, leg.player);
      const actual = actualForMarket(player, leg.market);
      const res = result(actual, leg.side, leg.line);

      gradedLegs.push({
        ...leg,
        gamePk,
        actual,
        result: res,
        foundPlayer: !!player,
        note: player ? "" : "player not found"
      });
    }

    gradedSlips.push({
      ...slip,
      graded: gradeSlip(gradedLegs),
      legs: gradedLegs
    });
  }

  const allLegs = gradedSlips.flatMap(s =>
    (s.legs || []).map(leg => ({
      ...leg,
      slipName: s.name,
      slipSize: s.size
    }))
  );

  const summary = {
    date: DATE,
    source: IN,
    gradedAt: new Date().toISOString(),
    slips: gradedSlips,
    overall: {
      slips: gradedSlips.length,
      legs: allLegs.length,
      hits: allLegs.filter(x => x.result === "HIT").length,
      misses: allLegs.filter(x => x.result === "MISS").length,
      pushes: allLegs.filter(x => x.result === "PUSH").length,
      unknown: allLegs.filter(x => x.result === "UNKNOWN").length
    }
  };

  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  fs.mkdirSync("data/history", { recursive: true });
  for (const leg of allLegs) {
    fs.appendFileSync(HISTORY, JSON.stringify({
      date: DATE,
      gradedAt: new Date().toISOString(),
      slipName: leg.slipName,
      slipSize: leg.slipSize,
      player: leg.player,
      team: leg.team,
      game: leg.game,
      gamePk: leg.gamePk,
      market: leg.market,
      side: leg.side,
      line: leg.line,
      edge: leg.edge,
      adjustedEdge: leg.adjustedEdge,
      grade: leg.grade,
      books: leg.books,
      savant: leg.savant,
      marketSupportFlag: leg.marketSupportFlag,
      actual: leg.actual,
      result: leg.result
    }) + "\n");
  }

  console.log("Wrote", OUT);
  console.log("\nSLIP RESULTS");
  console.table(gradedSlips.map(s => ({
    slip: s.name,
    size: s.size,
    result: s.graded.result,
    hits: s.graded.hits,
    misses: s.graded.misses,
    pushes: s.graded.pushes,
    unknown: s.graded.unknown
  })));

  console.log("\nLEG RESULTS");
  console.table(allLegs.map(x => ({
    slip: x.slipName,
    player: x.player,
    game: x.game,
    gamePk: x.gamePk,
    market: x.market,
    side: x.side,
    line: x.line,
    actual: x.actual,
    result: x.result,
    note: x.note || ""
  })));
})();
