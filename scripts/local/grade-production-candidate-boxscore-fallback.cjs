const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

const OUT = `outputs/history/${DATE}-production-hitter-boxscore-grades.json`;
const CACHE_DIR = "data/cache/mlb-boxscores";

const PRODUCTION_FILES = [
  `outputs/production-candidates-${DATE}.json`,
  "outputs/production-candidates.json"
];

const SOURCE_FILES = [
  "outputs/priced-board.json",
  "outputs/slips-distribution-enriched.json",
  "outputs/blocked-final-candidates.json",
  "outputs/lean-watchlist-candidates.json",
  "outputs/lean-final-slips.json",
  "outputs/final-slips.json",
  "outputs/slips-priced.json",
  "outputs/slips.json"
];

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
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "total bases": "bases",
    "bases": "bases",
    "hits runs rbis": "hrr",
    "hits runs rbi": "hrr",
    "hrr": "hrr",
    "hits": "hits",
    "singles": "singles",
    "doubles": "doubles",
    "triples": "triples",
    "home runs": "home_runs",
    "home run": "home_runs",
    "hr": "home_runs",
    "runs": "runs",
    "rbis": "rbis",
    "rbi": "rbis",
    "walks": "walks",
    "base on balls": "walks",
    "stolen bases": "stolen_bases",
    "hitter fantasy score": "hitter_fantasy_score",
    "fantasy score": "hitter_fantasy_score",
    "hitter strikeouts": "hitter_strikeouts"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function candidateKey(r) {
  return [
    norm(r.player || r.playerName || r.name),
    marketNorm(r.market || r.stat || r.statType),
    sideNorm(r.side || r.pick || r.recommendedSide),
    String(num(r.line ?? r.ppLine ?? r.prizepicksLine, ""))
  ].join("|");
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    v.player ||
    v.playerName ||
    v.name ||
    v.market ||
    v.stat ||
    v.side ||
    v.line ||
    v.legs ||
    v.candidates ||
    v.rows
  ) {
    out.push(v);
  }

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }

  return out;
}

function getClassRows(report) {
  if (!report) return [];
  if (Array.isArray(report)) return report;

  const out = [];
  const classMap = [
    ["CORE", report.core || report.coreCandidates],
    ["LEAN", report.lean || report.leanCandidates],
    ["WATCHLIST", report.watchlist || report.watchlistCandidates],
    ["HIGH_PROBABILITY_WATCH", report.highProbabilityWatch || report.highProbabilityWatchCandidates],
    ["RESEARCH", report.research || report.researchCandidates],
    ["SHADOW_BLOCKED", report.shadowBlocked || report.shadowBlockedCandidates],
    ["BLOCKED", report.blocked || report.blockedCandidates]
  ];

  for (const [cls, rows] of classMap) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) out.push({ ...row, class: row.class || cls });
  }

  if (out.length) return out;
  if (Array.isArray(report.all)) return report.all;
  if (Array.isArray(report.rows)) return report.rows;
  if (Array.isArray(report.candidates)) return report.candidates;

  return [];
}

function isHitterBoxscoreMarket(row) {
  const m = marketNorm(row.market || row.stat || row.statType);
  return [
    "bases",
    "hits",
    "singles",
    "doubles",
    "triples",
    "home_runs",
    "runs",
    "rbis",
    "walks",
    "stolen_bases",
    "hrr",
    "hitter_fantasy_score",
    "hitter_strikeouts"
  ].includes(m);
}

function isPhase8Unpriced(row) {
  const cls = String(row.class || row.classification || "").toUpperCase();
  const support = String(row.support || row.marketSupportFlag || row.priceCoverageTier || "").toUpperCase();
  return cls === "SHADOW_BLOCKED" || support === "PHASE8_UNPRICED";
}

function extractGamePk(row) {
  return num(
    row.gamePk ??
    row.resolvedGamePk ??
    row.game_id ??
    row.gameId ??
    row.mlbGamePk ??
    row.sourceCandidate?.gamePk ??
    row.sourceCandidate?.resolvedGamePk,
    null
  );
}

