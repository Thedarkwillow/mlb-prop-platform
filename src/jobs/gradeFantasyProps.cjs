const fs = require("fs");
const { hitterFantasyScore, pitcherFantasyScore } = require("./fantasyScoreRules.cjs");

const date = process.argv[2];

if (!date) {
  console.error("Usage: node src/jobs/gradeFantasyProps.cjs YYYY-MM-DD");
  process.exit(1);
}

const LOCKED = `outputs/history/${date}-locked-slips.json`;
const OUT_JSON = `outputs/history/${date}-fantasy-grades.json`;
const OUT_TXT = `outputs/history/${date}-fantasy-grades.txt`;

const TEAM_IDS = {
  ARI: 109,
  ATL: 144,
  BAL: 110,
  BOS: 111,
  CHC: 112,
  CHW: 145,
  CWS: 145,
  CIN: 113,
  CLE: 114,
  COL: 115,
  DET: 116,
  HOU: 117,
  KC: 118,
  KCR: 118,
  LAA: 108,
  LAD: 119,
  MIA: 146,
  MIL: 158,
  MIN: 142,
  NYM: 121,
  NYY: 147,
  ATH: 133,
  OAK: 133,
  PHI: 143,
  PIT: 134,
  SD: 135,
  SDP: 135,
  SEA: 136,
  SF: 137,
  SFG: 137,
  STL: 138,
  TB: 139,
  TBR: 139,
  TEX: 140,
  TOR: 141,
  WSH: 120,
  WAS: 120,
};

