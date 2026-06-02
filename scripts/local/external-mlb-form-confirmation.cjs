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
const OUT_DIR = "outputs/external-confirmation";
const OUT_JSON = `${OUT_DIR}/external-mlb-form-confirmation-${DATE}.json`;
const OUT_LATEST_JSON = `${OUT_DIR}/external-mlb-form-confirmation-latest.json`;
const OUT_TXT = `${OUT_DIR}/external-mlb-form-confirmation-${DATE}.txt`;
const OUT_LATEST_TXT = `${OUT_DIR}/external-mlb-form-confirmation-latest.txt`;
const CACHE_FILE = "data/external/mlb-player-search-cache.json";
const PLAYER_INDEX_FILE = `data/external/mlb-player-index-${SEASON}.json`;
const BOXSCORE_CACHE_FILE = `data/external/mlb-boxscore-cache-${SEASON}.json`;
const PLAYBYPLAY_CACHE_FILE = `data/external/mlb-playbyplay-cache-${SEASON}.json`;
let PLAYER_INDEX = null;
let BOXSCORE_CACHE = null;
let PLAYBYPLAY_CACHE = null;

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
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "n/a";
  return `${Number(v).toFixed(1)}%`;
}

function val(v) {
  if (v === null || v === undefined || v === "") return "n/a";
  return v;
}

function sideNorm(v) {
  const s = String(v ?? "").toUpperCase().trim();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  if (s === "MORE" || s === "LESS") return s;
  return "";
}

function marketNorm(v) {
  const s = norm(v);
  const map = {
    "hits runs rbis": "hrr",
    "hits+runs+rbis": "hrr",
    "hrr": "hrr",
    "total bases": "bases",
    "bases": "bases",
    "hits": "hits",
    "runs": "runs",
    "walks": "walks",
    "rbis": "rbis",
    "rbi": "rbis",
    "home runs": "home_runs",
    "hitter fantasy score": "hitter_fantasy_score",

    "strikeouts": "strikeouts",
    "pitcher strikeouts": "strikeouts",
    "hits allowed": "hits_allowed",
    "pitcher hits allowed": "hits_allowed",
    "walks allowed": "walks_allowed",
    "earned runs allowed": "earned_runs_allowed",
    "runs allowed": "runs_allowed",
    "pitching outs": "pitching_outs",
    "pitches thrown": "pitches_thrown",
    "pitcher fantasy score": "pitcher_fantasy_score"
  };
  return map[s] || s.replace(/\s+/g, "_");
}

function isPitcherMarket(market) {
  return [
    "strikeouts",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "runs_allowed",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score"
  ].includes(marketNorm(market));
}

function isPitcherPlayerInfo(playerInfo) {
  const pos = String(
    playerInfo?.primaryPosition ||
    playerInfo?.position ||
    playerInfo?.mlbPrimaryPosition ||
    ""
  ).toUpperCase();
  return pos === "P" || pos.includes("PITCH");
}

function pitcherAwareMarket(market, playerInfo = null, row = {}) {
  const m = marketNorm(market);
  const rowText = [
    row.playerType,
    row.position,
    row.playerPosition,
    row.sourceType,
    row.recordSourceType,
    row.market,
    row.stat
  ].map(x => String(x || "").toUpperCase()).join(" ");

  const pitcherLike =
    isPitcherPlayerInfo(playerInfo) ||
    rowText.includes("PITCHER") ||
    rowText.includes(" P ");

  if (!pitcherLike) return m;

  if (m === "hits") return "hits_allowed";
  if (m === "runs") return "runs_allowed";
  if (m === "walks") return "walks_allowed";
  if (m === "fantasy_score") return "pitcher_fantasy_score";
  if (m === "hitter_fantasy_score") return "pitcher_fantasy_score";

  return m;
}

function statGroupForMarket(market) {
  return isPitcherMarket(market) ? "pitching" : "hitting";
}

function playerOf(r) {
  return String(r.player || r.playerName || r.name || r.fullName || "").trim();
}

function getRowsArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.candidates)) return data.candidates;
  return [];
}

