const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const INPUT = `outputs/live/mlb-live-board-resolved-${date}.json`;
const OUT = `outputs/live/mlb-live-inning-graded-${date}.json`;
const LATEST = "outputs/live/mlb-live-inning-graded-latest.json";
const HISTORY = "data/live/mlb-live-inning-graded-history.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’`-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function result(actual, side, line) {
  if (!Number.isFinite(Number(actual))) return "UNKNOWN";
  const a = Number(actual);
  const l = Number(line);
  const s = String(side || "").toUpperCase();

  if (a === l) return "PUSH";
  if (s === "MORE") return a > l ? "HIT" : "MISS";
  if (s === "LESS") return a < l ? "HIT" : "MISS";
  return "UNKNOWN";
}

async function fetchJson(url) {
  const variants = [
    url,
    url.includes("/api/v1.1/game/") ? url.replace("/api/v1.1/game/", "/api/v1/game/") : null,
    url.includes("/feed/live") && !url.includes("?") ? `${url}?language=en` : null,
    url.includes("/api/v1.1/game/") && url.includes("/feed/live") && !url.includes("?")
      ? `${url.replace("/api/v1.1/game/", "/api/v1/game/")}?language=en`
      : null
  ].filter(Boolean);

  let lastErr = null;

  for (const candidate of [...new Set(variants)]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(candidate, {
          headers: {
            "Accept": "application/json,text/plain,*/*",
            "User-Agent": "Mozilla/5.0 mlb-prop-platform"
          }
        });

        if (r.ok) return await r.json();

        const text = await r.text().catch(() => "");
        lastErr = new Error(`fetch failed ${r.status}: ${candidate}${text ? ` | ${text.slice(0, 120)}` : ""}`);

        /*
          406 from MLB Stats API is usually endpoint/content negotiation weirdness.
          Do not waste retries on same candidate; try fallback URL variant.
        */
        if (r.status === 406 || r.status === 404) break;
      } catch (err) {
        lastErr = err;
      }

      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastErr || new Error(`fetch failed: ${url}`);
}

function isPitchEvent(ev) {
  return ev && ev.isPitch === true;
}

function pitchCount(play) {
  return (play.playEvents || []).filter(isPitchEvent).length;
}

function playPitcherName(play) {
  return play.matchup?.pitcher?.fullName || play.matchup?.pitcher?.person?.fullName || null;
}

function playPitcherId(play) {
  return play.matchup?.pitcher?.id || play.matchup?.pitcher?.person?.id || null;
}

function eventType(play) {
  return String(play.result?.eventType || play.result?.event || "").toLowerCase();
}

function outsOnPlay(play) {
  if (Number.isFinite(Number(play.result?.outs))) return Number(play.result.outs);

  const runners = play.runners || [];
  return runners.filter(r => {
    const event = String(r.details?.eventType || r.details?.event || "").toLowerCase();
    const out = r.movement?.isOut === true;
    return out || event.includes("out");
  }).length;
}

function runsOnPlay(play) {
  const runners = play.runners || [];
  const scoredRunners = runners.filter(r => r.movement?.end === "score").length;

  // Some MLB plays omit full runner movement; RBI is the safest fallback for inning micro grading.
  return Math.max(scoredRunners, num(play.result?.rbi, 0));
}

function buildPitcherInningStats(feed) {
  const map = new Map();
  const plays = feed.liveData?.plays?.allPlays || [];

  function ensure(gamePk, pitcherKey, inning) {
    const k = `${gamePk}|${pitcherKey}|${inning}`;
    if (!map.has(k)) {
      map.set(k, {
        gamePk,
        pitcherKey,
        inning,
        pitcher: null,
        pitcherId: null,
        strikeouts: 0,
        pitches_thrown: 0,
        pitching_outs: 0,
        hits_allowed: 0,
        runs_allowed: 0,
        walks_allowed: 0
      });
    }
    return map.get(k);
  }

  for (const play of plays) {
    const inning = Number(play.about?.inning);
    if (!Number.isFinite(inning) || inning < 1 || inning > 9) continue;

    const pitcher = playPitcherName(play);
    if (!pitcher) continue;

    const pitcherKey = normName(pitcher);
    const gamePk = feed.gamePk || feed.gameData?.game?.pk || null;
    const row = ensure(gamePk, pitcherKey, inning);

    row.pitcher = pitcher;
    row.pitcherId = playPitcherId(play);

    const ev = eventType(play);
    row.pitches_thrown += pitchCount(play);
    row.pitching_outs += outsOnPlay(play);

    if (ev.includes("strikeout")) row.strikeouts += 1;

    if (
      ev === "single" ||
      ev === "double" ||
      ev === "triple" ||
      ev === "home_run" ||
      ev === "home run"
    ) {
      row.hits_allowed += 1;
    }

    if (ev === "walk" || ev === "intent_walk" || ev === "intentional_walk") {
      row.walks_allowed += 1;
    }

    row.runs_allowed += runsOnPlay(play);
  }

  return map;
}


