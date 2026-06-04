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

const SEASON = String(DATE).slice(0, 4);
const LIMIT = Number(process.env.BACKFILL_LIMIT || 175);

const OUT_DIR = "data/pickfinder";
const OUT_JSON = `${OUT_DIR}/pickfinder-style-backfill-${DATE}.json`;
const OUT_LATEST = `${OUT_DIR}/pickfinder-style-backfill-latest.json`;
const OUT_TXT = `${OUT_DIR}/pickfinder-style-backfill-${DATE}.txt`;
const OUT_LATEST_TXT = `${OUT_DIR}/pickfinder-style-backfill-latest.txt`;

const PLAYER_INDEX_FILE = `data/external/mlb-player-index-${SEASON}.json`;
const GAMELOG_CACHE_FILE = `data/external/mlb-gamelog-cache-${SEASON}.json`;

const SOURCES = [
  "outputs/production-candidates.json",
  "outputs/full-prop-confirmation/full-prop-confirmation-report-latest.json",
  "outputs/manual/pickfinder-current-context-enriched.json"
];

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "n/a";
  return `${Number(v).toFixed(1)}%`;
}

function rowsOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.allRows)) return data.allRows;
  if (Array.isArray(data.candidates)) return data.candidates;
  return [];
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "hits": "hits",
    "total bases": "bases",
    "bases": "bases",
    "hits runs rbis": "hrr",
    "hrr": "hrr",
    "runs": "runs",
    "rbis": "rbis",
    "rbi": "rbis",
    "walks": "walks",
    "home runs": "home_runs",
    "strikeouts": "strikeouts",
    "pitcher strikeouts": "strikeouts",
    "hits allowed": "hits_allowed",
    "walks allowed": "walks_allowed",
    "earned runs allowed": "earned_runs_allowed",
    "runs allowed": "runs_allowed",
    "pitching outs": "pitching_outs",
    "hitter fantasy score": "hitter_fantasy_score",
    "pitcher fantasy score": "pitcher_fantasy_score"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function propKey(r) {
  return [
    norm(r.player || r.playerName || r.name),
    String(r.team || "").toUpperCase(),
    marketNorm(r.market || r.stat),
    sideNorm(r.side),
    String(r.line ?? "")
  ].join("|");
}

function isPitcherMarket(market) {
  return [
    "strikeouts",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "runs_allowed",
    "pitching_outs",
    "pitcher_fantasy_score"
  ].includes(marketNorm(market));
}

function inningsToOuts(v) {
  if (v == null) return null;
  const s = String(v);
  if (!s.includes(".")) return Math.round(Number(s) * 3);
  const [whole, frac] = s.split(".");
  return Number(whole) * 3 + Number(frac || 0);
}

function actualForMarket(stat, market) {
  const m = marketNorm(market);
  if (!stat) return null;

  if (m === "hits") return num(stat.hits);
  if (m === "bases") return num(stat.totalBases);
  if (m === "hrr") return (num(stat.hits) || 0) + (num(stat.runs) || 0) + (num(stat.rbi) || 0);
  if (m === "runs") return num(stat.runs);
  if (m === "rbis") return num(stat.rbi);
  if (m === "walks") return num(stat.baseOnBalls);
  if (m === "home_runs") return num(stat.homeRuns);

  if (m === "strikeouts") return num(stat.strikeOuts);
  if (m === "hits_allowed") return num(stat.hits);
  if (m === "walks_allowed") return num(stat.baseOnBalls);
  if (m === "earned_runs_allowed") return num(stat.earnedRuns);
  if (m === "runs_allowed") return num(stat.runs);
  if (m === "pitching_outs") return inningsToOuts(stat.inningsPitched);

  if (m === "hitter_fantasy_score") {
    const singles =
      (num(stat.hits) || 0) -
      (num(stat.doubles) || 0) -
      (num(stat.triples) || 0) -
      (num(stat.homeRuns) || 0);
    return (
      singles * 3 +
      (num(stat.doubles) || 0) * 5 +
      (num(stat.triples) || 0) * 8 +
      (num(stat.homeRuns) || 0) * 10 +
      (num(stat.runs) || 0) * 2 +
      (num(stat.rbi) || 0) * 2 +
      (num(stat.baseOnBalls) || 0) * 2 +
      (num(stat.hitByPitch) || 0) * 2 +
      (num(stat.stolenBases) || 0) * 5
    );
  }

  if (m === "pitcher_fantasy_score") {
    return (
      (num(stat.wins) || 0) * 6 +
      (num(stat.qualityStarts) || 0) * 4 +
      (num(stat.earnedRuns) || 0) * -3 +
      (num(stat.strikeOuts) || 0) * 3 +
      (inningsToOuts(stat.inningsPitched) || 0)
    );
  }

  return null;
}

function cleared(actual, side, line) {
  const a = num(actual);
  const l = num(line);
  if (a == null || l == null) return null;
  const s = sideNorm(side);
  if (s === "MORE") return a > l;
  if (s === "LESS") return a < l;
  return null;
}