function loadTargets() {
  const confirm = readJson("outputs/full-prop-confirmation/full-prop-confirmation-report-latest.json", {});
  const rows = getRowsArray(confirm);

  return rows
    .filter(r => [
      "KEEP_OFFICIAL",
      "KEEP_SMALL_LEAN",
      "WATCH_ONLY",
      "WATCHLIST_PLUS",
      "OFFICIAL_REVIEW"
    ].includes(r.finalDecision))
    .map(r => ({
      decision: r.finalDecision,
      class: r.candidateClass || r.class || r.productionClass || "",
      confidence: r.confirmationConfidence || r.confidence || "",
      score: r.confirmationScore ?? r.score ?? null,
      player: playerOf(r),
      team: r.team || "",
      market: marketNorm(r.market || r.stat || ""),
      side: sideNorm(r.side || r.pick || ""),
      line: num(r.line ?? r.ppLine),
      tier: r.tier || r.oddsTier || "",
      prob: num(r.prob ?? r.calibratedProb ?? r.probability),
      edge: num(r.edge ?? r.adjEdge),
      books: r.books ?? r.bookCount ?? null,
      grade: r.grade || "",
      lineupStatus: r.lineupStatus ?? r.lineup ?? null,
      starts: r.lineupStarts ?? r.starts ?? null,
      battingOrder: r.battingOrder ?? r.bat ?? null,
      opponent: r.opponent || r.opp || "",
      game: r.game || r.gameString || "",
      homeAway: r.homeAway || r.location || r.home_away || "",
      opposingPitcher: r.opposingPitcher || r.opponentPitcher || r.probablePitcher || r.startingPitcher || r.oppPitcher || r.vsPitcher || "",
      opposingPitcherHand: r.opposingPitcherHand || r.opponentPitcherHand || r.probablePitcherHand || r.pitcherHand || "",
      pickfinderFound: !!r.pickfinderFound,
      pickfinderL5: r.pickfinderL5 ?? null,
      pickfinderL10: r.pickfinderL10 ?? null,
      pickfinderL15: r.pickfinderL15 ?? null,
      pickfinderSeason: r.pickfinderSeason ?? null,
      pickfinderVsPitcher: r.pickfinderVsPitcher ?? null
    }))
    .filter(r => r.player && r.market && r.side && r.line !== null);
}

function loadCache() {
  return readJson(CACHE_FILE, {});
}

function saveCache(cache) {
  writeJson(CACHE_FILE, cache);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "mlb-prop-platform external confirmation"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return await res.json();
}

