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

function resolveGamePkFromSchedule(schedule, gameText) {
  const parts = String(gameText || "").split("@").map(x => x.trim().toUpperCase());
  if (parts.length !== 2) return null;

  const [away, home] = parts;
  const games = schedule?.dates?.flatMap(d => d.games || []) || [];

  for (const g of games) {
    const a = String(g.teams?.away?.team?.abbreviation || "").toUpperCase();
    const h = String(g.teams?.home?.team?.abbreviation || "").toUpperCase();
    if (a === away && h === home) return g.gamePk;
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
