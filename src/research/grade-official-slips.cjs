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

async function fetchJson(url) { return fetchWithRetry(url); }

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

function normMarketName(market) {
  return String(market || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasPitchingStats(stats) {
  const pitching = stats?.pitching || {};
  return Object.keys(pitching).length > 0;
}

function normalizeOfficialMarketForStats(market, stats) {
  const m = normMarketName(market);

  if (!hasPitchingStats(stats)) return m;

  // PrizePicks/board sometimes labels pitcher allowed props generically.
  if (m === "hits") return "hits_allowed";
  if (m === "runs") return "runs_allowed";
  if (m === "walks") return "walks_allowed";
  if (m === "earned_runs") return "earned_runs_allowed";

  return m;
}

function actualForMarket(stats, market) {
  market = normalizeOfficialMarketForStats(market, stats);

  const batting = stats.batting || {};
  const pitching = stats.pitching || {};

  if (market === "hits") return Number(batting.hits || 0);

  if (market === "bases" || market === "total_bases") {
    const singles = Number(batting.hits || 0)
      - Number(batting.doubles || 0)
      - Number(batting.triples || 0)
      - Number(batting.homeRuns || 0);
    return singles
      + 2 * Number(batting.doubles || 0)
      + 3 * Number(batting.triples || 0)
      + 4 * Number(batting.homeRuns || 0);
  }

  if (market === "runs") return Number(batting.runs || 0);
  if (market === "rbis" || market === "rbi") return Number(batting.rbi || 0);

  if (market === "hrr") {
    return Number(batting.hits || 0) + Number(batting.runs || 0) + Number(batting.rbi || 0);
  }

  if (market === "home_runs" || market === "hr") return Number(batting.homeRuns || 0);
  if (market === "walks") return Number(batting.baseOnBalls || batting.walks || 0);
  if (market === "hitter_strikeouts") return Number(batting.strikeOuts || 0);

  if (market === "strikeouts") return Number(pitching.strikeOuts || 0);
  if (market === "earned_runs_allowed") return Number(pitching.earnedRuns || 0);
  if (market === "runs_allowed") return Number(pitching.runs || 0);
  if (market === "hits_allowed") return Number(pitching.hits || 0);
  if (market === "walks_allowed") return Number(pitching.baseOnBalls || pitching.walks || 0);

  if (market === "pitching_outs") {
    const outs = pitching.outs;
    if (outs != null) return Number(outs);
    const innings = String(pitching.inningsPitched || "0");
    const [whole, frac] = innings.split(".");
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

      let box = null;
    try {
      box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
    } catch (err) {
      console.warn(`Skipping unavailable boxscore ${game.gamePk || gamePk}: ${err.message}`);
      continue;
    }

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