async function loadPlayerIndex() {
  if (PLAYER_INDEX) return PLAYER_INDEX;

  const cached = readJson(PLAYER_INDEX_FILE);
  if (cached && Array.isArray(cached.people) && cached.people.length) {
    PLAYER_INDEX = cached.people;
    return PLAYER_INDEX;
  }

  const seasons = [SEASON, String(Number(SEASON) - 1)];
  const people = [];
  const seen = new Set();

  for (const season of seasons) {
    const url = `https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}`;
    try {
      const data = await fetchJson(url);
      for (const p of data.people || []) {
        if (!p || !p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        people.push(p);
      }
    } catch (err) {
      console.log(`player index fetch failed for ${season}: ${err.message}`);
    }
  }

  writeJson(PLAYER_INDEX_FILE, {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    people
  });

  PLAYER_INDEX = people;
  return PLAYER_INDEX;
}

function nameVariants(name) {
  const base = norm(name);
  return Array.from(new Set([
    base,
    base.replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim(),
    base.replace(/\bjunior\b/g, "jr").replace(/\s+/g, " ").trim()
  ].filter(Boolean)));
}

async function findPlayerId(player, cache) {
  const key = norm(player);
  if (cache[key]?.id || cache[key]?.found === false) return cache[key];

  const people = await loadPlayerIndex();
  const wanted = nameVariants(player);

  let best =
    people.find(p => wanted.includes(norm(p.fullName))) ||
    people.find(p => wanted.includes(norm(p.useName || ""))) ||
    people.find(p => wanted.includes(norm(`${p.firstName || ""} ${p.lastName || ""}`))) ||
    people.find(p => wanted.some(w => norm(p.fullName).includes(w) || w.includes(norm(p.fullName))));

  if (!best) {
    cache[key] = {
      id: null,
      fullName: player,
      found: false,
      searchedAt: new Date().toISOString(),
      source: "mlb_player_index"
    };
    return cache[key];
  }

  cache[key] = {
    id: best.id,
    fullName: best.fullName,
    primaryPosition: best.primaryPosition?.abbreviation || null,
    batSide: best.batSide?.code || null,
    pitchHand: best.pitchHand?.code || null,
    found: true,
    searchedAt: new Date().toISOString(),
    source: "mlb_player_index"
  };

  return cache[key];
}

async function getGameLog(playerId, group) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=${group}&season=${SEASON}`;
  const data = await fetchJson(url);
  const splits = data?.stats?.[0]?.splits || [];

  return splits
    .map(s => ({
      date: s.date || s.game?.gameDate || "",
      gamePk: s.game?.gamePk || s.gamePk || null,
      opponent: s.opponent?.name || s.opponent?.abbreviation || "",
      isHome: s.isHome,
      stat: s.stat || {}
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}


function loadBoxscoreCache() {
  if (BOXSCORE_CACHE) return BOXSCORE_CACHE;
  BOXSCORE_CACHE = readJson(BOXSCORE_CACHE_FILE, {});
  return BOXSCORE_CACHE;
}

function saveBoxscoreCache() {
  if (BOXSCORE_CACHE) writeJson(BOXSCORE_CACHE_FILE, BOXSCORE_CACHE);
}

function loadPlayByPlayCache() {
  if (PLAYBYPLAY_CACHE) return PLAYBYPLAY_CACHE;
  PLAYBYPLAY_CACHE = readJson(PLAYBYPLAY_CACHE_FILE, {});
  return PLAYBYPLAY_CACHE;
}

function savePlayByPlayCache() {
  if (PLAYBYPLAY_CACHE) writeJson(PLAYBYPLAY_CACHE_FILE, PLAYBYPLAY_CACHE);
}

async function getBoxscore(gamePk) {
  if (!gamePk) return null;
  const cache = loadBoxscoreCache();
  const key = String(gamePk);
  if (cache[key]) return cache[key];

  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
  const data = await fetchJson(url);
  cache[key] = data;
  return data;
}

async function getPlayByPlay(gamePk) {
  if (!gamePk) return null;
  const cache = loadPlayByPlayCache();
  const key = String(gamePk);
  if (cache[key]) return cache[key];

  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/playByPlay`;
  const data = await fetchJson(url);
  cache[key] = data;
  return data;
}

function firstPitcherIdFromBoxTeam(teamBox) {
  const ids = Array.isArray(teamBox?.pitchers) ? teamBox.pitchers : [];
  return ids.length ? ids[0] : null;
}

function playerFromBoxscore(box, id) {
  if (!box || !id) return null;
  const key = `ID${id}`;
  return box.teams?.home?.players?.[key] || box.teams?.away?.players?.[key] || null;
}

async function historicalOpponentStarterHand(gamePk, isHome) {
  try {
    const box = await getBoxscore(gamePk);
    const opponentSide = isHome ? "away" : "home";
    const oppTeam = box?.teams?.[opponentSide];
    const pitcherId = firstPitcherIdFromBoxTeam(oppTeam);
    const player = playerFromBoxscore(box, pitcherId);
    return {
      pitcherId,
      pitcherName: player?.person?.fullName || null,
      hand: player?.person?.pitchHand?.code || player?.person?.pitchHand?.description || null
    };
  } catch {
    return { pitcherId: null, pitcherName: null, hand: null };
  }
}

function inferCurrentHomeAway(row) {
  const direct = String(row.homeAway || row.home_away || row.location || "").toLowerCase();
  if (direct === "home" || direct === "away") return direct;

  const game = String(row.game || row.gameString || "");
  const team = String(row.team || "").trim();
  if (game.includes("@") && team) {
    const [away, home] = game.split("@").map(x => x.trim());
    if (away === team) return "away";
    if (home === team) return "home";
  }

  return null;
}

function extractNameLike(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.fullName || v.name || v.player || v.playerName || "";
  return "";
}

function pickOpposingPitcherName(row) {
  const keys = [
    "opposingPitcher",
    "opponentPitcher",
    "probablePitcher",
    "startingPitcher",
    "oppPitcher",
    "vsPitcher",
    "pitcherOpponent"
  ];

  for (const k of keys) {
    const name = extractNameLike(row[k]);
    if (name && norm(name) !== norm(row.player)) return name;
  }

  return "";
}