function hitRate(games, side, line, market) {
  const vals = games
    .map(g => actualForMarket(g.stat, market))
    .filter(v => v != null);

  if (!vals.length) return { n: 0, hits: 0, rate: null, avg: null };

  let hits = 0;
  for (const v of vals) {
    if (cleared(v, side, line)) hits++;
  }

  return {
    n: vals.length,
    hits,
    rate: hits / vals.length,
    avg: vals.reduce((a, b) => a + b, 0) / vals.length
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return await res.json();
}

async function loadPlayerIndex() {
  const cached = readJson(PLAYER_INDEX_FILE, null);
  if (cached?.people?.length) return cached.people;

  const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=${SEASON}`;
  const data = await fetchJson(url);
  writeJson(PLAYER_INDEX_FILE, data);
  return data.people || [];
}

async function findPlayer(player, index) {
  const n = norm(player);
  return index.find(p => norm(p.fullName) === n) ||
    index.find(p => norm(p.fullName).includes(n) || n.includes(norm(p.fullName))) ||
    null;
}

async function getGameLog(playerId, group, cache) {
  const key = `${playerId}|${group}|${SEASON}`;
  if (cache[key]) return cache[key];

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=${group}&season=${SEASON}`;
  const data = await fetchJson(url);
  const splits = data?.stats?.[0]?.splits || [];
  cache[key] = splits;
  return splits;
}

function gameDate(g) {
  return String(g.date || g.gameDate || "");
}

function beforeSlate(g) {
  const d = gameDate(g).slice(0, 10);
  return d && d < DATE;
}

function homeAwayOfGame(g) {
  if (typeof g.isHome === "boolean") return g.isHome ? "home" : "away";
  if (g.isHome === "true") return "home";
  if (g.isHome === "false") return "away";
  return "";
}

function opponentName(g) {
  return g.opponent?.name || g.opponent?.abbreviation || "";
}

function loadTargetRows() {
  const out = [];
  for (const file of SOURCES) {
    const data = readJson(file, null);
    for (const r of rowsOf(data)) {
      const player = r.player || r.playerName || r.name;
      const market = marketNorm(r.market || r.stat);
      const side = sideNorm(r.side);
      const line = num(r.line);
      if (!player || !market || !side || line == null) continue;
      out.push({ ...r, sourceFile: file });
    }
  }

  const byKey = new Map();
  for (const r of out) {
    const key = propKey(r);
    const old = byKey.get(key);
    if (!old) {
      byKey.set(key, r);
      continue;
    }

    const score = x =>
      (x.hardenedClass === "CORE" ? 100 : 0) +
      (x.hardenedClass === "LEAN" ? 90 : 0) +
      (x.hardenedClass === "LESS_CONTROLLED_WATCH" ? 80 : 0) +
      (x.hardenedClass === "CONTROLLED_WATCH" ? 75 : 0) +
      (x.decision === "KEEP_SMALL_LEAN" ? 70 : 0) +
      (num(x.prob) || 0);

    if (score(r) > score(old)) byKey.set(key, r);
  }

  return [...byKey.values()]
    .filter(r => ["CORE", "LEAN", "LESS_CONTROLLED_WATCH", "CONTROLLED_WATCH", "WATCHLIST", "KEEP_SMALL_LEAN", "WATCH_ONLY", "RESEARCH_PLUS", "SHADOW_BLOCKED", "BLOCKED", "RESEARCH", "BOARD", undefined].includes(r.hardenedClass || r.decision || "BOARD"))
    .sort((a, b) => (num(b.prob) || 0) - (num(a.prob) || 0))
    .slice(0, LIMIT);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync("data/external", { recursive: true });

  const targets = loadTargetRows();
  const playerIndex = await loadPlayerIndex();
  const cache = readJson(GAMELOG_CACHE_FILE, {});

  const rows = [];
  let matchedPlayers = 0;
  let missedPlayers = 0;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const player = r.player || r.playerName || r.name;
    const market = marketNorm(r.market || r.stat);
    const side = sideNorm(r.side);
    const line = num(r.line);
    const group = isPitcherMarket(market) ? "pitching" : "hitting";

    const p = await findPlayer(player, playerIndex);
    if (!p?.id) {
      missedPlayers++;
      rows.push({
        player,
        team: r.team || null,
        market,
        side,
        line,
        status: "PLAYER_NOT_FOUND"
      });
      continue;
    }

    matchedPlayers++;

    const log = await getGameLog(p.id, group, cache);
    const games = log
      .filter(beforeSlate)
      .sort((a, b) => gameDate(b).localeCompare(gameDate(a)));

    const l5 = hitRate(games.slice(0, 5), side, line, market);
    const l10 = hitRate(games.slice(0, 10), side, line, market);
    const l15 = hitRate(games.slice(0, 15), side, line, market);
    const season = hitRate(games, side, line, market);

    const currentHomeAway = String(r.homeAway || r.currentHomeAway || "").toLowerCase();
    const haGames = currentHomeAway
      ? games.filter(g => homeAwayOfGame(g) === currentHomeAway)
      : [];
    const homeAway = hitRate(haGames, side, line, market);

    const opposingPitcher = r.opposingPitcher || r.currentOpposingPitcher || "";
    const vsPitcherGames = opposingPitcher
      ? games.filter(g => norm(opponentName(g)).includes(norm(r.opponent || "")))
      : [];
    const vsPitcher = hitRate(vsPitcherGames, side, line, market);

    const hasCheckedSample = [l5, l10, l15, season, homeAway, vsPitcher]
      .some(split => split && Number(split.n || 0) > 0);

    const pfStatus =
      season.n >= 20 && l10.n >= 10 && l10.rate >= 0.6 && season.rate >= 0.6
        ? "PF_CONFIRMED"
        : hasCheckedSample
          ? "PF_WEAK"
          : "PF_NOT_CHECKED";

    rows.push({
      player,
      team: r.team || null,
      market,
      side,
      line,
      tier: r.tier || r.oddsTier || null,
      modelClass: r.hardenedClass || r.class || r.decision || null,
      prob: r.prob ?? null,
      edge: r.edge ?? null,
      books: r.books ?? null,
      grade: r.grade ?? null,
      opponent: r.opponent || null,
      homeAway: currentHomeAway || null,
      opposingPitcher: opposingPitcher || null,
      opposingPitcherHand: r.opposingPitcherHand || r.currentPitcherHand || null,
      mlbPlayerId: p.id,
      status: "OK",
      pfStatus,
      l5,
      l10,
      l15,
      season,
      splitHomeAway: homeAway,
      vsPitcher,
      sampleNotes: {
        seasonSample: season.n,
        currentBoardBackfill: true,
        compactOnly: true,
        source: "MLB Stats API gameLog"
      }
    });
  }

  writeJson(GAMELOG_CACHE_FILE, cache);

  const byStatus = {};
  for (const r of rows) byStatus[r.pfStatus || r.status || "UNKNOWN"] = (byStatus[r.pfStatus || r.status || "UNKNOWN"] || 0) + 1;

  const output = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    mode: "COMPACT_CURRENT_SLATE_PICKFINDER_STYLE_BACKFILL",
    policy: {
      officialPromotion: false,
      rawGameLogsStoredInOutput: false,
      compactAggregateOnly: true
    },
    sourceFiles: SOURCES,
    targetRows: targets.length,
    matchedPlayers,
    missedPlayers,
    byStatus,
    rows
  };

  writeJson(OUT_JSON, output);
  writeJson(OUT_LATEST, output);

  const lines = [];
  lines.push("PICKFINDER-STYLE COMPACT BACKFILL");
  lines.push("=================================");
  lines.push(`date=${DATE}`);
  lines.push(`targetRows=${targets.length}`);
  lines.push(`matchedPlayers=${matchedPlayers}`);
  lines.push(`missedPlayers=${missedPlayers}`);
  lines.push(`byStatus=${JSON.stringify(byStatus)}`);
  lines.push("");
  lines.push("TOP CONFIRMED");
  lines.push("-------------");

  const confirmed = rows
    .filter(r => r.pfStatus === "PF_CONFIRMED")
    .sort((a, b) => (b.l10?.rate || 0) - (a.l10?.rate || 0))
    .slice(0, 25);

  if (!confirmed.length) lines.push("none");
  for (const r of confirmed) {
    lines.push(
      `${r.player} | ${r.team || "n/a"} | ${r.market} ${r.side} ${r.line} | ` +
      `L5=${pct((r.l5?.rate ?? null) * 100)} n=${r.l5?.n || 0} | ` +
      `L10=${pct((r.l10?.rate ?? null) * 100)} n=${r.l10?.n || 0} | ` +
      `L15=${pct((r.l15?.rate ?? null) * 100)} n=${r.l15?.n || 0} | ` +
      `Season=${pct((r.season?.rate ?? null) * 100)} n=${r.season?.n || 0} | ` +
      `HA=${pct((r.splitHomeAway?.rate ?? null) * 100)} n=${r.splitHomeAway?.n || 0}`
    );
  }

  lines.push("");
  lines.push("POLICY");
  lines.push("------");
  lines.push("Backfill is confirmation/research only. It does not create official plays.");
  lines.push("Output is compact aggregates only; raw game logs stay in local cache.");

  fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");
  fs.writeFileSync(OUT_LATEST_TXT, lines.join("\n") + "\n");

  console.log(lines.join("\n"));
  console.log(`saved: ${OUT_JSON}`);
  console.log(`saved: ${OUT_LATEST}`);
  console.log(`saved: ${OUT_TXT}`);
  console.log(`saved: ${OUT_LATEST_TXT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
