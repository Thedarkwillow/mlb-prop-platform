const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = {
  lean: "outputs/lean-final-slips.json",
  production: "outputs/production-candidates.json",
  sideBiasWatch: "outputs/side-bias-override-watch-latest.json",
  fullBoard: `outputs/history/${date}-full-board-graded.json`,
  allMarkets: "outputs/all-markets-graded.json",
  gradedResults: "outputs/graded-results.json",
  liveGraded: `outputs/live/mlb-live-inning-graded-${date}.json`,
  pricedBoard: "outputs/priced-board.json",
  finalSlips: `outputs/final-slips-${date}.json`,
  out: `outputs/history/${date}-decision-layer-grades.json`,
  latest: "outputs/decision-layer-grades-latest.json"
};

const today = new Date().toISOString().slice(0, 10);
const FORCE_OVERWRITE =
  process.argv.includes("--force") ||
  String(process.env.npm_config_force || "").toLowerCase() === "true" ||
  String(process.env.FORCE_DECISION_GRADE_OVERWRITE || "").toLowerCase() === "true";
const PREVIEW_MODE =
  process.argv.includes("--preview") ||
  String(process.env.npm_config_preview || "").toLowerCase() === "true" ||
  String(process.env.DECISION_GRADE_PREVIEW || "").toLowerCase() === "true";
const IS_HISTORICAL_DATE = date !== today;
function previewDecisionGradeFile(file) {
  return String(file || "").replace(/\.json$/i, "-preview.json");
}

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

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function upper(v) {
  return String(v ?? "").trim().toUpperCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function firstNumber(...vals) {
  for (const v of vals) {
    const n = num(v, null);
    if (n !== null) return n;
  }
  return null;
}

function getPlayer(row) {
  return row.player || row.name || row.playerName || row.player_name || row.description || "";
}

function getMarket(row) {
  return row.market || row.statType || row.stat_type || row.type || row.normalizedMarket || "";
}

function getSide(row) {
  return upper(row.side || row.direction || row.pick || row.recommendation || "");
}

function getLine(row) {
  return firstNumber(row.line, row.ppLine, row.projectionLine, row.targetLine);
}

function getActual(row) {
  return firstNumber(
    row.actual,
    row.actualValue,
    row.resultValue,
    row.stat,
    row.final,
    row.value,
    row.boxscoreActual,
    row.gradedActual
  );
}

function getResult(row) {
  return upper(row.result || row.outcome || row.gradeResult || row.status || "");
}

function keyParts(row) {
  return {
    player: norm(getPlayer(row)),
    market: norm(getMarket(row)),
    side: getSide(row),
    line: getLine(row)
  };
}

function exactKey(row) {
  const k = keyParts(row);
  return [k.player, k.market, k.side, String(k.line ?? "")].join("|");
}

function playerMarketKey(row) {
  const k = keyParts(row);
  return [k.player, k.market].join("|");
}


function contextKeyForRow(row) {
  const k = keyParts(row);
  return [k.player, k.market, k.side, String(k.line ?? "")].join("|");
}

function flattenRows(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flattenRows(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flattenRows(val, out);
  }
  return out;
}

function buildContextIndex() {
  const files = [
    "outputs/lean-final-slips.json",
    "outputs/blocked-final-candidates.json",
    "outputs/final-slips.json",
    "outputs/playable-final-slips.json"
  ];

  const idx = new Map();

  for (const file of files) {
    const raw = readJson(file, null);
    if (!raw) continue;

    for (const row of flattenRows(raw)) {
      const k = contextKeyForRow(row);
      if (!k || k === "|||") continue;

      const payload = {
        resolvedTeam: row.resolvedTeam || row.team || null,
        resolvedGame: row.resolvedGame || row.game || row.matchup || null,
        resolvedGamePk: row.resolvedGamePk || row.gamePk || row.gamePK || row.mlbGamePk || row.mlb_game_pk || null,
        homeAway: row.homeAway || row.home_away || null,
        pitcherHand: row.pitcherHand || row.opposingPitcherHand || null,
        opposingPitcher: row.opposingPitcher || row.probablePitcher || null,
        opposingPitcherId: row.opposingPitcherId || row.probablePitcherId || null,
        pitcherMatchupSource: row.pitcherMatchupSource || null
      };

      const hasContext =
        payload.homeAway ||
        payload.pitcherHand ||
        payload.opposingPitcher ||
        payload.opposingPitcherId;

      if (!hasContext) continue;
      if (!idx.has(k)) idx.set(k, payload);
    }
  }

  return idx;
}

const MATCHUP_CONTEXT_INDEX = buildContextIndex();

function matchupContextForRow(row) {
  return MATCHUP_CONTEXT_INDEX.get(contextKeyForRow(row)) || {};
}


function playerKey(row) {
  return norm(getPlayer(row));
}

function gradeByActual(side, line, actual) {
  const s = upper(side);
  const l = num(line, null);
  const a = num(actual, null);

  if (!s || l === null || a === null) return "UNMATCHED";
  if (a === l) return "PUSH";
  if (s === "MORE") return a > l ? "HIT" : "MISS";
  if (s === "LESS") return a < l ? "HIT" : "MISS";
  return "UNMATCHED";
}

function normalizeRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.graded)) return raw.graded;
  if (Array.isArray(raw.results)) return raw.results;
  if (Array.isArray(raw.props)) return raw.props;
  if (Array.isArray(raw.data)) return raw.data;
  return [];
}