function paValueFromEvent(play, market) {
  const result = play?.result || {};
  const event = String(result.event || "").toLowerCase();
  const rbi = Number(result.rbi || 0);

  if (market === "hits" || market === "bases" || market === "hrr") {
    if (event === "single") return market === "bases" ? 1 : 1;
    if (event === "double") return market === "bases" ? 2 : 1;
    if (event === "triple") return market === "bases" ? 3 : 1;
    if (event === "home run") return market === "bases" ? 4 : 1;
    return 0;
  }

  if (market === "walks") {
    return event.includes("walk") ? 1 : 0;
  }

  if (market === "rbis") {
    return rbi;
  }

  if (market === "home_runs") {
    return event === "home run" ? 1 : 0;
  }

  return null;
}

async function calcVsPitcherHistory(row, playerInfo, currentOpposingPitcherName, games) {
  if (isPitcherMarket(row.market)) {
    return { available: false, reason: "pitcher_market" };
  }

  if (!currentOpposingPitcherName) {
    return { available: false, reason: "missing_current_opposing_pitcher" };
  }

  const cache = loadCache();
  const pitcherInfo = await findPlayerId(currentOpposingPitcherName, cache);
  saveCache(cache);

  if (!pitcherInfo?.id || !playerInfo?.id) {
    return { available: false, reason: "pitcher_or_batter_id_missing", pitcherName: currentOpposingPitcherName };
  }

  const plays = [];

  for (const g of games) {
    if (!g.gamePk) continue;

    try {
      const pbp = await getPlayByPlay(g.gamePk);
      const allPlays = Array.isArray(pbp?.allPlays) ? pbp.allPlays : [];

      for (const play of allPlays) {
        const batterId = play?.matchup?.batter?.id;
        const pitcherId = play?.matchup?.pitcher?.id;
        if (Number(batterId) !== Number(playerInfo.id)) continue;
        if (Number(pitcherId) !== Number(pitcherInfo.id)) continue;

        const value = paValueFromEvent(play, row.market);
        plays.push({
          gamePk: g.gamePk,
          date: g.date,
          event: play?.result?.event || "",
          description: play?.result?.description || "",
          rbi: play?.result?.rbi || 0,
          value
        });
      }
    } catch {}
  }

  const usable = plays.filter(p => p.value !== null && p.value !== undefined);
  const value = usable.reduce((a, b) => a + Number(b.value || 0), 0);

  return {
    available: true,
    batterId: playerInfo.id,
    pitcherId: pitcherInfo.id,
    pitcherName: pitcherInfo.fullName || currentOpposingPitcherName,
    plateAppearances: plays.length,
    value,
    clear: cleared(value, row.side, row.line),
    events: plays.slice(-25)
  };
}

async function addHistoricalStarterHands(games) {
  const out = [];
  for (const g of games) {
    const starter = await historicalOpponentStarterHand(g.gamePk, g.isHome);
    out.push({
      ...g,
      opponentStarterPitcherId: starter.pitcherId,
      opponentStarterPitcherName: starter.pitcherName,
      opponentStarterHand: starter.hand
    });
  }
  return out;
}

function splitGamesByHomeAway(games, currentHomeAway) {
  if (!currentHomeAway) return [];
  const wantHome = currentHomeAway === "home";
  return games.filter(g => Boolean(g.isHome) === wantHome);
}

function splitGamesByPitcherHand(games, hand) {
  if (!hand) return [];
  const h = String(hand).toUpperCase()[0];
  return games.filter(g => String(g.opponentStarterHand || "").toUpperCase()[0] === h);
}


function inningsToOuts(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!s.includes(".")) return Math.round(Number(s) * 3);
  const [whole, frac] = s.split(".");
  const outs = Number(whole) * 3 + Number(frac || 0);
  return Number.isFinite(outs) ? outs : null;
}

function fantasyHitter(st) {
  const singles = Math.max(0,
    Number(st.hits || 0) -
    Number(st.doubles || 0) -
    Number(st.triples || 0) -
    Number(st.homeRuns || 0)
  );
  return (
    singles * 3 +
    Number(st.doubles || 0) * 5 +
    Number(st.triples || 0) * 8 +
    Number(st.homeRuns || 0) * 10 +
    Number(st.runs || 0) * 2 +
    Number(st.rbi || 0) * 2 +
    Number(st.baseOnBalls || 0) * 2 +
    Number(st.hitByPitch || 0) * 2 +
    Number(st.stolenBases || 0) * 5
  );
}

