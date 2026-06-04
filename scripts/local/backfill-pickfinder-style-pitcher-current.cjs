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
const OUT_DIR = "data/pickfinder";
const OUT_JSON = `${OUT_DIR}/pickfinder-style-pitcher-backfill-${DATE}.json`;
const OUT_LATEST = `${OUT_DIR}/pickfinder-style-pitcher-backfill-latest.json`;
const OUT_TXT = `${OUT_DIR}/pickfinder-style-pitcher-backfill-${DATE}.txt`;
const OUT_LATEST_TXT = `${OUT_DIR}/pickfinder-style-pitcher-backfill-latest.txt`;

const PLAYER_INDEX_FILE = `data/external/mlb-player-index-${SEASON}.json`;
const GAMELOG_CACHE_FILE = `data/external/mlb-pitcher-gamelog-cache-${SEASON}.json`;

const SOURCES = [
  "outputs/production-candidates.json",
  `outputs/production-candidate-hardening-${DATE}.json`,
  "outputs/full-prop-confirmation/full-prop-confirmation-report-latest.json"
];
const CURRENT_BOARD_FILE = "outputs/priced-board.json";


function readJson(file, fallback = null) {
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
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function loadPlayerPeopleIndex(file) {
  const raw = readJson(file, {});
  const people = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.people)
      ? raw.people
      : [];
  return people
    .filter(p => p && p.id && (p.fullName || p.nameFirstLast || p.firstLastName))
    .map(p => ({
      ...p,
      _pfName: p.fullName || p.nameFirstLast || p.firstLastName,
      _pfId: p.id,
      _pfTeamId: p.currentTeam?.id || null,
      _pfPosition: p.primaryPosition?.abbreviation || p.primaryPosition?.name || ""
    }));
}


function findPlayerDirect(playerIndex, target) {
  const player = target.player || target.playerName || target.name || "";
  if (!player) return null;

  const exact = playerIndex.find(p =>
    norm(p.fullName || p.nameFirstLast || p.firstLastName || p._pfName) === norm(player)
  );
  if (exact) return exact;

  const loose = playerIndex.find(p => {
    const n = norm(p.fullName || p.nameFirstLast || p.firstLastName || p._pfName);
    const q = norm(player);
    return n && q && (n.includes(q) || q.includes(n));
  });
  return loose || null;
}
function findPlayerIndexMatch(playerIndex, player) {
  const target = norm(player);
  let hit = playerIndex.find(p => norm(p._pfName) === target);
  if (hit) return hit;

  hit = playerIndex.find(p => {
    const n = norm(p._pfName);
    return n && (n.includes(target) || target.includes(n));
  });
  return hit || null;
}

function playerIdFromIndexRow(p) {
  return p?._pfId || p?.id || p?.mlbPlayerId || p?.playerId || null;
}

function marketNorm(v) {
  const s = norm(v).replace(/\s+/g, "_");
  const aliases = {
    pitcher_strikeouts: "strikeouts",
    strikeouts: "strikeouts",
    k: "strikeouts",
    ks: "strikeouts",
    hits_allowed: "hits_allowed",
    pitcher_hits_allowed: "hits_allowed",
    walks_allowed: "walks_allowed",
    pitcher_walks_allowed: "walks_allowed",
    earned_runs_allowed: "earned_runs_allowed",
    pitcher_earned_runs_allowed: "earned_runs_allowed",
    runs_allowed: "runs_allowed",
    runs: "runs_allowed",
    pitching_outs: "pitching_outs",
    outs: "pitching_outs",
    pitches_thrown: "pitches_thrown",
    pitcher_fantasy_score: "pitcher_fantasy_score"
  };
  return aliases[s] || s;
}

