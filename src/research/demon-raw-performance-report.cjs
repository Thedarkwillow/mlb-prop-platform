const fs = require("fs");
const { execFileSync } = require("child_process");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  process.env.DATE ||
  new Date().toISOString().slice(0, 10);

const boardCandidates = [
  `outputs/priced-board-${date}.json`,
  `outputs/history/${date}-priced-board.json`,
  "outputs/priced-board.json"
];

const boardFile = boardCandidates.find(f => fs.existsSync(f)) || "outputs/priced-board.json";
const fullBoardFile = `outputs/history/${date}-full-board-graded.json`;
const outFile = `outputs/history/${date}-demon-raw-performance.json`;

function readJson(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync("outputs/history", { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function fetchJson(url) {
  const variants = [
    url.includes("/boxscore")
      ? url.replace("/api/v1/game/", "/api/v1.1/game/").replace("/boxscore", "/feed/live")
      : null,
    url.includes("/boxscore")
      ? url.replace("/api/v1/game/", "/api/v1/game/").replace("/boxscore", "/feed/live")
      : null,
    url,
    url.includes("/api/v1/game/") ? url.replace("/api/v1/game/", "/api/v1.1/game/") : null
  ].filter(Boolean);

  for (const candidate of [...new Set(variants)]) {
    try {
      const raw = execFileSync("curl", [
        "-sSL",
        "-H", "accept: application/json,text/plain,*/*",
        "-H", "user-agent: Mozilla/5.0 mlb-prop-platform",
        candidate
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 30000
      });

      if (!raw || !raw.trim()) continue;

      const parsed = JSON.parse(raw);

      if (parsed && parsed.status && parsed.error) continue;
      if (parsed && parsed.liveData) return parsed;
      if (parsed && parsed.teams) return parsed;
      if (parsed && parsed.dates) return parsed;
      if (parsed && parsed.gameData) return parsed;
    } catch {
      // Try next MLB endpoint variant.
    }
  }

  return null;
}

function flatten(v, out = []) {
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
  } else if (v && typeof v === "object") {
    out.push(v);
    for (const x of Object.values(v)) flatten(x, out);
  }
  return out;
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function upper(s) {
  return String(s || "").toUpperCase().trim();
}

function marketKey(s) {
  const m = String(s || "").toLowerCase().trim();

  if (m.includes("hitter") && m.includes("fantasy")) return "hitter_fantasy_score";
  if (m === "fantasy_score") return "hitter_fantasy_score";
  if (m === "pitcher_strikeouts") return "strikeouts";
  if (m === "pitching_strikeouts") return "strikeouts";
  if (m === "outs") return "pitching_outs";
  if (m === "earned_runs") return "earned_runs_allowed";
  if (m === "pitcher_hits") return "hits_allowed";
  if (m === "pitcher_walks") return "walks_allowed";

  return m;
}

function playerName(r) {
  return r.player || r.playerName || r.name || r.description || "";
}

function rowMarket(r) {
  return marketKey(r.market || r.statType || r.stat || r.normalizedMarket || "");
}

function rowTier(r) {
  return String(r.oddsTier || r.tier || r.odds_tier || "").toLowerCase();
}

function rowSide(r) {
  const tier = rowTier(r);
  if (tier === "demon" || tier === "demon") return "MORE";
  return upper(r.side || r.recommendedSide || r.playableSide || r.direction || r.pick);
}

function rowLine(r) {
  const n = Number(r.line ?? r.ppLine ?? r.projectionLine ?? r.targetLine);
  return Number.isFinite(n) ? n : null;
}

function rowTeam(r) {
  return upper(r.team || r.teamAbbr || r.resolvedTeam || r.team_abbr || "");
}

function rowGamePk(r) {
  return r.gamePk || r.gamePK || r.mlbGamePk || r.mlb_game_pk || r.resolvedGamePk || null;
}

function parseIpToOuts(ip) {
  if (ip === null || ip === undefined) return null;
  const text = String(ip).trim();
  if (!text) return null;

  const [wholeRaw, fracRaw = "0"] = text.split(".");
  const whole = Number(wholeRaw);
  const frac = Number(fracRaw);

  if (!Number.isFinite(whole) || !Number.isFinite(frac)) return null;
  if (![0, 1, 2].includes(frac)) return null;

  return whole * 3 + frac;
}

function battingActual(market, b = {}) {
  const hits = Number(b.hits || 0);
  const doubles = Number(b.doubles || 0);
  const triples = Number(b.triples || 0);
  const homeRuns = Number(b.homeRuns || 0);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const runs = Number(b.runs || 0);
  const rbis = Number(b.rbi || b.rbis || 0);
  const walks = Number(b.baseOnBalls || b.walks || 0);
  const hbp = Number(b.hitByPitch || 0);
  const stolenBases = Number(b.stolenBases || 0);
  const totalBases = singles + doubles * 2 + triples * 3 + homeRuns * 4;
  const hrr = hits + runs + rbis;

  if (market === "hits") return hits;
  if (market === "singles") return singles;
  if (market === "bases") return totalBases;
  if (market === "hrr") return hrr;
  if (market === "runs") return runs;
  if (market === "rbis") return rbis;
  if (market === "walks") return walks;
  if (market === "home_runs") return homeRuns;

  if (market === "hitter_fantasy_score") {
    return (
      singles * 3 +
      doubles * 5 +
      triples * 8 +
      homeRuns * 10 +
      runs * 2 +
      rbis * 2 +
      walks * 2 +
      hbp * 2 +
      stolenBases * 5
    );
  }

  return null;
}

function pitchingActual(market, p = {}) {
  if (market === "strikeouts") return Number(p.strikeOuts || p.strikeouts || 0);
  if (market === "earned_runs_allowed") return Number(p.earnedRuns || 0);
  if (market === "hits_allowed") return Number(p.hits || 0);
  if (market === "walks_allowed") return Number(p.baseOnBalls || p.walks || 0);

  if (market === "pitching_outs") {
    return parseIpToOuts(p.inningsPitched ?? p.ip ?? null);
  }

  return null;
}

function gradeMore(actual, line) {
  if (actual === null || actual === undefined || line === null) return "UNMATCHED";
  if (actual === line) return "PUSH";
  return actual > line ? "HIT" : "MISS";
}

function uniqueKey(r) {
  return [
    normName(playerName(r)),
    rowTeam(r),
    rowMarket(r),
    rowSide(r),
    String(rowLine(r)),
    String(rowGamePk(r) || "")
  ].join("|");
}

function gradedKey(r) {
  return [
    normName(playerName(r)),
    rowMarket(r),
    rowSide(r),
    String(rowLine(r))
  ].join("|");
}

function buildFullBoardIndex() {
  const rows = flatten(readJson(fullBoardFile, []));
  const map = new Map();

  for (const r of rows) {
    const result = String(r.result || "").toUpperCase();
    if (!["HIT", "MISS", "PUSH"].includes(result)) continue;
    if (!playerName(r) || !rowMarket(r) || rowLine(r) === null) continue;

    map.set(gradedKey(r), {
      actual: r.actual,
      result,
      gamePk: rowGamePk(r),
      source: "full_board_graded"
    });
  }

  return map;
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const unmatched = rows.filter(r => r.result === "UNMATCHED").length;
  const invalidContext = rows.filter(r => r.result === "INVALID_CONTEXT").length;
  const unavailable = rows.filter(r => r.result === "UNAVAILABLE").length;
  const denom = hits + misses;

  return {
    total: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
    invalidContext,
    unavailable,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : null
  };
}

function groupSummary(rows, keyFn) {
  const groups = {};
  for (const r of rows) {
    const k = keyFn(r) || "unknown";
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, summarize(v)])
  );
}

function fetchJsonDirect(url, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = execFileSync("curl", [
        "-sSL",
        "--retry", "2",
        "--retry-delay", "1",
        "-H", "accept: application/json,text/plain,*/*",
        "-H", "user-agent: Mozilla/5.0 mlb-prop-platform",
        url
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 30000
      });

      if (!raw || !raw.trim()) continue;

      const parsed = JSON.parse(raw);
      if (parsed && parsed.status && parsed.error) continue;
      return parsed;
    } catch {
      // Retry.
    }
  }

  return null;
}