function normTeam(x) {
  const s = String(x || "").toUpperCase().replace(/\./g, "").trim();
  const map = {
    ARIZONA: "ARI", "D-BACKS": "ARI", DIAMONDBACKS: "ARI", ARI: "ARI", AZ: "ARI",
    ATLANTA: "ATL", BRAVES: "ATL", ATL: "ATL",
    BALTIMORE: "BAL", ORIOLES: "BAL", BAL: "BAL",
    BOSTON: "BOS", "RED SOX": "BOS", BOS: "BOS",
    CUBS: "CHC", CHC: "CHC",
    "WHITE SOX": "CWS", CWS: "CWS", CHW: "CWS",
    CINCINNATI: "CIN", REDS: "CIN", CIN: "CIN",
    CLEVELAND: "CLE", GUARDIANS: "CLE", CLE: "CLE",
    COLORADO: "COL", ROCKIES: "COL", COL: "COL",
    DETROIT: "DET", TIGERS: "DET", DET: "DET",
    HOUSTON: "HOU", ASTROS: "HOU", HOU: "HOU",
    KANSAS: "KC", ROYALS: "KC", KC: "KC", KCR: "KC",
    ANGELS: "LAA", LAA: "LAA",
    DODGERS: "LAD", LAD: "LAD",
    MIAMI: "MIA", MARLINS: "MIA", MIA: "MIA",
    MILWAUKEE: "MIL", BREWERS: "MIL", MIL: "MIL",
    MINNESOTA: "MIN", TWINS: "MIN", MIN: "MIN",
    METS: "NYM", NYM: "NYM",
    YANKEES: "NYY", NYY: "NYY",
    ATHLETICS: "ATH", ATH: "ATH", OAK: "ATH",
    PHILADELPHIA: "PHI", PHILLIES: "PHI", PHI: "PHI",
    PITTSBURGH: "PIT", PIRATES: "PIT", PIT: "PIT",
    PADRES: "SD", SD: "SD", SDP: "SD",
    GIANTS: "SF", SF: "SF", SFG: "SF",
    SEATTLE: "SEA", MARINERS: "SEA", SEA: "SEA",
    CARDINALS: "STL", STL: "STL",
    RAYS: "TB", TB: "TB", TBR: "TB",
    TEXAS: "TEX", RANGERS: "TEX", TEX: "TEX",
    TORONTO: "TOR", "BLUE JAYS": "TOR", TOR: "TOR",
    WASHINGTON: "WSH", NATIONALS: "WSH", WSH: "WSH", WAS: "WSH"
  };
  return map[s] || s;
}

function teamsFromGameText(game) {
  const txt = String(game || "").replace(/\s+/g, " ").trim();

  if (txt.includes("@")) {
    const parts = txt.split("@").map(x => normTeam(x.trim()));
    return parts.length === 2 ? parts : [];
  }

  if (txt.includes("/")) {
    const parts = txt.split("/").map(x => normTeam(x.trim()));
    return parts.length === 2 ? parts : [];
  }

  return [];
}

function buildGameInningStats(feed) {
  const gamePk = feed.gamePk || feed.gameData?.game?.pk || null;
  const away = normTeam(feed.gameData?.teams?.away?.abbreviation || feed.gameData?.teams?.away?.name);
  const home = normTeam(feed.gameData?.teams?.home?.abbreviation || feed.gameData?.teams?.home?.name);
  const map = new Map();
  const innings = feed.liveData?.linescore?.innings || [];

  for (const inningRow of innings) {
    const inning = Number(inningRow.num);
    if (!Number.isFinite(inning)) continue;

    const awayRuns = Number(inningRow.away?.runs || 0);
    const homeRuns = Number(inningRow.home?.runs || 0);
    const totalRuns = awayRuns + homeRuns;

    map.set(`${gamePk}|${inning}|total_runs`, {
      gamePk,
      inning,
      away,
      home,
      awayRuns,
      homeRuns,
      totalRuns,
      runs_allowed: totalRuns
    });
  }

  return map;
}


function playBatterName(play) {
  return play.matchup?.batter?.fullName || play.matchup?.batter?.person?.fullName || null;
}

function playBatterId(play) {
  return play.matchup?.batter?.id || play.matchup?.batter?.person?.id || null;
}