function flattenRows(raw) {
  const rows = normalizeRows(raw);
  const out = [];

  for (const row of rows) {
    out.push(row);

    if (row && typeof row === "object") {
      for (const k of ["legs", "entries", "props", "rows", "results"]) {
        if (Array.isArray(row[k])) {
          for (const child of row[k]) out.push({ ...child, parent: row.name || row.id || null });
        }
      }
    }
  }

  return out;
}

function buildIndexes(sources) {
  const exact = new Map();
  const byPlayerMarket = new Map();
  const byPlayer = new Map();

  for (const source of sources) {
    for (const raw of source.rows) {
      const row = { ...raw, __source: source.name };
      const player = norm(getPlayer(row));
      const market = norm(getMarket(row));
      if (!player) continue;

      const eKey = exactKey(row);
      if (!exact.has(eKey)) exact.set(eKey, []);
      exact.get(eKey).push(row);

      if (market) {
        const pmKey = playerMarketKey(row);
        if (!byPlayerMarket.has(pmKey)) byPlayerMarket.set(pmKey, []);
        byPlayerMarket.get(pmKey).push(row);
      }

      if (!byPlayer.has(player)) byPlayer.set(player, []);
      byPlayer.get(player).push(row);
    }
  }

  return { exact, byPlayerMarket, byPlayer };
}

function usableActualRow(row) {
  return getActual(row) !== null || ["HIT", "MISS", "PUSH"].includes(getResult(row));
}


function directGamePkOf(row) {
  return row?.gamePk ||
    row?.gamePK ||
    row?.mlbGamePk ||
    row?.mlb_game_pk ||
    row?.resolvedGamePk ||
    null;
}
function normalizeGameKey(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .replace(/\s*@\s*/g, " @ ")
    .trim()
    .toUpperCase();
}
function reverseGameKeyValue(game) {
  const g = normalizeGameKey(game);
  const parts = g.split(" @ ").map(x => x.trim()).filter(Boolean);
  if (parts.length !== 2) return g;
  return `${parts[1]} @ ${parts[0]}`;
}
function gameKeyOf(row) {
  return normalizeGameKey(
    row?.resolvedGame ||
    row?.game ||
    row?.matchup ||
    row?.rawGame ||
    ""
  );
}
function gameCompatibleForFallback(target, candidate) {
  const targetGamePk = directGamePkOf(target);
  const candidateGamePk = directGamePkOf(candidate);
  if (targetGamePk && candidateGamePk) {
    return String(targetGamePk) === String(candidateGamePk);
  }

  const targetGame = gameKeyOf(target);
  const candidateGame = gameKeyOf(candidate);
  if (targetGame && candidateGame) {
    return targetGame === candidateGame || reverseGameKeyValue(targetGame) === candidateGame;
  }

  return false;
}
function actualResultRow(row) {
  return getActual(row) !== null &&
    ["HIT", "MISS", "PUSH"].includes(getResult(row));
}

function resolveExact(row, indexes) {
  const matches = indexes.exact.get(exactKey(row)) || [];
  return matches.find(usableActualRow) || null;
}


function resolveSameMarketActual(row, indexes) {
  const k = keyParts(row);
  const candidates = (indexes.byPlayerMarket.get([k.player, k.market].join("|")) || [])
    .filter(r => actualResultRow(r))
    .filter(r => gameCompatibleForFallback(row, r));

  if (!candidates.length) return null;

  const line = num(k.line, null);
  const side = String(k.side || "").toUpperCase();

  const exactCompatible = candidates.find(r =>
    num(getLine(r), null) === line &&
    String(getSide(r) || "").toUpperCase() === side
  );
  if (exactCompatible) return exactCompatible;

  const sameLineCompatible = candidates.find(r => num(getLine(r), null) === line);
  if (sameLineCompatible) return sameLineCompatible;

  return null;
}