function battingActual(market, batting) {
  const hits = num(batting.hits, 0);
  const doubles = num(batting.doubles, 0);
  const triples = num(batting.triples, 0);
  const homeRuns = num(batting.homeRuns, 0);
  const runs = num(batting.runs, 0);
  const rbis = num(batting.rbi ?? batting.rbis, 0);
  const walks = num(batting.baseOnBalls ?? batting.walks, 0);
  const stolenBases = num(batting.stolenBases, 0);
  const strikeouts = num(batting.strikeOuts ?? batting.strikeouts, 0);
  const hitByPitch = num(batting.hitByPitch, 0);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const bases = singles + (2 * doubles) + (3 * triples) + (4 * homeRuns);
  const fantasy =
    (singles * 3) +
    (doubles * 5) +
    (triples * 8) +
    (homeRuns * 10) +
    (runs * 2) +
    (rbis * 2) +
    (walks * 2) +
    (hitByPitch * 2) +
    (stolenBases * 5);

  const values = {
    bases,
    hits,
    singles,
    doubles,
    triples,
    home_runs: homeRuns,
    runs,
    rbis,
    walks,
    stolen_bases: stolenBases,
    hrr: hits + runs + rbis,
    hitter_fantasy_score: fantasy,
    hitter_strikeouts: strikeouts
  };

  return values[market] ?? null;
}

function resultFromActual(actual, line, side) {
  if (actual === null || line === null || !side) return "UNMATCHED";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNMATCHED";
}