function hitterEventStats(play) {
  const ev = eventType(play);
  const stats = {
    hits: 0,
    singles: 0,
    doubles: 0,
    triples: 0,
    home_runs: 0,
    total_bases: 0,
    runs: 0,
    rbis: num(play.result?.rbi, 0),
    walks: 0,
    hit_by_pitch: 0,
    stolen_bases: 0
  };

  if (ev === "single") {
    stats.hits = 1;
    stats.singles = 1;
    stats.total_bases = 1;
  } else if (ev === "double") {
    stats.hits = 1;
    stats.doubles = 1;
    stats.total_bases = 2;
  } else if (ev === "triple") {
    stats.hits = 1;
    stats.triples = 1;
    stats.total_bases = 3;
  } else if (ev === "home_run" || ev === "home run") {
    stats.hits = 1;
    stats.home_runs = 1;
    stats.total_bases = 4;
    stats.runs = 1;
  } else if (ev === "walk" || ev === "intent_walk" || ev === "intentional_walk") {
    stats.walks = 1;
  } else if (ev === "hit_by_pitch") {
    stats.hit_by_pitch = 1;
  }

  for (const r of play.runners || []) {
    const runnerName = r.details?.runner?.fullName || r.runner?.fullName || null;
    const batterName = playBatterName(play);

    if (runnerName && batterName && normName(runnerName) === normName(batterName)) {
      if (r.movement?.end === "score") stats.runs = 1;
    }

    const runnerEvent = String(r.details?.eventType || r.details?.event || "").toLowerCase();
    if (runnerEvent === "stolen_base" || runnerEvent === "stolen base") {
      const runnerKey = normName(runnerName);
      const batterKey = normName(batterName);
      if (runnerKey && batterKey && runnerKey === batterKey) {
        stats.stolen_bases += 1;
      }
    }
  }

  return stats;
}

function buildHitterInningStats(feed) {
  const map = new Map();
  const plays = feed.liveData?.plays?.allPlays || [];

  function ensure(gamePk, hitterKey, inning) {
    const k = `${gamePk}|${hitterKey}|${inning}`;
    if (!map.has(k)) {
      map.set(k, {
        gamePk,
        hitterKey,
        inning,
        hitter: null,
        hitterId: null,
        hits: 0,
        singles: 0,
        doubles: 0,
        triples: 0,
        home_runs: 0,
        total_bases: 0,
        runs: 0,
        rbis: 0,
        walks: 0,
        hit_by_pitch: 0,
        stolen_bases: 0,
        hrr: 0,
        hitter_fantasy_score: 0
      });
    }
    return map.get(k);
  }

  for (const play of plays) {
    const inning = Number(play.about?.inning);
    if (!Number.isFinite(inning) || inning < 1 || inning > 9) continue;

    const hitter = playBatterName(play);
    if (!hitter) continue;

    const hitterKey = normName(hitter);
    const gamePk = feed.gamePk || feed.gameData?.game?.pk || null;
    const row = ensure(gamePk, hitterKey, inning);

    row.hitter = hitter;
    row.hitterId = playBatterId(play);

    const stats = hitterEventStats(play);
    for (const [k, v] of Object.entries(stats)) {
      row[k] += Number(v || 0);
    }

    row.hrr = row.hits + row.runs + row.rbis;
    row.hitter_fantasy_score =
      row.singles * 3 +
      row.doubles * 5 +
      row.triples * 8 +
      row.home_runs * 10 +
      row.runs * 2 +
      row.rbis * 2 +
      row.walks * 2 +
      row.hit_by_pitch * 2 +
      row.stolen_bases * 5;
  }

  return map;
}

function mergeMaps(target, source) {
  for (const [k, v] of source.entries()) target.set(k, v);
  return target;
}

async function fetchGameStats(gamePk) {
  const feed = await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
  feed.gamePk = gamePk;
  return {
    pitcherMap: buildPitcherInningStats(feed),
    gameMap: buildGameInningStats(feed),
    hitterMap: buildHitterInningStats(feed)
  };
}