function readJson(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function k(v) {
  return String(v || "").trim().toLowerCase();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function marketOf(row) {
  return k(row.market || row.stat || row.rawStat);
}

function sideOf(row) {
  const raw = String(row.side || row.recommendedSide || row.pick || row.direction || row.type || "").toUpperCase();
  if (raw.includes("LESS") || raw.includes("UNDER")) return "LESS";
  if (raw.includes("MORE") || raw.includes("OVER")) return "MORE";

  if (isFantasy(row)) return "MORE";

  return "";
}

function isFantasy(row) {
  const m = marketOf(row);
  return (
    row.isFantasy === true ||
    m.includes("fantasy") ||
    m === "hitter_fantasy_score" ||
    m === "pitcher_fantasy_score"
  );
}

function isPitcherFantasy(row) {
  return marketOf(row).includes("pitcher");
}

function isHitterFantasy(row) {
  return marketOf(row).includes("hitter");
}

function playerName(row) {
  return row.player || row.playerName || row.name || "";
}

function team(row) {
  return row.team || row.playerTeam || "";
}

function resultFor(actual, line, side) {
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return "PENDING";
  if (actual === line) return "PUSH";
  if (side === "MORE" || side === "OVER") return actual > line ? "HIT" : "MISS";
  if (side === "LESS" || side === "UNDER") return actual < line ? "HIT" : "MISS";
  return "PENDING";
}

function flattenFantasyRows() {
  const tracking = readJson("outputs/fantasy-tracking.json", []);
  const trackingRows = Array.isArray(tracking) ? tracking.filter(isFantasy) : [];
  if (trackingRows.length) return trackingRows;

  const withFantasy = readJson("outputs/slips-with-fantasy.json", []);
  const withFantasyRows = Array.isArray(withFantasy) ? withFantasy.filter(isFantasy) : [];
  if (withFantasyRows.length) return withFantasyRows;

  const today = new Date().toISOString().slice(0, 10);
  const locked = readJson(LOCKED, []);
  const lockedLegs = locked.flatMap(s => s.legs || []).filter(isFantasy);
  if (date !== today) return lockedLegs;
  if (lockedLegs.length) return lockedLegs;

  const priced = readJson("outputs/priced-board.json", []);
  return priced.filter(r => r.recordType === "merged_prop" && isFantasy(r));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${url}`);
  return res.json();
}

async function getSchedule(date) {
  return fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
}

async function getBoxscore(gamePk) {
  return fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
}

function allGames(schedule) {
  return (schedule.dates || []).flatMap(d => d.games || []);
}

function findGameForTeam(games, teamAbbr) {
  const id = TEAM_IDS[String(teamAbbr || "").toUpperCase()];
  if (!id) return null;

  return games.find(g => {
    const awayId = g.teams?.away?.team?.id;
    const homeId = g.teams?.home?.team?.id;
    return awayId === id || homeId === id;
  });
}

function teamIdsFromGameString(game) {
  const parts = String(game || "")
    .replace(/\s+/g, " ")
    .split("@")
    .map(x => String(x || "").trim().toUpperCase())
    .filter(Boolean);

  if (parts.length !== 2) return [];

  return parts.map(t => TEAM_IDS[t]).filter(Boolean);
}

function findGameForRow(games, row, teamAbbr) {
  const directPk = row.resolvedGamePk || row.gamePk || row.mlbGamePk;

  if (directPk) {
    const byPk = games.find(g => String(g.gamePk) === String(directPk));
    if (byPk) return byPk;
  }

  const ids = teamIdsFromGameString(row.resolvedGame || row.game || row.rawGame);

  if (ids.length === 2) {
    const byTeams = games.find(g => {
      const awayId = g.teams?.away?.team?.id;
      const homeId = g.teams?.home?.team?.id;
      return ids.includes(awayId) && ids.includes(homeId);
    });

    if (byTeams) return byTeams;
  }

  return findGameForTeam(games, teamAbbr);
}

function normalizeName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPlayerStatsFromBoxscore(box, name) {
  const target = normalizeName(name);
  const teams = [box.teams?.away, box.teams?.home].filter(Boolean);

  for (const tm of teams) {
    for (const p of Object.values(tm.players || {})) {
      const fullName = p.person?.fullName || "";
      if (normalizeName(fullName) !== target) continue;

      return {
        batting: p.stats?.batting || {},
        pitching: p.stats?.pitching || {},
        position: p.position?.abbreviation || "",
        fullName,
      };
    }
  }

  return null;
}

function deriveBatting(stats = {}) {
  const hits = n(stats.hits);
  const doubles = n(stats.doubles);
  const triples = n(stats.triples);
  const homeRuns = n(stats.homeRuns);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);

  return {
    ...stats,
    singles,
    doubles,
    triples,
    homeRuns,
  };
}

async function main() {
  const fantasyRows = flattenFantasyRows();

  const lines = [];
  lines.push("FANTASY PROP GRADER");
  lines.push(`Date: ${date}`);
  lines.push(`Fantasy rows: ${fantasyRows.length}`);
  lines.push("");

  if (!fantasyRows.length) {
    lines.push("No fantasy rows found.");
    fs.writeFileSync(OUT_JSON, JSON.stringify([], null, 2));
    fs.writeFileSync(OUT_TXT, lines.filter(line => !line.includes(" | EXCLUDED | ")).join("\n"));
    console.log(lines.filter(line => !line.includes(" | EXCLUDED | ")).join("\n"));
    return;
  }

  const schedule = await getSchedule(date);
  const games = allGames(schedule);
  const boxscores = new Map();
  const grades = [];

  for (const row of fantasyRows) {
    const p = playerName(row);
    const t = team(row);
    const side = sideOf(row);
    const line = Number(row.line);

    const game = findGameForRow(games, row, t);

    if (!game) {
      grades.push({
        player: p,
        team: t,
        market: row.market || row.stat,
        line,
        side,
        actual: null,
        result: "EXCLUDED",
        reason: "off_slate_team_not_scheduled",
      });
      continue;
    }

    const gamePk = game.gamePk;

    if (!boxscores.has(gamePk)) {
      boxscores.set(gamePk, await getBoxscore(gamePk));
    }

    const box = boxscores.get(gamePk);
    const found = getPlayerStatsFromBoxscore(box, p);

    if (!found) {
      grades.push({
        player: p,
        team: t,
        market: row.market || row.stat,
        line,
        side,
        actual: null,
        result: "PENDING",
        reason: "player_not_found_in_boxscore",
        gamePk,
      });
      continue;
    }

    let actual = null;
    let fantasyType = null;

    if (isPitcherFantasy(row)) {
      actual = pitcherFantasyScore(found.pitching);
      fantasyType = "pitcher";
    } else if (isHitterFantasy(row)) {
      actual = hitterFantasyScore(deriveBatting(found.batting));
      fantasyType = "hitter";
    } else {
      grades.push({
        player: p,
        team: t,
        market: row.market || row.stat,
        line,
        side,
        actual: null,
        result: "PENDING",
        reason: "unknown_fantasy_type",
        gamePk,
      });
      continue;
    }

    grades.push({
      player: p,
      team: t,
      market: row.market || row.stat,
      fantasyType,
      line,
      side,
      actual: Number(actual.toFixed(2)),
      result: resultFor(actual, line, side),
      gamePk,
      matchedName: found.fullName,
    });
  }

  const graded = grades.filter(g => ["HIT", "MISS", "PUSH"].includes(g.result));
  const hits = graded.filter(g => g.result === "HIT").length;
  const misses = graded.filter(g => g.result === "MISS").length;
  const pushes = graded.filter(g => g.result === "PUSH").length;
  const pending = grades.filter(g => g.result === "PENDING").length;
  const denom = hits + misses;
  const hitRate = denom ? ((hits / denom) * 100).toFixed(1) : "0.0";

  lines.push(`Graded: ${graded.length}`);
  lines.push(`Hits: ${hits}`);
  lines.push(`Misses: ${misses}`);
  lines.push(`Pushes: ${pushes}`);
  lines.push(`Pending: ${pending}`);
  lines.push(`Hit Rate: ${hitRate}%`);
  lines.push("");
  lines.push("DETAILS");
  lines.push("-------");

  for (const g of grades) {
    lines.push(
      `${g.player} | ${g.team} | ${g.market} ${g.side} ${g.line} | Actual: ${g.actual ?? "NA"} | ${g.result}${g.reason ? ` | ${g.reason}` : ""}`
    );
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(grades, null, 2));
  fs.writeFileSync(OUT_TXT, lines.filter(line => !line.includes(" | EXCLUDED | ")).join("\n"));

  console.log(lines.filter(line => !line.includes(" | EXCLUDED | ")).join("\n"));
  console.log("");
  console.log(`Saved JSON: ${OUT_JSON}`);
  console.log(`Saved TXT: ${OUT_TXT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