function isPitcherMarket(market, row = {}) {
  const m = marketNorm(market);
  if ([
    "strikeouts",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "runs_allowed",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score"
  ].includes(m)) return true;

  const pos = norm(row.position || row.playerPosition || row.pos || row.playerRole || "");
  const type = norm(row.type || row.playerType || row.role || "");
  return (m === "runs_allowed" || m === "runs") && (
    pos.includes("pitcher") ||
    pos === "p" ||
    pos === "sp" ||
    type.includes("pitcher")
  );
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.statType) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function uniqueKey(r) {
  return [
    norm(r.player || r.playerName || r.name),
    norm(r.team),
    marketNorm(r.market || r.statType),
    norm(r.side || r.pick),
    String(r.line ?? r.value ?? "")
  ].join("|");
}

function propKey(r) {
  return [
    norm(r.player || r.playerName || r.name),
    norm(r.team),
    marketNorm(r.market || r.statType),
    norm(r.side || r.pick),
    String(r.line ?? r.value ?? "")
  ].join("|");
}

function isPitcherOnlyMarket(market) {
  const m = marketNorm(market);
  return [
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "runs_allowed",
    "pitching_outs",
    "pitches_thrown",
    "pitcher_fantasy_score"
  ].includes(m);
}

function isPitcherStrikeoutRow(row, playerName) {
  const m = marketNorm(row.market || row.statType || row.stat || row.projectionType || row.type);
  if (m !== "strikeouts") return false;

  // Exclude combo props.
  if (String(playerName || "").includes("+")) return false;

  // Exclude obvious hitter strikeout props by requiring pitcher-like metadata when available.
  const pos = String(
    row.position ||
    row.primaryPosition ||
    row.playerPosition ||
    row.participantPosition ||
    row.positionAbbreviation ||
    ""
  ).toLowerCase();

  const role = String(
    row.role ||
    row.playerRole ||
    row.participantRole ||
    row.type ||
    ""
  ).toLowerCase();

  if (pos && !["p", "sp", "rp", "pitcher"].includes(pos)) return false;
  if (role && role.includes("batter")) return false;

  // If no useful metadata exists, keep only higher pitcher-style K lines.
  // Hitter strikeout props are usually 0.5/1.5/2.5.
  const line = Number(row.line ?? row.lineScore ?? row.target ?? row.value);
  return Number.isFinite(line) && line >= 3.5;
}

function sideFromBoardRow(row) {
  const raw = String(row.side || row.pick || row.direction || row.recommendation || "").toUpperCase();
  if (raw === "MORE" || raw === "LESS") return raw;

  const tier = String(row.tier || row.oddsTier || "").toLowerCase();

  // Goblins/demons are playable MORE-only in our system.
  if (tier === "goblin" || tier === "demon") return "MORE";

  // Standard board rows often have no side because the board just lists the line.
  // Backfill is confirmation only, so create both directions for standards.
  return null;
}