async function main() {
  const rows = read(INPUT, []);
  const gamePks = [...new Set(rows.map(r => r.resolvedGamePk || r.gamePk).filter(Boolean))];

  const gameMaps = new Map();
  const skippedGames = [];

  for (const gamePk of gamePks) {
    try {
      gameMaps.set(String(gamePk), await fetchGameStats(gamePk));
    } catch (err) {
      skippedGames.push({
        gamePk: String(gamePk),
        error: err && err.message ? err.message : String(err)
      });
      console.warn(`WARN: skipping live gamePk ${gamePk}: ${err && err.message ? err.message : err}`);
    }
  }


  function parseInningRange(row) {
    if (Number.isFinite(Number(row.inningStart)) && Number.isFinite(Number(row.inningEnd))) {
      return {
        inningStart: Number(row.inningStart),
        inningEnd: Number(row.inningEnd)
      };
    }

    const raw = String(row.inningWindow || row.inningRange || row.inning || "").trim().toLowerCase();

    if (raw === "full") {
      return { inningStart: 1, inningEnd: 9 };
    }

    if (/^\d+$/.test(raw)) {
      const n = Number(raw);
      return { inningStart: n, inningEnd: n };
    }

    const range = raw.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      return {
        inningStart: Number(range[1]),
        inningEnd: Number(range[2])
      };
    }

    const plus = raw.match(/^(\d+)(?:\+\d+)+$/);
    if (plus) {
      const nums = raw.split("+").map(Number).filter(Number.isFinite);
      return {
        inningStart: Math.min(...nums),
        inningEnd: Math.max(...nums)
      };
    }

    return { inningStart: NaN, inningEnd: NaN };
  }

  const graded = rows.map(row => {
    const gamePk = row.resolvedGamePk || row.gamePk;
    const parsedRange = parseInningRange(row);
    const inningStart = parsedRange.inningStart;
    const inningEnd = parsedRange.inningEnd;
    const market = String(row.market || "").toLowerCase();
    const playerKey = normName(row.player);

    const reasons = [];
    if (!gamePk) reasons.push("missing_gamePk");
    if (gamePk && !gameMaps.has(String(gamePk))) reasons.push("game_feed_unavailable");
    if (!Number.isFinite(inningStart) || !Number.isFinite(inningEnd)) reasons.push("missing_inning_range");
    if (!playerKey) reasons.push("missing_player");
    if (!market) reasons.push("missing_market");

    let actual = null;
    let foundPitcher = false;

    if (!reasons.length) {
      const maps = gameMaps.get(String(gamePk));
      let total = 0;
      let foundAny = false;
      let unsupported = false;

      if (market === "runs_allowed" && teamsFromGameText(row.game).length === 2) {
        for (let inn = inningStart; inn <= inningEnd; inn++) {
          const statRow = maps?.gameMap?.get(`${gamePk}|${inn}|total_runs`);
          if (statRow) {
            foundAny = true;
            const v = Number(statRow.runs_allowed);
            if (Number.isFinite(v)) total += v;
            else unsupported = true;
          }
        }
      } else if (market === "hrr" || market === "hitter_fantasy_score") {
        for (let inn = inningStart; inn <= inningEnd; inn++) {
          const statRow = maps?.hitterMap?.get(`${gamePk}|${playerKey}|${inn}`);
          if (statRow) {
            foundAny = true;
            const v = Number(statRow[market]);
            if (Number.isFinite(v)) total += v;
            else unsupported = true;
          }
        }
      } else {
        for (let inn = inningStart; inn <= inningEnd; inn++) {
          const statRow = maps?.pitcherMap?.get(`${gamePk}|${playerKey}|${inn}`);
          if (statRow) {
            foundAny = true;
            foundPitcher = true;
            const v = Number(statRow[market]);
            if (Number.isFinite(v)) total += v;
            else unsupported = true;
          }
        }
      }

      if (foundAny && !unsupported) {
        actual = total;
      } else if (unsupported) {
        reasons.push("unsupported_market");
      } else if (String(row.status || "").toLowerCase() === "pre_game") {
        reasons.push("game_not_started");
      } else if (market === "runs_allowed") {
        reasons.push("game_inning_range_not_found");
      } else if (market === "hrr" || market === "hitter_fantasy_score") {
        reasons.push("hitter_inning_range_not_found");
      } else {
        reasons.push("pitcher_inning_range_not_found");
      }
    }

    const res = reasons.includes("game_not_started")
      ? "PENDING"
      : reasons.length
        ? "UNSUPPORTED"
        : result(actual, row.side, row.line);

    return {
      ...row,
      gradeDate: date,
      actual,
      result: res,
      gradeStatus: reasons.length ? "NOT_GRADED" : "GRADED",
      gradeReasons: reasons,
      foundPitcher,
      normalizedPlayerKey: playerKey
    };
  });

  write(OUT, graded);
  write(LATEST, graded);

  const hist = read(HISTORY, []).filter(r => r.date !== date);
  write(HISTORY, [...hist, ...graded]);

  const summary = graded.reduce((acc, r) => {
    const k = `${r.gradeStatus}:${r.result}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  console.log("MLB LIVE INNING GRADER");
  console.log("----------------------");
  console.log("date:", date);
  console.log("input:", INPUT);
  console.log("rows:", rows.length);
  console.log("games requested:", gamePks.length);
  console.log("games fetched:", gameMaps.size);
  console.log("games skipped:", skippedGames.length);
  if (skippedGames.length) console.table(skippedGames.slice(0, 20));
  console.table(Object.entries(summary).map(([bucket, count]) => ({ bucket, count })));
  console.log("saved:", OUT);
  console.log("saved:", LATEST);
  console.log("saved:", HISTORY);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