function buildBoxscoreIndex() {
  const schedule = fetchJsonDirect(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`, 5);
  const games = [];

  if (schedule && Array.isArray(schedule.dates)) {
    for (const d of schedule.dates || []) {
      for (const g of d.games || []) {
        games.push({
          gamePk: g.gamePk,
          link: g.link || `/api/v1.1/game/${g.gamePk}/feed/live`,
          away: g.teams?.away?.team?.name,
          home: g.teams?.home?.team?.name
        });
      }
    }
  }

  if (!games.length) {
    const fallbackGamePks = [
      ...new Set(
        flatten(readJson(fullBoardFile, []))
          .map(r => rowGamePk(r))
          .filter(Boolean)
      )
    ];

    for (const gamePk of fallbackGamePks) {
      games.push({
        gamePk,
        link: `/api/v1.1/game/${gamePk}/feed/live`,
        away: null,
        home: null
      });
    }
  }

  if (!games.length) {
    throw new Error(`No MLB games available for ${date}`);
  }

  const byGame = new Map();
  const all = [];

  for (const g of games) {
    const feedUrl = g.link
      ? `https://statsapi.mlb.com${g.link}`
      : `https://statsapi.mlb.com/api/v1.1/game/${g.gamePk}/feed/live`;

    const boxRaw = fetchJsonDirect(feedUrl, 8) || fetchJson(feedUrl);
    const box = boxRaw?.teams ? boxRaw : boxRaw?.liveData?.boxscore;
    const gamePlayers = [];

    if (!box || !box.teams) {
      console.warn(`WARN: boxscore unavailable for gamePk ${g.gamePk}`);
      byGame.set(String(g.gamePk), gamePlayers);
      continue;
    }

    for (const side of ["away", "home"]) {
      const team =
        boxRaw?.gameData?.teams?.[side]?.abbreviation ||
        box.teams?.[side]?.team?.abbreviation ||
        box.teams?.[side]?.team?.fileCode ||
        box.teams?.[side]?.team?.teamCode ||
        "";
      const teamAbbr = upper(team);
      const players = box.teams?.[side]?.players || {};

      for (const x of Object.values(players)) {
        const rec = {
          gamePk: g.gamePk,
          player: x.person?.fullName || "",
          playerKey: normName(x.person?.fullName || ""),
          team: teamAbbr,
          batting: x.stats?.batting || {},
          pitching: x.stats?.pitching || {}
        };

        gamePlayers.push(rec);
        all.push(rec);
      }
    }

    byGame.set(String(g.gamePk), gamePlayers);
  }

  return { games, byGame, all };
}