function fantasyPitcher(st) {
  const outs = inningsToOuts(st.inningsPitched) || 0;
  const win = String(st.decision || "").toUpperCase() === "W" ? 1 : 0;
  const qs = outs >= 18 && Number(st.earnedRuns || 0) <= 3 ? 1 : 0;
  return (
    win * 6 +
    qs * 4 +
    Number(st.earnedRuns || 0) * -3 +
    Number(st.strikeOuts || 0) * 3 +
    outs
  );
}

function valueForMarket(market, st) {
  const m = marketNorm(market);

  if (m === "hits") return num(st.hits);
  if (m === "bases") return num(st.totalBases);
  if (m === "runs") return num(st.runs);
  if (m === "rbis") return num(st.rbi);
  if (m === "walks") return num(st.baseOnBalls);
  if (m === "home_runs") return num(st.homeRuns);
  if (m === "hrr") return Number(st.hits || 0) + Number(st.runs || 0) + Number(st.rbi || 0);
  if (m === "hitter_fantasy_score") return fantasyHitter(st);

  if (m === "strikeouts") return num(st.strikeOuts);
  if (m === "hits_allowed") return num(st.hits);
  if (m === "walks_allowed") return num(st.baseOnBalls);
  if (m === "earned_runs_allowed") return num(st.earnedRuns);
  if (m === "runs_allowed") return num(st.runs);
  if (m === "pitching_outs") return inningsToOuts(st.inningsPitched);
  if (m === "pitches_thrown") return num(st.numberOfPitches || st.pitchesThrown);
  if (m === "pitcher_fantasy_score") return fantasyPitcher(st);

  return null;
}

function cleared(value, side, line) {
  if (value === null || value === undefined || line === null) return null;
  if (sideNorm(side) === "MORE") return value > line;
  if (sideNorm(side) === "LESS") return value < line;
  return null;
}

function summarizeGames(games, side, line) {
  const usable = games.filter(g => g.value !== null && g.value !== undefined);
  const graded = usable.filter(g => g.clear !== null);
  const hits = graded.filter(g => g.clear === true).length;
  const misses = graded.filter(g => g.clear === false).length;
  const avg = usable.length
    ? Number((usable.reduce((a, b) => a + Number(b.value || 0), 0) / usable.length).toFixed(2))
    : null;

  return {
    total: games.length,
    graded: graded.length,
    hits,
    misses,
    hitRate: graded.length ? Number(((hits / graded.length) * 100).toFixed(1)) : null,
    average: avg
  };
}

function gradeExternal(row, form) {
  let score = 0;
  const reasons = [];

  if (form.season.graded >= 20) {
    score += 2;
    reasons.push("season_sample_20_plus");
  } else if (form.season.graded >= 10) {
    score += 1;
    reasons.push("season_sample_10_plus");
  } else {
    reasons.push("light_season_sample");
  }

  if (form.l10.hitRate !== null && form.l10.hitRate >= 60) {
    score += 2;
    reasons.push("l10_60_plus");
  } else if (form.l10.hitRate !== null && form.l10.hitRate < 45) {
    score -= 2;
    reasons.push("l10_below_45");
  }

  if (form.l15.hitRate !== null && form.l15.hitRate >= 60) {
    score += 1;
    reasons.push("l15_60_plus");
  } else if (form.l15.hitRate !== null && form.l15.hitRate < 45) {
    score -= 1;
    reasons.push("l15_below_45");
  }

  if (form.season.hitRate !== null && form.season.hitRate >= 60) {
    score += 2;
    reasons.push("season_60_plus");
  } else if (form.season.hitRate !== null && form.season.hitRate < 45) {
    score -= 2;
    reasons.push("season_below_45");
  }

  if (row.lineupStatus === "confirmed" || row.starts === true) {
    score += 1;
    reasons.push("confirmed_lineup");
  }

  if (!isPitcherMarket(row.market) && row.battingOrder && Number(row.battingOrder) <= 5) {
    score += 1;
    reasons.push("top_5_batting_order");
  }

  if (row.pickfinderFound) {
    score += 1;
    reasons.push("pickfinder_available");
  }

  let grade = "D";
  if (score >= 7) grade = "A";
  else if (score >= 4) grade = "B";
  else if (score >= 1) grade = "C";

  return { externalScore: score, externalGrade: grade, externalReasons: reasons };
}