function loadTargets() {
  const board = flatten(readJson(CURRENT_BOARD_FILE, []));
  const targets = [];

  for (const row of board) {
    const player =
      row.player ||
      row.playerName ||
      row.name ||
      row.participantName ||
      row.displayName ||
      row.fullName ||
      "";

    if (!player || String(player).includes("+")) continue;

    const rawMarket = row.market || row.statType || row.stat || row.projectionType || row.type;
    const market = marketNorm(rawMarket);

    const pitcherMarket =
      isPitcherOnlyMarket(rawMarket) ||
      isPitcherStrikeoutRow(row, player);

    if (!pitcherMarket) continue;

    const line = Number(row.line ?? row.lineScore ?? row.target ?? row.value);
    if (!Number.isFinite(line)) continue;

    const base = {
      player,
      team: row.team || row.teamAbbr || row.teamCode || row.currentTeam || null,
      opponent: row.opponent || row.opp || row.opponentTeam || null,
      market,
      line,
      tier: row.tier || row.oddsTier || null,
      prob: row.prob ?? row.probability ?? null,
      edge: row.edge ?? null,
      books: row.books ?? row.bookCount ?? null,
      grade: row.grade ?? null,
      source: "current_priced_board"
    };

    const side = sideFromBoardRow(row);

    if (side) {
      targets.push({ ...base, side });
    } else {
      targets.push({ ...base, side: "MORE" });
      targets.push({ ...base, side: "LESS" });
    }
  }

  const seen = new Set();
  return targets.filter(t => {
    const key = [
      norm(t.player),
      norm(t.team),
      marketNorm(t.market),
      t.side,
      Number(t.line)
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function indexPlayers(index) {
  const rows = flatten(index);
  const map = new Map();

  for (const r of rows) {
    const id = r.id || r.mlbId || r.mlbID || r.playerId || r.player_id;
    const name = r.fullName || r.name || r.player || r.playerName;
    if (!id || !name) continue;

    const team = r.team || r.teamAbbr || r.currentTeam || r.mlbTeam || "";
    map.set(norm(name), { id, name, team });
    if (team) map.set(`${norm(name)}|${norm(team)}`, { id, name, team });
  }

  return map;
}

function findPlayer(playerMap, row) {
  return (
    playerMap.get(`${norm(row.player)}|${norm(row.team)}`) ||
    playerMap.get(norm(row.player)) ||
    null
  );
}

function inningsToOuts(v) {
  const s = String(v ?? "0");
  if (!s.includes(".")) return Number(s) * 3 || 0;
  const [whole, frac] = s.split(".");
  return (Number(whole) || 0) * 3 + (Number(frac) || 0);
}

function outsToInnings(outs) {
  const o = Number(outs || 0);
  const whole = Math.floor(o / 3);
  const rem = o % 3;
  return Number(`${whole}.${rem}`);
}

function statValue(g, market) {
  const s = g.stat || g || {};
  const outs = inningsToOuts(s.inningsPitched);

  if (market === "strikeouts") return Number(s.strikeOuts ?? s.strikeouts ?? 0);
  if (market === "hits_allowed") return Number(s.hits ?? s.hitsAllowed ?? 0);
  if (market === "walks_allowed") return Number(s.baseOnBalls ?? s.walks ?? 0);
  if (market === "earned_runs_allowed") return Number(s.earnedRuns ?? 0);
  if (market === "runs_allowed") return Number(s.runs ?? 0);
  if (market === "pitching_outs") return outs;
  if (market === "pitches_thrown") return Number(s.numberOfPitches ?? s.pitchesThrown ?? 0);

  if (market === "pitcher_fantasy_score") {
    const k = Number(s.strikeOuts ?? 0);
    const er = Number(s.earnedRuns ?? 0);
    const win = String(s.decision || "").toUpperCase() === "W" ? 1 : 0;
    const ip = outsToInnings(outs);
    const qs = outs >= 18 && er <= 3 ? 1 : 0;
    return (win * 6) + (qs * 4) + (er * -3) + (k * 3) + outs;
  }

  return null;
}

function opponentName(g) {
  const o = g.opponent || g.opponentName || g.team || {};
  return typeof o === "string" ? o : (o.name || o.abbreviation || "");
}

function gameDate(g) {
  return g.date || g.gameDate || g.game_date || "";
}

function hitRate(games, side, line, market) {
  const vals = [];
  for (const g of games) {
    const v = statValue(g, market);
    if (!Number.isFinite(v)) continue;
    vals.push(v);
  }

  let hits = 0;
  for (const v of vals) {
    if (side === "MORE" && v > line) hits++;
    if (side === "LESS" && v < line) hits++;
  }

  const n = vals.length;
  const avg = n ? vals.reduce((a, b) => a + b, 0) / n : null;
  return {
    n,
    hits,
    rate: n ? hits / n : null,
    avg
  };
}

async function fetchPitcherGameLog(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=pitching&season=${SEASON}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB gameLog failed ${playerId}: ${res.status}`);
  const data = await res.json();
  const splits = data?.stats?.[0]?.splits || [];
  return splits
    .map(x => ({
      date: x.date,
      gamePk: x.game?.gamePk || x.gamePk || null,
      opponent: x.opponent || null,
      isHome: x.isHome ?? null,
      stat: x.stat || {}
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function classifyPfStatus(row, l10, season, checkedSample) {
  if (
    season.n >= 8 &&
    l10.n >= 5 &&
    Number(l10.rate || 0) >= 0.6 &&
    Number(season.rate || 0) >= 0.55
  ) {
    return "PF_CONFIRMED";
  }

  if (checkedSample) return "PF_WEAK";
  return "PF_NOT_CHECKED";
}

function pct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "n/a";
  return `${Number(v).toFixed(1)}%`;
}

function avg(v) {
  if (v == null || !Number.isFinite(Number(v))) return "n/a";
  return Number(v).toFixed(2);
}


function propKeyForCurrentBoard(row) {
  const player = norm(row.player || row.playerName || row.name || row.fullName || row.participantName || row.displayName);
  let market = marketNorm(row.market || row.statType || row.stat || row.projectionType || row.type);
  const side = norm(row.side || row.pick || row.direction || row.recommendation || row.selection).toUpperCase();
  const line = Number(row.line ?? row.lineScore ?? row.target ?? row.value ?? row.threshold);

  // Current board may call pitcher runs "runs", while the pitcher backfill normalizes it to runs_allowed.
  if (market === "runs" && Number(line) >= 1.5) market = "runs_allowed";

  if (!player || !market || !side || !Number.isFinite(line)) return "";
  return `${player}|${market}|${side}|${line}`;
}

function currentBoardPropKeys() {
  const board = readJson(CURRENT_BOARD_FILE, []);
  const rows = [];
  function flatten(v) {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) flatten(x);
      return;
    }
    if (typeof v !== "object") return;
    const hasPropShape =
      v.player || v.playerName || v.name || v.fullName || v.participantName ||
      v.market || v.statType || v.stat || v.projectionType ||
      v.line || v.lineScore || v.target || v.value;
    if (hasPropShape) rows.push(v);
    for (const val of Object.values(v)) {
      if (val && typeof val === "object") flatten(val);
    }
  }
  flatten(board);
  const keys = new Set();
  for (const r of rows) {
    const k = propKeyForCurrentBoard(r);
    if (k) keys.add(k);
  }
  return keys;
}

function filterTargetsToCurrentBoard(targets) {
  const boardKeys = currentBoardPropKeys();
  if (!boardKeys.size) {
    console.warn("WARNING: current board key set is empty; keeping raw pitcher targets");
    return targets;
  }

  const kept = [];
  const dropped = [];
  for (const t of targets) {
    const key = propKeyForCurrentBoard(t);
    if (key && boardKeys.has(key)) kept.push(t);
    else dropped.push(t);
  }

  console.log(`currentBoardPitcherFilter=kept:${kept.length} dropped_stale:${dropped.length}`);
  if (dropped.length) {
    console.log("DROPPED STALE PITCHER TARGETS:");
    for (const r of dropped.slice(0, 30)) {
      console.log(`- ${r.player || r.playerName || "NA"} | ${r.team || "NA"} | ${r.market} ${r.side} ${r.line}`);
    }
  }

  return kept;
}


async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const targets = filterTargetsToCurrentBoard(loadTargets());
  const playerIndex = loadPlayerPeopleIndex(PLAYER_INDEX_FILE);
  const cache = readJson(GAMELOG_CACHE_FILE, {});

  let matchedPlayers = 0;
  let missedPlayers = 0;
  const rows = [];

  for (const t of targets) {
    const p = findPlayerDirect(playerIndex, t);
    if (!p) {
      missedPlayers++;
      rows.push({
        ...t,
        status: "PLAYER_UNMATCHED",
        pfStatus: "PF_NOT_CHECKED",
        sampleNotes: { reason: "player_unmatched" }
      });
      continue;
    }

    matchedPlayers++;

    if (!cache[p.id]) {
      cache[p.id] = await fetchPitcherGameLog(p.id);
    }

    const games = Array.isArray(cache[p.id]) ? cache[p.id] : [];
    const prior = games.filter(g => String(gameDate(g)).slice(0, 10) <= DATE);
    const market = marketNorm(t.market);

    const l5 = hitRate(prior.slice(-5), t.side, t.line, market);
    const l10 = hitRate(prior.slice(-10), t.side, t.line, market);
    const l15 = hitRate(prior.slice(-15), t.side, t.line, market);
    const season = hitRate(prior, t.side, t.line, market);

    const vsOpponentGames = t.opponent
      ? prior.filter(g => norm(opponentName(g)).includes(norm(t.opponent)))
      : [];
    const vsOpponent = hitRate(vsOpponentGames, t.side, t.line, market);

    const outsSeason = hitRate(prior, "MORE", -1, "pitching_outs");
    const pitchesSeason = hitRate(prior, "MORE", -1, "pitches_thrown");
    const kSeason = hitRate(prior, "MORE", -1, "strikeouts");
    const erSeason = hitRate(prior, "MORE", -1, "earned_runs_allowed");
    const walksSeason = hitRate(prior, "MORE", -1, "walks_allowed");
    const hitsAllowedSeason = hitRate(prior, "MORE", -1, "hits_allowed");

    const checkedSample = [l5, l10, l15, season, vsOpponent].some(x => Number(x.n || 0) > 0);
    const pfStatus = classifyPfStatus(t, l10, season, checkedSample);

    rows.push({
      ...t,
      mlbPlayerId: playerIdFromIndexRow(p),
      status: "OK",
      pfStatus,
      l5,
      l10,
      l15,
      season,
      vsOpponent,
      supportStats: {
        inningsAvg: outsSeason.avg == null ? null : outsToInnings(Math.round(outsSeason.avg)),
        pitchesAvg: pitchesSeason.avg,
        strikeoutsAvg: kSeason.avg,
        earnedRunsAvg: erSeason.avg,
        walksAvg: walksSeason.avg,
        hitsAllowedAvg: hitsAllowedSeason.avg
      },
      sampleNotes: {
        seasonSample: season.n,
        currentBoardBackfill: true,
        compactOnly: true,
        source: "MLB Stats API pitcher gameLog"
      }
    });
  }

  writeJson(GAMELOG_CACHE_FILE, cache);

  const byStatus = {};
  for (const r of rows) {
    byStatus[r.pfStatus || "UNKNOWN"] = (byStatus[r.pfStatus || "UNKNOWN"] || 0) + 1;
  }

  const output = {
    date: DATE,
    generatedAt: new Date().toISOString(),
    mode: "COMPACT_CURRENT_SLATE_PICKFINDER_STYLE_PITCHER_BACKFILL",
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
  lines.push("PITCHER PICKFINDER-STYLE COMPACT BACKFILL");
  lines.push("=========================================");
  lines.push(`date=${DATE}`);
  lines.push(`targetRows=${targets.length}`);
  lines.push(`matchedPlayers=${matchedPlayers}`);
  lines.push(`missedPlayers=${missedPlayers}`);
  lines.push(`byStatus=${JSON.stringify(byStatus)}`);
  lines.push("");
  lines.push("TOP PF_CONFIRMED PITCHER PROPS");
  lines.push("------------------------------");

  const confirmed = rows
    .filter(r => r.pfStatus === "PF_CONFIRMED")
    .sort((a, b) => Number(b.prob || 0) - Number(a.prob || 0))
    .slice(0, 30);

  if (!confirmed.length) lines.push("none");

  for (const r of confirmed) {
    lines.push(
      `${r.player} | ${r.team || "n/a"} | ${r.market} ${r.side} ${r.line} | ` +
      `prob=${pct(Number(r.prob || 0) * 100)} | ` +
      `L5=${pct((r.l5?.rate ?? null) * 100)} n=${r.l5?.n || 0} avg=${avg(r.l5?.avg)} | ` +
      `L10=${pct((r.l10?.rate ?? null) * 100)} n=${r.l10?.n || 0} avg=${avg(r.l10?.avg)} | ` +
      `Season=${pct((r.season?.rate ?? null) * 100)} n=${r.season?.n || 0} avg=${avg(r.season?.avg)} | ` +
      `IPavg=${avg(r.supportStats?.inningsAvg)} | PitchesAvg=${avg(r.supportStats?.pitchesAvg)}`
    );
  }

  lines.push("");
  lines.push("POLICY");
  lines.push("------");
  lines.push("Pitcher backfill is confirmation/research only. It does not create official plays.");

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
