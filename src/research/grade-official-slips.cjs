const fs = require("fs");
const normalizePlayerName = require("../utils/normalizePlayerName.cjs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = "outputs/official-slip.json";
const OUT = `outputs/official-slip-graded-${date}.json`;

function norm(s) {
  return normalizePlayerName(s);
}

function oldNorm_UNUSED(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
}

function getLegs(payload) {
  const flattenSlips = slips => slips.flatMap(slipObj => {
    const slipName = slipObj.name || slipObj.slip || slipObj.title || slipObj.label || "OFFICIAL";
    const legs = slipObj.legs || slipObj.picks || slipObj.entries || [];
    return legs.map(l => ({ ...l, slip: slipName }));
  });

  if (Array.isArray(payload)) {
    if (payload.some(x => Array.isArray(x?.legs) || Array.isArray(x?.picks) || Array.isArray(x?.entries))) {
      return flattenSlips(payload);
    }
    return payload;
  }

  if (Array.isArray(payload.slips)) return flattenSlips(payload.slips);
  if (Array.isArray(payload.legs)) return payload.legs;

  throw new Error("Could not find legs in official slip file");
}

function actualForMarket(stats, market) {
  const batting = stats?.batting || {};
  const pitching = stats?.pitching || {};

  if (market === "hits") return Number(batting.hits || 0);

  if (market === "bases" || market === "total_bases") {
    return (
      Number(batting.hits || 0) +
      Number(batting.doubles || 0) +
      2 * Number(batting.triples || 0) +
      3 * Number(batting.homeRuns || 0)
    );
  }

  if (market === "runs") return Number(batting.runs || 0);
  if (market === "rbis" || market === "rbi") return Number(batting.rbi || 0);
  if (market === "hrr") {
    return Number(batting.hits || 0) + Number(batting.runs || 0) + Number(batting.rbi || 0);
  }
  if (market === "home_runs" || market === "hr") return Number(batting.homeRuns || 0);

  if (market === "strikeouts") return Number(pitching.strikeOuts || 0);
  if (market === "earned_runs_allowed") return Number(pitching.earnedRuns || 0);
  if (market === "hits_allowed") return Number(pitching.hits || 0);

  if (market === "pitching_outs") {
    const ip = String(pitching.inningsPitched || "0");
    const [whole, frac] = ip.split(".");
    return Number(whole || 0) * 3 + Number(frac || 0);
  }

  return null;
}

function grade(actual, side, line) {
  if (actual == null || !Number.isFinite(Number(actual))) return "UNKNOWN";
  const s = String(side || "").toUpperCase();
  const l = Number(line);
  if (actual === l) return "PUSH";
  if (s === "MORE") return actual > l ? "HIT" : "MISS";
  if (s === "LESS") return actual < l ? "HIT" : "MISS";
  return "UNKNOWN";
}

async function buildPlayerIndex() {
  const schedule = await fetchJson(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team`
  );

  const index = new Map();

  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      const gamePk = g.gamePk;
      const away = g.teams.away.team.abbreviation;
      const home = g.teams.home.team.abbreviation;
      const game = `${away} @ ${home}`;

      const box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);

      for (const side of ["away", "home"]) {
        const players = box.teams?.[side]?.players || {};
        for (const p of Object.values(players)) {
          const fullName = p.person?.fullName;
          if (!fullName) continue;

          index.set(norm(fullName), {
            player: fullName,
            gamePk,
            game,
            gameStatus: g.status?.detailedState || "Unknown",
            isFinal: ["Final", "Game Over", "Completed Early"].includes(g.status?.detailedState),
            team: box.teams?.[side]?.team?.abbreviation,
            stats: p.stats || {}
          });
        }
      }
    }
  }

  return index;
}

(async () => {
  const payload = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const legs = getLegs(payload);
  const playerIndex = await buildPlayerIndex();

  const gradedLegs = legs.map(leg => {
    const player = leg.player || leg.name || leg.playerName;
    const market = leg.market || leg.stat || leg.type;
    const side = leg.side || leg.pick || leg.direction;
    const line = Number(leg.line);

    const match = playerIndex.get(norm(player));
    if (!match) {
      return {
        ...leg,
        player,
        market,
        side,
        line,
        gamePk: null,
        actual: null,
        result: "UNKNOWN",
        note: "could not find player in MLB boxscores for date"
      };
    }

    if (!match.isFinal) {
      return {
        ...leg,
        player,
        market,
        side,
        line,
        gamePk: match.gamePk,
        game: match.game,
        resolvedGame: match.game,
        team: match.team,
        actual: null,
        result: "PENDING",
        note: `game not final: ${match.gameStatus}`
      };
    }

    const actual = actualForMarket(match.stats, market);
    const result = grade(actual, side, line);

    return {
      ...leg,
      player,
      market,
      side,
      line,
      gamePk: match.gamePk,
      game: match.game,
      resolvedGame: match.game,
      team: match.team,
      actual,
      result,
      note: actual == null ? `unsupported market: ${market}` : "resolved by final player/date boxscore scan"
    };
  });

  const bySlip = new Map();

  for (const leg of gradedLegs) {
    const slip = leg.slip || leg.slipName || leg.entry || "OFFICIAL";
    if (!bySlip.has(slip)) bySlip.set(slip, []);
    bySlip.get(slip).push(leg);
  }

  const slips = [...bySlip.entries()].map(([slip, legs]) => {
    const hits = legs.filter(l => l.result === "HIT").length;
    const misses = legs.filter(l => l.result === "MISS").length;
    const pushes = legs.filter(l => l.result === "PUSH").length;
    const unknown = legs.filter(l => l.result === "UNKNOWN").length;
    const pending = legs.filter(l => l.result === "PENDING").length;

    return {
      slip,
      size: legs.length,
      result: pending ? "PENDING" : unknown ? "UNKNOWN" : misses ? "LOSS" : "WIN",
      hits,
      misses,
      pushes,
      unknown,
      pending,
      legs
    };
  });

  const out = { date, slips, legs: gradedLegs };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log(`Wrote ${OUT}`);

  console.log("SLIP RESULTS");
  console.table(slips.map(s => ({
    slip: s.slip,
    size: s.size,
    result: s.result,
    hits: s.hits,
    misses: s.misses,
    pushes: s.pushes,
    unknown: s.unknown,
    pending: s.pending
  })));

  console.log("LEG RESULTS");
  console.table(gradedLegs.map(l => ({
    slip: l.slip || l.slipName || l.entry || "OFFICIAL",
    player: l.player,
    game: l.game,
    gamePk: l.gamePk,
    market: l.market,
    side: l.side,
    line: l.line,
    actual: l.actual,
    result: l.result,
    note: l.note
  })));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