function buildLine(r) {
  return [
    `${r.decision} | ${r.externalGrade}(${r.externalScore})`,
    `${r.class}`,
    `${r.player}`,
    `${r.team || ""}`,
    `${r.market} ${r.side} ${r.line}`,
    `modelProb=${r.prob !== null ? pct(r.prob * 100) : "n/a"}`,
    `edge=${val(r.edge)}`,
    `grade=${val(r.grade)}`,
    `lineup=${val(r.lineupStatus)} start=${val(r.starts)} bat=${val(r.battingOrder)}`,
    `MLB L5=${pct(r.externalL5?.hitRate)} avg=${val(r.externalL5?.average)}`,
    `L10=${pct(r.externalL10?.hitRate)} avg=${val(r.externalL10?.average)}`,
    `L15=${pct(r.externalL15?.hitRate)} avg=${val(r.externalL15?.average)}`,
    `Season=${pct(r.externalSeason?.hitRate)} avg=${val(r.externalSeason?.average)} n=${r.externalSeason?.graded ?? 0}`,
    `HA(${val(r.currentHomeAway)})=${pct(r.externalHomeAway?.hitRate)} n=${r.externalHomeAway?.graded ?? 0}`,
    `Hand(${val(r.currentPitcherHand)})=${pct(r.externalPitcherHand?.hitRate)} n=${r.externalPitcherHand?.graded ?? 0}`,
    `vsP=${r.externalVsPitcher?.available ? `${r.externalVsPitcher.pitcherName}: PA=${r.externalVsPitcher.plateAppearances} val=${r.externalVsPitcher.value} clear=${r.externalVsPitcher.clear}` : val(r.externalVsPitcher?.reason)}`,
    r.pickfinderFound
      ? `PF L10=${val(r.pickfinderL10)} Season=${val(r.pickfinderSeason)} vsP=${val(r.pickfinderVsPitcher)}`
      : "PF=not_checked",
    `reasons=${r.externalReasons.join(",") || "none"}`
  ].join(" | ");
}