function normalizeName(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function readUrlJson(url) {
  const variants = [
    url,
    url.includes("/api/v1/game/") ? url.replace("/api/v1/game/", "/api/v1.1/game/") : null,
    url.includes("/boxscore") && !url.includes("?") ? `${url}?language=en` : null,
    url.includes("/api/v1/game/") && url.includes("/boxscore") && !url.includes("?")
      ? `${url.replace("/api/v1/game/", "/api/v1.1/game/")}?language=en`
      : null
  ].filter(Boolean);

  for (const candidate of [...new Set(variants)]) {
    try {
      const raw = execFileSync("curl", [
        "-fsSL",
        "-H", "accept: application/json,text/plain,*/*",
        "-H", "user-agent: Mozilla/5.0 mlb-prop-platform decision-grader",
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

function readMlbGameJson(gamePk, endpoint) {
  const base = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/${endpoint}`;
  return readUrlJson(base) ||
    readUrlJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/${endpoint}`) ||
    readUrlJson(`${base}?language=en`) ||
    readUrlJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/${endpoint}?language=en`);
}

function findMlbPlayerInGame(gamePk, playerName) {
  const target = normalizeName(playerName);

  const box = readMlbGameJson(gamePk, "boxscore");
  for (const side of ["home", "away"]) {
    const players = box?.teams?.[side]?.players || {};
    for (const player of Object.values(players)) {
      if (normalizeName(player?.person?.fullName) === target) {
        return {
          player,
          side,
          source: `mlb_boxscore:${gamePk}`
        };
      }
    }
  }

  const live = readMlbGameJson(gamePk, "feed/live");
  const players = live?.gameData?.players || {};
  for (const player of Object.values(players)) {
    if (normalizeName(player?.fullName) !== target) continue;
    const id = player?.id;
    const boxPlayers = live?.liveData?.boxscore?.teams || {};
    for (const side of ["home", "away"]) {
      const keyed = boxPlayers?.[side]?.players?.[`ID${id}`];
      if (keyed) {
        return {
          player: keyed,
          side,
          source: `mlb_feed_live:${gamePk}`
        };
      }
    }
  }

  return null;
}


function resolveFromPlayableSlipGrades(row) {
  const k = keyParts(row);

  const files = [
    `outputs/playable-final-slips-graded-${date}.json`,
    `outputs/history/${date}-playable-final-slips-graded.json`
  ];

  for (const file of files) {
    const data = readJson(file, null);
    if (!data) continue;

    const slips = Array.isArray(data)
      ? data
      : Array.isArray(data.slips)
        ? data.slips
        : [];

    const legs = [];

    for (const slip of slips) {
      for (const leg of Array.isArray(slip.legs) ? slip.legs : []) {
        legs.push({
          ...leg,
          slipName: slip.name || null,
          slipResult: slip.graded?.result || slip.result || null
        });
      }
    }

    for (const leg of legs) {
      const player = normalizeName(leg.player || leg.playerName || leg.name);
      const market = String(leg.market || leg.stat || "").toLowerCase().trim();
      const side = String(leg.side || leg.recommendedSide || leg.pickSide || "").toUpperCase().trim();
      const line = num(leg.line ?? leg.ppLine ?? leg.projectionLine, null);

      if (player !== k.player) continue;
      if (market !== k.market) continue;
      if (side !== String(k.side || "").toUpperCase()) continue;
      if (line !== num(k.line, null)) continue;

      const actual = firstNumber(
        leg.actual,
        leg.statActual,
        leg.actualValue,
        leg.finalActual,
        leg.gradedActual
      );

      const result = String(
        leg.result ||
        leg.gradeResult ||
        leg.outcome ||
        ""
      ).toUpperCase();

      if (actual === null && !["HIT", "MISS", "PUSH"].includes(result)) continue;

      return {
        ...leg,
        player: getPlayer(row),
        market: k.market,
        side: k.side,
        line: k.line,
        actual,
        result,
        __source: `${file}:playable_slip_grade`
      };
    }
  }

  return null;
}


function findGamePkForDecisionRow(row) {
  const directGamePk =
    row.gamePk ||
    row.gamePK ||
    row.mlbGamePk ||
    row.mlb_game_pk ||
    row.resolvedGamePk;
  if (directGamePk) return directGamePk;

  const targetPlayer = normalizeName(getPlayer(row));
  const targetGame = norm(row.game || row.matchup || "");

  const localSources = [
    flattenRows(readJson(FILES.pricedBoard, [])),
    flattenRows(readJson(FILES.finalSlips, [])),
    flattenRows(readJson(FILES.lean, [])),
    flattenRows(readJson(FILES.production, {})),
    ...(IS_HISTORICAL_DATE ? [
      historicalSnapshotRows("priced-board.json"),
      historicalSnapshotRows("final-slips.json"),
      historicalSnapshotRows("blocked-final-candidates.json"),
      historicalSnapshotRows("playable-final-slips.json"),
      flattenRows(readJson(`outputs/lean-final-slips-${date}.json`, {}))
    ] : [])
  ];

  for (const rows of localSources) {
    for (const r of rows) {
      if (normalizeName(getPlayer(r)) !== targetPlayer) continue;

      const gp = r.gamePk || r.gamePK || r.mlbGamePk || r.mlb_game_pk;
      if (gp) return gp;

      const rg = norm(r.game || r.matchup || "");
      if (targetGame && rg && rg === targetGame) {
        const maybe = r.gamePk || r.gamePK || r.mlbGamePk || r.mlb_game_pk;
        if (maybe) return maybe;
      }
    }
  }

  return null;
}

function resolvePitchingOutsFromMlbBoxscore(row) {
  const k = keyParts(row);
  if (k.market !== "pitching_outs") return null;
  const gamePk = findGamePkForDecisionRow(row);
  if (!gamePk) return null;

  const found = findMlbPlayerInGame(gamePk, getPlayer(row));
  if (!found) return null;

  const pitching = found.player?.stats?.pitching || {};
  if (!pitching || !Object.keys(pitching).length) return null;

  const ip = pitching.inningsPitched ?? pitching.ip ?? null;
  const outs = parseIpToOuts(ip);
  if (outs === null) return null;

  return {
    player: getPlayer(row),
    market: "pitching_outs",
    side: getSide(row),
    line: getLine(row),
    actual: outs,
    gamePk,
    inningsPitched: ip,
    __source: `${found.source}:pitching_outs`
  };
}
function resolvePitcherRunsFromMlbBoxscore(row) {
  const k = keyParts(row);
  if (k.market !== "runs" && k.market !== "earned_runs_allowed" && k.market !== "runs_allowed") return null;
  const gamePk = findGamePkForDecisionRow(row);
  if (!gamePk) return null;

  const found = findMlbPlayerInGame(gamePk, getPlayer(row));
  if (!found) return null;

  const pitching = found.player?.stats?.pitching || {};
  if (!pitching || !Object.keys(pitching).length) return null;

  const actual =
    k.market === "earned_runs_allowed"
      ? firstNumber(pitching.earnedRuns, pitching.er, pitching.runs)
      : firstNumber(pitching.runs, pitching.r, pitching.earnedRuns, pitching.er);

  if (actual === null) return null;

  return {
    player: getPlayer(row),
    market: k.market,
    side: getSide(row),
    line: getLine(row),
    actual,
    gamePk,
    earnedRuns: firstNumber(pitching.earnedRuns, pitching.er),
    runsAllowed: firstNumber(pitching.runs, pitching.r),
    inningsPitched: pitching.inningsPitched ?? pitching.ip ?? null,
    __source: `${found.source}:pitcher_runs`
  };
}
function resolvePitcherWalksFromMlbBoxscore(row) {
  const k = keyParts(row);
  if (k.market !== "walks" && k.market !== "walks_allowed") return null;
  const gamePk = findGamePkForDecisionRow(row);
  if (!gamePk) return null;

  const found = findMlbPlayerInGame(gamePk, getPlayer(row));
  if (!found) return null;

  const pitching = found.player?.stats?.pitching || {};
  if (!pitching || !Object.keys(pitching).length) return null;

  const actual = firstNumber(pitching.baseOnBalls, pitching.walks, pitching.bb);
  if (actual === null) return null;

  return {
    player: getPlayer(row),
    market: k.market,
    side: getSide(row),
    line: getLine(row),
    actual,
    gamePk,
    walksAllowed: actual,
    inningsPitched: pitching.inningsPitched ?? pitching.ip ?? null,
    __source: `${found.source}:pitcher_walks`
  };
}
function resolveHitterBasesFromMlbBoxscore(row) {
  const k = keyParts(row);
  if (k.market !== "bases") return null;

  const gamePk = findGamePkForDecisionRow(row);
  if (!gamePk) return null;

  const box = readUrlJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
  if (!box?.teams) return null;

  const target = normalizeName(getPlayer(row));
  for (const side of ["home", "away"]) {
    const players = box.teams?.[side]?.players || {};
    for (const player of Object.values(players)) {
      const name = normalizeName(player?.person?.fullName);
      if (name !== target) continue;

      const batting = player?.stats?.batting || {};
      if (!batting || !Object.keys(batting).length) continue;

      let actual = firstNumber(batting.totalBases, batting.tb);
      if (actual === null) {
        const hits = firstNumber(batting.hits);
        if (hits !== null && num(getLine(row), null) === 0.5) actual = hits > 0 ? 1 : 0;
      }

      if (actual === null) return null;

      return {
        player: getPlayer(row),
        market: "bases",
        side: getSide(row),
        line: getLine(row),
        actual,
        gamePk,
        hits: firstNumber(batting.hits),
        totalBases: actual,
        __source: `mlb_boxscore:${gamePk}:hitter_bases`
      };
    }
  }
  return null;
}


function resolveBasesFromHits(row, indexes) {
  const k = keyParts(row);
  if (k.market !== "bases") return null;
  const hitRows = (indexes.byPlayerMarket.get([k.player, "hits"].join("|")) || [])
    .filter(r => actualResultRow(r))
    .filter(r => gameCompatibleForFallback(row, r));

  const hitActualRow = hitRows.find(r => getActual(r) !== null);
  if (!hitActualRow) return null;

  const hitsActual = getActual(hitActualRow);
  if (hitsActual === null) return null;

  /*
    Conservative derived fallback:
    If hits == 0, bases is definitely 0.
    If hits > 0, bases is at least 1.
    This is enough to grade bases MORE 0.5 and bases LESS 0.5.
    It is not used for higher bases lines.
    Must be same-game compatible to avoid cross-game player contamination.
  */
  if (num(row.line, null) === 0.5) {
    return {
      ...hitActualRow,
      market: "bases",
      actual: hitsActual > 0 ? 1 : 0,
      __source: `${hitActualRow.__source || "unknown"}:derived_bases_from_hits_same_game`
    };
  }
  return null;
}



function resolveHitsAllowedFromHitsAlias(row, indexes) {
  const k = keyParts(row);
  /*
    PrizePicks pitcher "hits" rows are pitcher hits allowed.
    Some reports normalize them as market=hits, while graded sources
    store them as hits_allowed. This fallback fixes those unmatched
    pitcher hits LESS rows without affecting hitter hits rows.
    Must be same-game compatible to avoid cross-game player contamination.
  */
  if (k.market !== "hits") return null;
  const candidates = (indexes.byPlayerMarket.get([k.player, "hits_allowed"].join("|")) || [])
    .filter(r => actualResultRow(r))
    .filter(r => gameCompatibleForFallback(row, r));

  if (!candidates.length) return null;

  const line = num(k.line, null);
  const side = String(k.side || "").toUpperCase();

  const exact = candidates.find(r =>
    num(getLine(r), null) === line &&
    String(getSide(r) || "").toUpperCase() === side
  );
  if (exact) {
    return {
      ...exact,
      market: "hits_allowed",
      __source: `${exact.__source || "unknown"}:hits_allowed_alias_from_hits_same_game`
    };
  }

  const sameLine = candidates.find(r => num(getLine(r), null) === line);
  if (sameLine) {
    return {
      ...sameLine,
      market: "hits_allowed",
      __source: `${sameLine.__source || "unknown"}:hits_allowed_alias_from_hits_same_game_same_line`
    };
  }

  return null;
}




function resolveManualDecisionGradeRepair(row) {
  const repairs = readJson("src/research/manual-decision-grade-repairs.json", []);
  const k = keyParts(row);
  const line = num(k.line, null);
  const side = String(k.side || "").toUpperCase();

  const repair = repairs.find(r =>
    String(r.date || "") === String(date) &&
    norm(getPlayer(r)) === k.player &&
    norm(getMarket(r)) === k.market &&
    String(getSide(r) || "").toUpperCase() === side &&
    num(getLine(r), null) === line
  );

  if (!repair) return null;

  return {
    ...row,
    ...repair,
    player: getPlayer(row),
    market: k.market,
    side,
    line,
    actual: repair.actual === null || repair.actual === undefined ? null : repair.actual,
    result: String(repair.result || "UNMATCHED").toUpperCase(),
    matchMethod: repair.matchMethod || "manual_decision_grade_repair",
    matchedSource: null,
    matchedMarket: k.market,
    matchedSide: side,
    matchedLine: line,
    manualRepair: true,
    manualNote: repair.note || repair.manualNote || null,
    __source: "src/research/manual-decision-grade-repairs.json"
  };
}

function resolveSavedHistoricalExactProp(row) {
  if (!IS_HISTORICAL_DATE || !fs.existsSync(FILES.out)) return null;
  const savedRows = flattenRows(readJson(FILES.out, []));
  const k = keyParts(row);
  const line = num(k.line, null);
  const side = String(k.side || "").toUpperCase();

  const exact = savedRows.find(r => {
    if (
      norm(getPlayer(r)) !== k.player ||
      norm(getMarket(r)) !== k.market ||
      String(getSide(r) || "").toUpperCase() !== side ||
      num(getLine(r), null) !== line
    ) {
      return false;
    }

    const result = getResult(r);
    const actual = getActual(r);
    const method = String(r.matchMethod || r.method || "").toLowerCase();
    const note = String(r.manualNote || r.manualRepairNote || r.note || "").toLowerCase();
    const didNotPitch =
      method.includes("manual_verified_did_not_pitch") ||
      note.includes("did_not_pitch") ||
      note.includes("did not pitch");

    if (didNotPitch) return true;
    return actual !== null && ["HIT", "MISS", "PUSH"].includes(result);
  });

  if (!exact) return null;

  const exactMethod = String(exact.matchMethod || exact.method || "").toLowerCase();
  const exactNote = String(exact.manualNote || exact.manualRepairNote || exact.note || "").toLowerCase();
  const didNotPitch =
    exactMethod.includes("manual_verified_did_not_pitch") ||
    exactNote.includes("did_not_pitch") ||
    exactNote.includes("did not pitch");

  if (didNotPitch) {
    return {
      ...exact,
      player: getPlayer(row),
      market: k.market,
      side,
      line,
      actual: null,
      result: "UNMATCHED",
      matchMethod: "manual_verified_did_not_pitch",
      matchedSource: null,
      manualNote: exact.manualNote || exact.manualRepairNote || exact.note || "manual_verified_did_not_pitch",
      __source: `${FILES.out}:saved_historical_exact_prop`
    };
  }

  return {
    ...exact,
    player: getPlayer(row),
    market: k.market,
    side,
    line,
    __source: `${FILES.out}:saved_historical_exact_prop`
  };
}

function resolveDecisionRow(row, indexes) {
  const k = keyParts(row);

  const manualRepair = resolveManualDecisionGradeRepair(row);
  if (manualRepair) {
    return { match: manualRepair, method: manualRepair.matchMethod || "manual_decision_grade_repair" };
  }

  /*
    Exact already-graded rows must come first.
    fullBoard is source #1, so this uses correct MLB grading before weaker fallbacks.
  */
  const savedHistoricalExact = resolveSavedHistoricalExactProp(row);
  if (savedHistoricalExact) {
    return { match: savedHistoricalExact, method: "saved_historical_exact_prop" };
  }

  const exact = resolveExact(row, indexes);
  if (exact) return { match: exact, method: "exact_player_market_side_line" };

  /*
    Prefer already-graded playable slips when available.
    This avoids re-fetching MLB boxscores and keeps decision-layer grading
    aligned with grade-final-slips.cjs.
  */
  if (k.market === "pitching_outs") {
    const playableGrade = resolveFromPlayableSlipGrades(row);
    if (playableGrade) return { match: playableGrade, method: "playable_slip_grade" };

    const pitchingOuts = resolvePitchingOutsFromMlbBoxscore(row);
    if (pitchingOuts) return { match: pitchingOuts, method: "mlb_boxscore_pitching_outs" };
  }

  if (k.market === "runs" || k.market === "earned_runs_allowed" || k.market === "runs_allowed") {
    const pitcherRuns = resolvePitcherRunsFromMlbBoxscore(row);
    if (pitcherRuns) return { match: pitcherRuns, method: "mlb_boxscore_pitcher_runs" };
  }

  if (k.market === "walks" || k.market === "walks_allowed") {
    const pitcherWalks = resolvePitcherWalksFromMlbBoxscore(row);
    if (pitcherWalks) return { match: pitcherWalks, method: "mlb_boxscore_pitcher_walks" };
  }

  if (k.market === "bases") {
    const hitterBases = resolveHitterBasesFromMlbBoxscore(row);
    if (hitterBases) return { match: hitterBases, method: "mlb_boxscore_hitter_bases" };
  }

  const sameMarket = resolveSameMarketActual(row, indexes);
  if (sameMarket) return { match: sameMarket, method: "same_player_market_actual" };

  const hitsAllowedAlias = resolveHitsAllowedFromHitsAlias(row, indexes);
  if (hitsAllowedAlias) return { match: hitsAllowedAlias, method: "hits_allowed_alias_from_hits" };

  /*
    Bases from hits is fallback only.
    It must not override exact full-board bases grades.
  */
  const basesFromHits = resolveBasesFromHits(row, indexes);
  if (basesFromHits) return { match: basesFromHits, method: "derived_bases_from_hits" };

  return { match: null, method: "unmatched" };
}

function compactRow(layer, row, indexes) {
  const resolved = resolveDecisionRow(row, indexes);
  const isManualUnmatchedRepair =
    resolved.match &&
    resolved.match.manualRepair === true &&
    getResult(resolved.match) === "UNMATCHED";
  const actual = isManualUnmatchedRepair
    ? null
    : (resolved.match ? getActual(resolved.match) : null);
  const line = getLine(row);
  const side = getSide(row);
  const matchupContext = matchupContextForRow(row);
  let result = "UNMATCHED";

  if (resolved.match) {
    const directResult = getResult(resolved.match);
    if (isManualUnmatchedRepair) {
      result = "UNMATCHED";
    } else if (resolved.method === "exact_player_market_side_line" && ["HIT", "MISS", "PUSH"].includes(directResult)) {
      result = directResult;
    } else if (resolved.match.manualRepair === true && ["HIT", "MISS", "PUSH"].includes(directResult)) {
      result = directResult;
    } else {
      result = gradeByActual(side, line, actual);
    }
  }

  return {
    layer,
    player: getPlayer(row),
    team: row.team || row.teamAbbr || row.team_abbr || null,
    game: row.game || row.matchup || null,
    gamePk: resolved.match
      ? (resolved.match.gamePk || resolved.match.gamePK || resolved.match.mlbGamePk || resolved.match.mlb_game_pk || null)
      : (row.gamePk || row.gamePK || row.mlbGamePk || row.mlb_game_pk || null),
    resolvedTeam: row.resolvedTeam || matchupContext.resolvedTeam || row.team || row.teamAbbr || row.team_abbr || null,
    resolvedGame: row.resolvedGame || matchupContext.resolvedGame || row.game || row.matchup || null,
    resolvedGamePk: row.resolvedGamePk || matchupContext.resolvedGamePk || row.gamePk || row.gamePK || row.mlbGamePk || row.mlb_game_pk || null,
    homeAway: row.homeAway || row.home_away || matchupContext.homeAway || null,
    pitcherHand: row.pitcherHand || row.opposingPitcherHand || matchupContext.pitcherHand || null,
    opposingPitcher: row.opposingPitcher || row.probablePitcher || matchupContext.opposingPitcher || null,
    opposingPitcherId: row.opposingPitcherId || row.probablePitcherId || matchupContext.opposingPitcherId || null,
    pitcherMatchupSource: row.pitcherMatchupSource || matchupContext.pitcherMatchupSource || null,
    market: getMarket(row),
    side,
    line,
    tier: row.oddsTier || row.tier || null,
    prob: firstNumber(row.prob, row.calibratedDistributionProb, row.recommendedProb),
    edge: firstNumber(row.edge, row.sportsbookAdjustedEdge, row.sportsbookEdge),
    books: firstNumber(row.books, row.sportsbookBookCount),
    support: row.support || row.marketSupportFlag || null,
    grade: row.grade || row.qualityGrade || null,
    sideBias: row.sideBias?.tier || row.fullBoardSideBias?.tier || row.sideBias || null,
    blockedReason: row.blockedReason || row.reason || null,
    result,
    actual,
    matchMethod: resolved.method,
    matchedSource: resolved.match?.__source || null,
    matchedMarket: resolved.match ? getMarket(resolved.match) : null,
    matchedSide: resolved.match ? getSide(resolved.match) : null,
    matchedLine: resolved.match ? getLine(resolved.match) : null
  };
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const unmatched = rows.filter(r => r.result === "UNMATCHED").length;
  const denom = hits + misses;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : null,
    roi: denom ? Number(((hits - misses) / denom).toFixed(4)) : null
  };
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function classOf(row) {
  return String(row.class || row.candidateClass || row.bucket || row.status || "").toUpperCase();
}

function pushUnique(rows, layer, sourceRows) {
  for (const r of asArray(sourceRows)) rows.push({ layer, row: r });
}


function historicalRunDirs() {
  const dir = `outputs/history/runs/${date}`;
  try {
    return fs.readdirSync(dir)
      .filter(name => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(name))
      .sort();
  } catch {
    return [];
  }
}

function historicalSnapshotRows(fileName) {
  const out = [];
  const dir = `outputs/history/runs/${date}`;
  for (const runId of historicalRunDirs()) {
    const file = `${dir}/${runId}/${fileName}`;
    const rows = flattenRows(readJson(file, []));
    for (const row of rows) {
      out.push({
        ...row,
        historicalRunId: runId,
        historicalSourceFile: file
      });
    }
  }
  return out;
}

function historicalDecisionInputs() {
  if (!IS_HISTORICAL_DATE) {
    return {
      leanReport: readJson(FILES.lean, {}),
      production: readJson(FILES.production, {}),
      sideBiasWatch: readJson(FILES.sideBiasWatch, {})
    };
  }

  const datedLeanFile = `outputs/lean-final-slips-${date}.json`;
  const leanReport = readJson(datedLeanFile, {});

  const blockedRows = historicalSnapshotRows("blocked-final-candidates.json");
  const finalRows = historicalSnapshotRows("final-slips.json");
  const playableRows = historicalSnapshotRows("playable-final-slips.json");

  return {
    leanReport,
    production: {
      blocked: blockedRows,
      blockedCandidates: blockedRows,
      candidates: finalRows,
      rows: [
        ...blockedRows,
        ...finalRows,
        ...playableRows
      ]
    },
    sideBiasWatch: {}
  };
}

function pickRows() {
  const decisionInputState = historicalDecisionInputs();
  const leanReport = decisionInputState.leanReport;
  const production = decisionInputState.production;
  const sideBiasWatch = decisionInputState.sideBiasWatch;

  const rows = [];

  pushUnique(rows, "ACTIONABLE_LEAN", leanReport.leans);

  pushUnique(rows, "CORE", production.core);
  pushUnique(rows, "CORE", production.coreCandidates);

  pushUnique(rows, "WATCHLIST", production.watchlist);
  pushUnique(rows, "WATCHLIST", production.watchlistCandidates);

  pushUnique(rows, "HIGH_PROBABILITY_WATCH", production.highProbabilityWatch);
  pushUnique(rows, "HIGH_PROBABILITY_WATCH", production.highProbabilityWatchCandidates);

  pushUnique(rows, "BLOCKED", production.blocked);
  pushUnique(rows, "BLOCKED", production.blockedCandidates);

  pushUnique(rows, "SIDE_BIAS_OVERRIDE_WATCH", sideBiasWatch.watch);

  const allRows = [
    ...asArray(production.all),
    ...asArray(production.candidates),
    ...asArray(production.rows)
  ];

  for (const r of allRows) {
    const c = classOf(r);
    if (c === "CORE") rows.push({ layer: "CORE", row: r });
    else if (c === "WATCHLIST") rows.push({ layer: "WATCHLIST", row: r });
    else if (c === "HIGH_PROBABILITY_WATCH") rows.push({ layer: "HIGH_PROBABILITY_WATCH", row: r });
    else if (c === "BLOCKED") rows.push({ layer: "BLOCKED", row: r });
    else if (c === "RESEARCH") rows.push({ layer: "RESEARCH", row: r });
  }

  const seen = new Set();
  return rows.filter(({ layer, row }) => {
    const k = [layer, exactKey(row)].join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sources = [
  { name: FILES.fullBoard, rows: flattenRows(readJson(FILES.fullBoard, [])) },
  { name: FILES.allMarkets, rows: flattenRows(readJson(FILES.allMarkets, [])) },
  { name: FILES.gradedResults, rows: flattenRows(readJson(FILES.gradedResults, [])) },
  { name: FILES.liveGraded, rows: flattenRows(readJson(FILES.liveGraded, [])) }
];

const indexes = buildIndexes(sources);
const decisionInputs = pickRows();
const rows = decisionInputs.map(({ layer, row }) => compactRow(layer, row, indexes));

const byLayer = {};
for (const r of rows) {
  if (!byLayer[r.layer]) byLayer[r.layer] = [];
  byLayer[r.layer].push(r);
}

const summary = Object.fromEntries(
  Object.entries(byLayer).map(([layer, layerRows]) => [layer, summarize(layerRows)])
);

const output = {
  date,
  generatedAt: new Date().toISOString(),
  files: FILES,
  sourceCounts: Object.fromEntries(sources.map(s => [s.name, s.rows.length])),
  summary,
  rows
};

if (
  IS_HISTORICAL_DATE &&
  fs.existsSync(FILES.out) &&
  !FORCE_OVERWRITE
) {
  if (!PREVIEW_MODE) {
    console.error("REFUSING TO OVERWRITE HISTORICAL DECISION GRADE");
    console.error(`date: ${date}`);
    console.error(`file: ${FILES.out}`);
    console.error("reason: historical file already exists");
    console.error("use --preview to write a preview file, or --force / FORCE_DECISION_GRADE_OVERWRITE=true to overwrite intentionally");
    process.exit(2);
  }

  const previewOut = previewDecisionGradeFile(FILES.out);
  writeJson(previewOut, output);
  console.log("saved preview:", previewOut);
} else {
  writeJson(FILES.out, output);
  if (!IS_HISTORICAL_DATE || FORCE_OVERWRITE) {
    writeJson(FILES.latest, output);
  }
}

console.log("DECISION LAYER GRADES");
console.log("---------------------");
console.log("date:", date);
console.log("sourceCounts:", output.sourceCounts);
console.log(summary);
console.table(rows.map(r => ({
  layer: r.layer,
  player: r.player,
  gamePk: r.gamePk,
  market: r.market,
  side: r.side,
  line: r.line,
  prob: r.prob,
  edge: r.edge,
  result: r.result,
  actual: r.actual,
  method: r.matchMethod,
  source: r.matchedSource
})));
console.log("saved:", FILES.out);
if (!IS_HISTORICAL_DATE || FORCE_OVERWRITE) {
  console.log("saved:", FILES.latest);
}
