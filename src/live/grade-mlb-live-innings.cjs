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
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return r.json();
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

async function fetchGameStats(gamePk) {
  const feed = await fetchJson(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
  feed.gamePk = gamePk;
  return buildPitcherInningStats(feed);
}

async function main() {
  const rows = read(INPUT, []);
  const gamePks = [...new Set(rows.map(r => r.resolvedGamePk || r.gamePk).filter(Boolean))];

  const gameMaps = new Map();
  for (const gamePk of gamePks) {
    gameMaps.set(String(gamePk), await fetchGameStats(gamePk));
  }

  const graded = rows.map(row => {
    const gamePk = row.resolvedGamePk || row.gamePk;
    const inning = Number(row.inningWindow);
    const market = String(row.market || "").toLowerCase();
    const playerKey = normName(row.player);

    const reasons = [];
    if (!gamePk) reasons.push("missing_gamePk");
    if (!Number.isFinite(inning)) reasons.push("missing_inningWindow");
    if (!playerKey) reasons.push("missing_player");
    if (!market) reasons.push("missing_market");

    let actual = null;
    let foundPitcher = false;

    if (!reasons.length) {
      const gameMap = gameMaps.get(String(gamePk));
      const statRow = gameMap?.get(`${gamePk}|${playerKey}|${inning}`);

      if (statRow) {
        foundPitcher = true;
        actual = statRow[market];

        if (!Number.isFinite(Number(actual))) {
          reasons.push("unsupported_market");
        }
      } else {
        reasons.push("pitcher_inning_not_found");
      }
    }

    const res = reasons.length ? "UNSUPPORTED" : result(actual, row.side, row.line);

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
  console.log("games fetched:", gamePks.length);
  console.table(Object.entries(summary).map(([bucket, count]) => ({ bucket, count })));
  console.log("saved:", OUT);
  console.log("saved:", LATEST);
  console.log("saved:", HISTORY);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