function section(title, rows) {
  const lines = [];
  lines.push(title);
  lines.push("-".repeat(title.length));
  if (!rows.length) lines.push("none");
  else rows.forEach((r, i) => lines.push(`${i + 1}. ${buildLine(r)}`));
  lines.push("");
  return lines.join("\n");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });

  const targets = loadTargets();
  const cache = loadCache();

  const rows = [];

  for (const row of targets) {
    const playerInfo = await findPlayerId(row.player, cache);

    if (playerInfo?.id) {
      row.originalMarket = row.market;
      row.market = pitcherAwareMarket(row.market, playerInfo, row);
      row.marketNormalizedByPlayer = row.originalMarket !== row.market;
    }

    if (!playerInfo?.id) {
      rows.push({
        ...row,
        playerFound: false,
        playerSearch: playerInfo,
        externalError: "mlb_player_not_found",
        externalL5: summarizeGames([], row.side, row.line),
        externalL10: summarizeGames([], row.side, row.line),
        externalL15: summarizeGames([], row.side, row.line),
        externalSeason: summarizeGames([], row.side, row.line),
        externalScore: 0,
        externalGrade: "D",
        externalReasons: ["mlb_player_not_found"]
      });
      continue;
    }

    const group = statGroupForMarket(row.market);

    try {
      const logs = await getGameLog(playerInfo.id, group);
      let games = logs.map(g => {
        const value = valueForMarket(row.market, g.stat);
        return {
          date: g.date,
          gamePk: g.gamePk,
          opponent: g.opponent,
          isHome: g.isHome,
          value,
          clear: cleared(value, row.side, row.line),
          rawStat: g.stat
        };
      }).filter(g => g.value !== null && g.value !== undefined);

      games = await addHistoricalStarterHands(games);

      const currentHomeAway = inferCurrentHomeAway(row);
      const currentPitcherHand = row.opposingPitcherHand || "";
      const currentOpposingPitcherName = pickOpposingPitcherName(row);

      const homeAwayGames = splitGamesByHomeAway(games, currentHomeAway);
      const pitcherHandGames = splitGamesByPitcherHand(games, currentPitcherHand);
      const vsPitcher = await calcVsPitcherHistory(row, playerInfo, currentOpposingPitcherName, games);

      const form = {
        l5: summarizeGames(games.slice(0, 5), row.side, row.line),
        l10: summarizeGames(games.slice(0, 10), row.side, row.line),
        l15: summarizeGames(games.slice(0, 15), row.side, row.line),
        season: summarizeGames(games, row.side, row.line),
        homeAway: summarizeGames(homeAwayGames, row.side, row.line),
        pitcherHand: summarizeGames(pitcherHandGames, row.side, row.line),
        recentGames: games.slice(0, 15)
      };

      const grade = gradeExternal(row, form);

      rows.push({
        ...row,
        playerFound: true,
        mlbId: playerInfo.id,
        mlbName: playerInfo.fullName,
        mlbPrimaryPosition: playerInfo.primaryPosition,
        batSide: playerInfo.batSide,
        pitchHand: playerInfo.pitchHand,
        currentHomeAway,
        currentOpposingPitcherName,
        currentPitcherHand,
        statGroup: group,
        externalSource: "MLB Stats API gameLog + boxscore/playByPlay v2",
        externalL5: form.l5,
        externalL10: form.l10,
        externalL15: form.l15,
        externalSeason: form.season,
        externalHomeAway: form.homeAway,
        externalPitcherHand: form.pitcherHand,
        externalVsPitcher: vsPitcher,
        externalRecentGames: form.recentGames,
        ...grade
      });
    } catch (err) {
      rows.push({
        ...row,
        playerFound: true,
        mlbId: playerInfo.id,
        mlbName: playerInfo.fullName,
        statGroup: group,
        externalError: err.message,
        externalL5: summarizeGames([], row.side, row.line),
        externalL10: summarizeGames([], row.side, row.line),
        externalL15: summarizeGames([], row.side, row.line),
        externalSeason: summarizeGames([], row.side, row.line),
        externalScore: 0,
        externalGrade: "D",
        externalReasons: ["mlb_game_log_error"]
      });
    }
  }

  saveCache(cache);
  saveBoxscoreCache();
  savePlayByPlayCache();

  const byDecision = {};
  for (const r of rows) byDecision[r.decision] = (byDecision[r.decision] || 0) + 1;

  const output = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    season: SEASON,
    source: "MLB Stats API gameLog, not internal graded history",
    counts: {
      targets: targets.length,
      rows: rows.length,
      byDecision
    },
    rows
  };

  const txt = [
    "EXTERNAL MLB FORM CONFIRMATION REPORT",
    "=====================================",
    `date: ${DATE}`,
    `season: ${SEASON}`,
    "source: MLB Stats API gameLog, not internal graded history",
    `rows: ${rows.length}`,
    `byDecision: ${JSON.stringify(byDecision)}`,
    "",
    section("OFFICIAL", rows.filter(r => r.decision === "KEEP_OFFICIAL")),
    section("SMALL LEANS", rows.filter(r => r.decision === "KEEP_SMALL_LEAN")),
    section("WATCH ONLY", rows.filter(r => ["WATCH_ONLY", "WATCHLIST_PLUS", "OFFICIAL_REVIEW"].includes(r.decision))),
    "NOTES",
    "-----",
    "- MLB L5/L10/L15/Season are calculated from MLB game logs against the current PrizePicks line.",
    "- This does not use internal graded prop history.",
    "- PF fields appear only if PickFinder data is already present.",
    "- V2 adds home/away split, historical opponent starter hand split, and best-effort vs-pitcher history when current opposing pitcher is known.",
    ""
  ].join("\n");

  fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2) + "\n");
  fs.writeFileSync(OUT_LATEST_JSON, JSON.stringify(output, null, 2) + "\n");
  fs.writeFileSync(OUT_TXT, txt);
  fs.writeFileSync(OUT_LATEST_TXT, txt);

  console.log(txt);
  console.log(`saved: ${OUT_JSON}`);
  console.log(`saved: ${OUT_LATEST_JSON}`);
  console.log(`saved: ${OUT_TXT}`);
  console.log(`saved: ${OUT_LATEST_TXT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
