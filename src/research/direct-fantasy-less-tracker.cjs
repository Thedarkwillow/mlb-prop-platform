const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = {
  pricedBoard: "outputs/priced-board.json",
  out: `outputs/direct-fantasy-less-tracker-${date}.json`,
  latest: "outputs/direct-fantasy-less-tracker-latest.json",
  txt: `outputs/direct-fantasy-less-tracker-${date}.txt`,
  latestTxt: "outputs/direct-fantasy-less-tracker-latest.txt"
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function normName(v) {
  return norm(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function marketOf(row) {
  const raw = norm(row.market ?? row.stat ?? row.type ?? row.statType ?? row.stat_type);
  if (raw.includes("pitcher") && raw.includes("fantasy")) return "pitcher_fantasy_score";
  if (raw.includes("hitter") && raw.includes("fantasy")) return "hitter_fantasy_score";
  if (raw === "fantasy score" || raw === "fantasy_score") return "fantasy_score";
  return raw;
}

function sideOf(row) {
  const raw = String(
    row.side ??
    row.recommendedSide ??
    row.direction ??
    row.pick ??
    row.projectionSide ??
    row.recommendation ??
    ""
  ).trim().toUpperCase();

  if (raw === "OVER") return "MORE";
  if (raw === "UNDER") return "LESS";
  return raw;
}

function lineOf(row) {
  return num(row.line ?? row.ppLine ?? row.target ?? row.projectionLine, null);
}

function lineBucket(line) {
  const n = num(line, null);
  if (n === null) return "unknown";
  if (n < 3) return "<3";
  if (n <= 4.5) return "3-4.5";
  if (n <= 6.5) return "5-6.5";
  if (n <= 8.5) return "7-8.5";
  if (n <= 10.5) return "9-10.5";
  if (n <= 12.5) return "11-12.5";
  return "13+";
}

function fetchJson(url) {
  const variants = [
    url,
    url.includes("/api/v1/game/") ? url.replace("/api/v1/game/", "/api/v1.1/game/") : null,
    url.includes("/boxscore") && !url.includes("?") ? `${url}?language=en` : null,
    url.includes("/api/v1/game/") && url.includes("/boxscore") && !url.includes("?")
      ? `${url.replace("/api/v1/game/", "/api/v1.1/game/")}?language=en`
      : null,
    url.includes("/schedule?") && !url.includes("hydrate=")
      ? `${url}&hydrate=team,linescore,probablePitcher`
      : null
  ].filter(Boolean);

  for (const candidate of [...new Set(variants)]) {
    try {
      const raw = execFileSync("curl", [
        "-fsSL",
        "-H", "accept: application/json,text/plain,*/*",
        "-H", "user-agent: Mozilla/5.0 mlb-prop-platform fantasy-less-tracker",
        candidate
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15000
      });
      return JSON.parse(raw);
    } catch {
      // Try next MLB endpoint variant.
    }
  }

  return null;
}


function normalizeGame(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .replace(/\s*@\s*/g, " @ ")
    .trim()
    .toUpperCase();
}

function reverseGameKey(game) {
  const g = normalizeGame(game);
  const parts = g.split(" @ ").map(x => x.trim()).filter(Boolean);
  if (parts.length !== 2) return g;
  return `${parts[1]} @ ${parts[0]}`;
}

function buildGamePkRepairMap(board) {
  const map = new Map();

  for (const row of board) {
    const gamePk = row.gamePk || row.resolvedGamePk || row.mlbGamePk;
    if (!gamePk) continue;

    const games = [
      row.game,
      row.resolvedGame,
      row.matchup,
      row.rawGame
    ].filter(Boolean);

    for (const game of games) {
      const key = normalizeGame(game);
      if (key) map.set(key, gamePk);

      const rev = reverseGameKey(game);
      if (rev) map.set(rev, gamePk);
    }
  }

  return map;
}

function repairGamePk(row, gamePkRepairMap) {
  const direct = row.gamePk || row.resolvedGamePk || row.mlbGamePk;
  if (direct) return direct;

  const games = [
    row.game,
    row.resolvedGame,
    row.matchup,
    row.rawGame
  ].filter(Boolean);

  for (const game of games) {
    const key = normalizeGame(game);
    if (gamePkRepairMap.has(key)) return gamePkRepairMap.get(key);

    const rev = reverseGameKey(game);
    if (gamePkRepairMap.has(rev)) return gamePkRepairMap.get(rev);
  }

  return null;
}


function buildGameStatusMap(date) {
  const schedule = fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore,probablePitcher`);
  const map = new Map();

  for (const d of schedule?.dates || []) {
    for (const g of d.games || []) {
      const gamePk = String(g.gamePk || "");
      if (!gamePk) continue;

      const abstractState = String(g.status?.abstractGameState || "");
      const detailedState = String(g.status?.detailedState || "");
      const codedGameState = String(g.status?.codedGameState || "");
      const statusCode = String(g.status?.statusCode || "");

      const combined = `${abstractState} ${detailedState} ${codedGameState} ${statusCode}`.toLowerCase();

      const isFinal =
        abstractState === "Final" ||
        detailedState === "Final" ||
        detailedState === "Game Over" ||
        statusCode === "F" ||
        statusCode === "O" ||
        combined.includes("final") ||
        combined.includes("game over");

      const isStarted =
        abstractState === "Live" ||
        abstractState === "Final" ||
        ["I", "M", "N", "O", "F"].includes(statusCode) ||
        combined.includes("in progress") ||
        combined.includes("delayed") ||
        combined.includes("final") ||
        combined.includes("game over");

      map.set(gamePk, {
        gamePk: Number(gamePk),
        abstractState,
        detailedState,
        codedGameState,
        statusCode,
        isStarted,
        isFinal
      });
    }
  }

  return map;
}

function getPlayerStatsFromBoxscore(box, playerName) {
  const target = normName(playerName);
  const teams = [box?.teams?.away, box?.teams?.home].filter(Boolean);

  for (const tm of teams) {
    for (const p of Object.values(tm.players || {})) {
      const fullName = p.person?.fullName || "";
      if (normName(fullName) !== target) continue;

      return {
        fullName,
        batting: p.stats?.batting || {},
        pitching: p.stats?.pitching || {}
      };
    }
  }

  return null;
}

function pitcherFantasyScore(stats = {}) {
  const win = num(stats.wins ?? stats.win, 0);
  const qs = num(stats.qualityStarts ?? stats.qualityStart, 0);
  const er = num(stats.earnedRuns, 0);
  const strikeouts = num(stats.strikeOuts ?? stats.strikeouts, 0);
  const outs = num(stats.outs, null);

  let resolvedOuts = outs;
  if (resolvedOuts === null && stats.inningsPitched) {
    resolvedOuts = parseInningsToOuts(stats.inningsPitched);
  }
  if (resolvedOuts === null) resolvedOuts = 0;

  return win * 6 + qs * 4 - er * 3 + strikeouts * 3 + resolvedOuts;
}

function parseInningsToOuts(ip) {
  const raw = String(ip ?? "").trim();
  if (!raw) return null;
  const [whole, frac = "0"] = raw.split(".");
  const innings = Number(whole);
  const partial = Number(frac);
  if (!Number.isFinite(innings)) return null;
  if (![0, 1, 2].includes(partial)) return innings * 3;
  return innings * 3 + partial;
}

function hitterFantasyScore(stats = {}) {
  const hits = num(stats.hits, 0);
  const doubles = num(stats.doubles, 0);
  const triples = num(stats.triples, 0);
  const homeRuns = num(stats.homeRuns, 0);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const runs = num(stats.runs, 0);
  const rbi = num(stats.rbi ?? stats.rbis, 0);
  const walks = num(stats.baseOnBalls ?? stats.walks, 0);
  const hbp = num(stats.hitByPitch, 0);
  const sb = num(stats.stolenBases, 0);

  return (
    singles * 3 +
    doubles * 5 +
    triples * 8 +
    homeRuns * 10 +
    runs * 2 +
    rbi * 2 +
    walks * 2 +
    hbp * 2 +
    sb * 5
  );
}

function fantasyScore(market, found) {
  if (market === "pitcher_fantasy_score") return pitcherFantasyScore(found.pitching);
  if (market === "hitter_fantasy_score") return hitterFantasyScore(found.batting);
  return null;
}

function grade(actual, line, side) {
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return "UNMATCHED";
  if (actual === line) return "PUSH";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  return "UNMATCHED";
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const unmatched = rows.filter(r => r.result === "UNMATCHED").length;
  const pending = rows.filter(r => r.result === "PENDING").length;
  const denom = hits + misses;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
    pending,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : 0,
    roi: denom ? Number(((hits - misses) / denom).toFixed(4)) : 0
  };
}

function groupSummary(rows, keyFn) {
  const m = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }

  return [...m.entries()]
    .map(([key, rows]) => ({ key, ...summarize(rows) }))
    .sort((a, b) => b.rows - a.rows);
}

function main() {
  const board = readJson(FILES.pricedBoard, []);
  const gameStatuses = buildGameStatusMap(date);
  const gamePkRepairMap = buildGamePkRepairMap(board);
  const boxscores = new Map();

  const candidates = board
    .filter(row => String(row.recordType || "merged_prop") === "merged_prop")
    .filter(row => ["pitcher_fantasy_score", "hitter_fantasy_score"].includes(marketOf(row)))
    .map(row => ({
      ...row,
      market: marketOf(row),
      side: sideOf(row),
      line: lineOf(row)
    }))
    .filter(row => row.side === "LESS")
    .filter(row => row.line !== null);

  const rows = candidates.map(row => {
    const gamePk = repairGamePk(row, gamePkRepairMap);
    const status = gamePk ? gameStatuses.get(String(gamePk)) : null;

    let actual = null;
    let result = "PENDING";
    let matchStatus = "PENDING_GAME_NOT_FINAL";
    let matchedName = null;

    if (!gamePk) {
      result = "UNMATCHED";
      matchStatus = "MISSING_GAMEPK";
    } else if (!status) {
      if (!boxscores.has(gamePk)) {
        boxscores.set(gamePk, fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`));
      }
      const box = boxscores.get(gamePk);
      const found = box ? getPlayerStatsFromBoxscore(box, row.player) : null;
      if (!box) {
        result = "PENDING";
        matchStatus = "GAME_STATUS_UNKNOWN_BOXSCORE_FETCH_FAILED";
      } else if (!found) {
        result = "UNMATCHED";
        matchStatus = "GAME_STATUS_UNKNOWN_PLAYER_NOT_FOUND_IN_BOXSCORE";
      } else {
        matchedName = found.fullName;
        actual = fantasyScore(row.market, found);
        if (actual === null) {
          result = "UNMATCHED";
          matchStatus = "FANTASY_SCORE_UNSUPPORTED";
        } else {
          actual = Number(actual.toFixed(2));
          result = grade(actual, row.line, row.side);
          matchStatus = "GAME_STATUS_UNKNOWN_BOXSCORE_FALLBACK";
        }
      }
    } else if (!status.isFinal) {
      result = "PENDING";
      matchStatus = status.isStarted ? "GAME_NOT_FINAL" : "GAME_NOT_STARTED";
    } else {
      if (!boxscores.has(gamePk)) {
        boxscores.set(gamePk, fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`));
      }

      const box = boxscores.get(gamePk);
      const found = box ? getPlayerStatsFromBoxscore(box, row.player) : null;

      if (!box) {
        result = "UNMATCHED";
        matchStatus = "BOXSCORE_FETCH_FAILED";
      } else if (!found) {
        result = "UNMATCHED";
        matchStatus = "PLAYER_NOT_FOUND_IN_FINAL_BOXSCORE";
      } else {
        matchedName = found.fullName;
        actual = fantasyScore(row.market, found);

        if (actual === null) {
          result = "UNMATCHED";
          matchStatus = "FANTASY_SCORE_UNSUPPORTED";
        } else {
          actual = Number(actual.toFixed(2));
          result = grade(actual, row.line, row.side);
          matchStatus = "FINAL_BOX_SCORE_DIRECT";
        }
      }
    }

    return {
      date,
      player: row.player,
      team: row.team || row.resolvedTeam || null,
      game: row.game || row.resolvedGame || null,
      gamePk,
      gamePkRepaired: Boolean(gamePk && !(row.gamePk || row.resolvedGamePk || row.mlbGamePk)),
      market: row.market,
      side: row.side,
      line: row.line,
      oddsTier: row.oddsTier || row.tier || null,
      projection: num(row.projection, null),
      recommendedProb: num(row.recommendedProb, null),
      expectedValue: num(row.expectedValue, null),
      projectionSource: row.fantasyProjectionSource || row.projectionSource || null,
      fallbackTrackOnly: Boolean(row.fantasyFallbackTrackOnly),
      actual,
      result,
      matchStatus,
      matchedName,
      gameStatus: status || null,
      lineBucket: lineBucket(row.line),
      source: FILES.pricedBoard
    };
  });

  const summary = summarize(rows);
  const byMarket = groupSummary(rows, r => r.market);
  const byLineBucket = groupSummary(rows, r => `${r.market}|${r.lineBucket}`);
  const byTier = groupSummary(rows, r => String(r.oddsTier || "unknown").toLowerCase());
  const byMatchStatus = groupSummary(rows, r => r.matchStatus);

  const output = {
    date,
    generatedAt: new Date().toISOString(),
    policy: {
      playable: false,
      directTrackedOnly: true,
      note: "Fantasy LESS remains direct-tracked only. Pregame/live rows stay PENDING until MLB schedule marks game final."
    },
    sourceCounts: {
      fantasyLessCandidates: rows.length,
      gameStatuses: gameStatuses.size
    },
    summary,
    byMarket,
    byLineBucket,
    byTier,
    byMatchStatus,
    rows
  };

  const lines = [];
  lines.push("DIRECT FANTASY LESS TRACKER v5");
  lines.push("==============================");
  lines.push(`date: ${date}`);
  lines.push(`generatedAt: ${output.generatedAt}`);
  lines.push("");
  lines.push("POLICY");
  lines.push("------");
  lines.push("Fantasy LESS = direct tracked only");
  lines.push("Playable = false");
  lines.push("Pregame/live rows stay PENDING until MLB schedule marks game final.");
  lines.push("");
  lines.push("SUMMARY");
  lines.push("-------");
  lines.push(`rows=${summary.rows}`);
  lines.push(`graded=${summary.graded}`);
  lines.push(`hits=${summary.hits}`);
  lines.push(`misses=${summary.misses}`);
  lines.push(`pushes=${summary.pushes}`);
  lines.push(`pending=${summary.pending}`);
  lines.push(`unmatched=${summary.unmatched}`);
  lines.push(`hitRate=${summary.hitRate}`);
  lines.push(`roi=${summary.roi}`);
  lines.push("");
  lines.push("BY MARKET");
  lines.push("---------");
  for (const b of byMarket) {
    lines.push(`${b.key}: rows=${b.rows} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} pending=${b.pending} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)}`);
  }
  lines.push("");
  lines.push("BY TIER");
  lines.push("-------");
  for (const b of byTier) {
    lines.push(`${b.key}: rows=${b.rows} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} pending=${b.pending} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)}`);
  }
  lines.push("");
  lines.push("BY MATCH STATUS");
  lines.push("---------------");
  for (const b of byMatchStatus) {
    lines.push(`${b.key}: rows=${b.rows} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} pending=${b.pending} unmatched=${b.unmatched}`);
  }
  lines.push("");
  lines.push("BY LINE BUCKET");
  lines.push("--------------");
  for (const b of byLineBucket) {
    lines.push(`${b.key}: rows=${b.rows} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} pending=${b.pending} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)}`);
  }
  lines.push("");
  lines.push("SAMPLE ROWS");
  lines.push("-----------");
  for (const r of rows.slice(0, 30)) {
    lines.push(`- ${r.player} | ${r.market} ${r.side} ${r.line} | actual=${r.actual ?? "n/a"} | result=${r.result} | bucket=${r.lineBucket} | match=${r.matchStatus}`);
  }

  writeJson(FILES.out, output);
  writeJson(FILES.latest, output);
  writeText(FILES.txt, lines.join("\n"));
  writeText(FILES.latestTxt, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log("");
  console.log("saved:", FILES.out);
  console.log("saved:", FILES.latest);
  console.log("saved:", FILES.txt);
  console.log("saved:", FILES.latestTxt);
}

main();
