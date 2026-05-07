const fs = require("fs");

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);
const IN = "outputs/final-slips.json";
const OUT = `outputs/final-slips-graded-${DATE}.json`;

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
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

async function getGameFeed(gamePk) {
  const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`game feed failed ${r.status} gamePk=${gamePk}`);
  return r.json();
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

  return null;
}

(async () => {
  const final = JSON.parse(fs.readFileSync(IN, "utf8"));
  const legs = final.topLegs || [];
  const cache = new Map();
  const graded = [];

  for (const leg of legs) {
    if (!leg.gamePk) {
      graded.push({ ...leg, actual: null, result: "UNKNOWN", note: "no gamePk" });
      continue;
    }

    if (!cache.has(leg.gamePk)) {
      cache.set(leg.gamePk, await getGameFeed(leg.gamePk));
    }

    const feed = cache.get(leg.gamePk);

    if (!isFinalGame(feed)) {
      graded.push({
        ...leg,
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

    graded.push({
      ...leg,
      actual,
      result: res,
      foundPlayer: !!player
    });
  }

  const summary = {
    date: DATE,
    gradedAt: new Date().toISOString(),
    hits: graded.filter(x => x.result === "HIT").length,
    misses: graded.filter(x => x.result === "MISS").length,
    pushes: graded.filter(x => x.result === "PUSH").length,
    unknown: graded.filter(x => x.result === "UNKNOWN").length,
    legs: graded
  };

  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log("Wrote", OUT);
  console.table(graded);
})();