function findBoxPlayer(row, index) {
  const target = normName(playerName(row));
  const team = rowTeam(row);
  const gp = rowGamePk(row);

  if (gp && index.byGame.has(String(gp))) {
    const inGame = index.byGame.get(String(gp));
    const exact = inGame.find(p => p.playerKey === target && (!team || p.team === team));
    if (exact) return exact;

    const nameOnly = inGame.filter(p => p.playerKey === target);
    if (nameOnly.length === 1) return nameOnly[0];
  }

  const candidates = index.all.filter(p =>
    p.playerKey === target &&
    (!team || p.team === team)
  );

  if (candidates.length === 1) return candidates[0];

  return null;
}

const boardRows = flatten(readJson(boardFile, []));
const fullBoardIndex = buildFullBoardIndex();
const index = buildBoxscoreIndex();

const rawDemons = [];
const seen = new Set();

for (const r of boardRows) {
  if (rowTier(r) !== "demon") continue;
  if (rowSide(r) !== "MORE") continue;
  if (!playerName(r) || !rowMarket(r) || rowLine(r) === null) continue;

  const k = uniqueKey(r);
  if (seen.has(k)) continue;
  seen.add(k);

  rawDemons.push(r);
}

const rows = rawDemons.map(r => {
  const market = rowMarket(r);
  const line = rowLine(r);
  const fullBoardMatch = fullBoardIndex.get(gradedKey(r));
  const boxPlayer = findBoxPlayer(r, index);

  let actual = null;
  let result = "UNMATCHED";
  let actualSource = null;

  if (fullBoardMatch) {
    actual = fullBoardMatch.actual;
    result = fullBoardMatch.result;
    actualSource = fullBoardMatch.source;
  } else if (boxPlayer) {
    actual = battingActual(market, boxPlayer.batting);

    if (actual !== null) {
      actualSource = "mlb_boxscore_batting";
    } else {
      actual = pitchingActual(market, boxPlayer.pitching);
      if (actual !== null) actualSource = "mlb_boxscore_pitching";
    }

    result = gradeMore(actual, line);
  }

  const disabled = String(r.disabledReason || "");
  const invalidContext =
    disabled.includes("player/team unresolved or mismatch") ||
    disabled.includes("resolved team not in game") ||
    disabled.includes("source team") ||
    disabled.includes("team unresolved") ||
    disabled.includes("team conflict") ||
    (
      disabled.includes("missing_or_zero_projection") &&
      !fullBoardMatch &&
      !boxPlayer
    );

  if (result === "UNMATCHED" && invalidContext) {
    result = "INVALID_CONTEXT";
  }

  return {
    player: playerName(r),
    team: rowTeam(r) || null,
    gamePk: fullBoardMatch?.gamePk || boxPlayer?.gamePk || rowGamePk(r),
    market,
    side: "MORE",
    line,
    actual,
    result,
    oddsTier: "demon",
    trackingOnly: r.trackingOnly === true,
    rankEligible: r.rankEligible ?? null,
    disabledReason: r.disabledReason || null,
    pricingStatus: r.pricingStatus || null,
    confidenceBucket: r.confidenceBucket || null,
    recommendedProb: r.recommendedProb ?? null,
    expectedValue: r.expectedValue ?? null,
    actualSource,
    matchedPlayer: boxPlayer?.player || null,
    matchedTeam: boxPlayer?.team || null
  };
});

const targetMarkets = [
  "hitter_fantasy_score",
  "strikeouts",
  "singles",
  "pitching_outs",
  "earned_runs_allowed",
  "hits_allowed",
  "walks_allowed"
];

const output = {
  date,
  generatedAt: new Date().toISOString(),
  boardFile,
  fullBoardFile,
  boxscoreGames: index.games.length,
  summary: {
    allRawDemonMore: summarize(rows),
    targetMarkets: summarize(rows.filter(r => targetMarkets.includes(r.market))),
    byMarket: groupSummary(rows, r => r.market),
    unmatchedByMarket: groupSummary(rows.filter(r => r.result === "UNMATCHED"), r => r.market),
    invalidContextByMarket: groupSummary(rows.filter(r => r.result === "INVALID_CONTEXT"), r => r.market),
    targetMarketBreakdown: groupSummary(rows.filter(r => targetMarkets.includes(r.market)), r => r.market)
  },
  rows
};

writeJson(outFile, output);

console.log("RAW DEMON PERFORMANCE REPORT");
console.log("-----------------------------");
console.log("date:", date);
console.log("boardFile:", boardFile);
console.log("boxscoreGames:", index.games.length);
console.log(JSON.stringify(output.summary, null, 2));
console.log("saved:", outFile);