async function fetchBoxscore(gamePk) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = `${CACHE_DIR}/${gamePk}.json`;

  const cached = readJson(cacheFile, null);
  if (cached) return cached;

  const url = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB boxscore fetch failed ${gamePk}: ${res.status}`);
  const data = await res.json();

  writeJson(cacheFile, data);
  return data;
}

function gameIsFinal(feed) {
  const state = String(feed?.gameData?.status?.abstractGameState || "").toLowerCase();
  const detailed = String(feed?.gameData?.status?.detailedState || "").toLowerCase();
  return state === "final" || detailed.includes("final");
}

function playerBattingFromFeed(feed, playerName) {
  const teams = feed?.liveData?.boxscore?.teams || {};
  const players = [
    ...Object.values(teams.away?.players || {}),
    ...Object.values(teams.home?.players || {})
  ];

  const wanted = norm(playerName);
  let player =
    players.find(p => norm(p?.person?.fullName) === wanted) ||
    players.find(p => norm(p?.person?.boxscoreName) === wanted) ||
    players.find(p => norm(p?.person?.fullName).includes(wanted) || wanted.includes(norm(p?.person?.fullName)));

  if (!player) return null;

  return player.stats?.batting || {};
}

function buildSourceLookup() {
  const byKey = new Map();

  for (const file of SOURCE_FILES) {
    const data = readJson(file, null);
    if (!data) continue;

    for (const row of flatten(data, [])) {
      if (!row || !isHitterBoxscoreMarket(row)) continue;
      const k = candidateKey(row);
      if (!k || k.startsWith("||")) continue;

      const gamePk = extractGamePk(row);
      if (gamePk === null) continue;

      if (!byKey.has(k)) {
        byKey.set(k, { ...row, sourceLookupFile: file, gamePk });
      }
    }
  }

  return byKey;
}

async function main() {
  const candidateFile = PRODUCTION_FILES.find(f => fs.existsSync(f));
  if (!candidateFile) {
    console.error(`No production candidates file found for ${DATE}`);
    process.exit(1);
  }

  const report = readJson(candidateFile, null);
  const candidates = getClassRows(report)
    .filter(r => r && isHitterBoxscoreMarket(r))
    .filter(r => !isPhase8Unpriced(r));

  const sourceByKey = buildSourceLookup();
  const boxscoreCache = new Map();
  const grades = [];
  const misses = [];

  for (const c of candidates) {
    const k = candidateKey(c);
    const source = sourceByKey.get(k) || c.sourceCandidate || c;
    const gamePk = extractGamePk(source);

    if (gamePk === null) {
      misses.push({ player: c.player, market: c.market, side: c.side, line: c.line, reason: "missing_gamePk", key: k });
      grades.push({
        date: DATE,
        player: c.player,
        team: c.team,
        game: c.game,
        market: marketNorm(c.market || c.stat),
        side: sideNorm(c.side),
        line: c.line,
        result: "UNMATCHED",
        actual: null,
        reason: "missing_gamePk",
        source: "production_hitter_boxscore_fallback"
      });
      continue;
    }

    if (!boxscoreCache.has(gamePk)) {
      try {
        boxscoreCache.set(gamePk, await fetchBoxscore(gamePk));
      } catch (err) {
        boxscoreCache.set(gamePk, { fetchError: err.message });
      }
    }

    const feed = boxscoreCache.get(gamePk);
    if (feed.fetchError) {
      misses.push({ player: c.player, market: c.market, side: c.side, line: c.line, gamePk, reason: feed.fetchError, key: k });
      continue;
    }

    if (!gameIsFinal(feed)) {
      grades.push({
        date: DATE,
        player: c.player,
        team: c.team,
        game: c.game,
        gamePk,
        market: marketNorm(c.market || c.stat),
        side: sideNorm(c.side),
        line: c.line,
        result: "PENDING",
        actual: null,
        reason: "game_not_final",
        source: "production_hitter_boxscore_fallback"
      });
      continue;
    }

    const batting = playerBattingFromFeed(feed, c.player);
    if (!batting) {
      misses.push({ player: c.player, market: c.market, side: c.side, line: c.line, gamePk, reason: "player_not_found_in_boxscore", key: k });
      grades.push({
        date: DATE,
        player: c.player,
        team: c.team,
        game: c.game,
        gamePk,
        market: marketNorm(c.market || c.stat),
        side: sideNorm(c.side),
        line: c.line,
        result: "UNMATCHED",
        actual: null,
        reason: "player_not_found_in_boxscore",
        source: "production_hitter_boxscore_fallback"
      });
      continue;
    }

    const market = marketNorm(c.market || c.stat);
    const side = sideNorm(c.side);
    const line = num(c.line, null);
    const actual = battingActual(market, batting);
    const result = resultFromActual(actual, line, side);

    grades.push({
      date: DATE,
      player: c.player,
      team: c.team,
      game: c.game,
      gamePk,
      market,
      side,
      line,
      result,
      actual,
      hits: num(batting.hits, 0),
      runs: num(batting.runs, 0),
      rbis: num(batting.rbi ?? batting.rbis, 0),
      doubles: num(batting.doubles, 0),
      triples: num(batting.triples, 0),
      homeRuns: num(batting.homeRuns, 0),
      walks: num(batting.baseOnBalls ?? batting.walks, 0),
      stolenBases: num(batting.stolenBases, 0),
      strikeouts: num(batting.strikeOuts ?? batting.strikeouts, 0),
      source: "production_hitter_boxscore_fallback",
      sourceLookupFile: source.sourceLookupFile || null,
      key: k
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    candidateFile,
    checked: candidates.length,
    written: grades.length,
    gamesFetched: boxscoreCache.size,
    hit: grades.filter(r => r.result === "HIT").length,
    miss: grades.filter(r => r.result === "MISS").length,
    push: grades.filter(r => r.result === "PUSH").length,
    pending: grades.filter(r => r.result === "PENDING").length,
    unmatched: grades.filter(r => r.result === "UNMATCHED").length,
    misses
  };

  writeJson(OUT, { summary, rows: grades });

  console.log("PRODUCTION HITTER BOXSCORE FALLBACK GRADER");
  console.log("==========================================");
  console.log(summary);
  console.table(
    grades
      .filter(r => r.result !== "UNMATCHED")
      .slice(0, 30)
      .map(r => ({
        player: r.player,
        market: r.market,
        side: r.side,
        line: r.line,
        actual: r.actual,
        result: r.result,
        gamePk: r.gamePk
      }))
  );
  console.log(`saved: ${OUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
