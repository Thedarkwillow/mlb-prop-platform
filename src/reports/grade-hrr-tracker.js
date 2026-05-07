import fs from "fs";
import path from "path";
import { normTeam, canonicalGameKey } from "../utils/canonical-game-key.js";

const MLB_TEAM_ID_TO_ABBR = {
  108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC",
  113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU",
  118: "KC", 119: "LAD", 120: "WSH", 121: "NYM", 133: "ATH",
  134: "PIT", 135: "SD", 136: "SEA", 137: "SF", 138: "STL",
  139: "TB", 140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI",
  144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL"
};

function teamAbbr(teamObj) {
  const id = teamObj?.id;
  return normTeam(teamObj?.abbreviation) || MLB_TEAM_ID_TO_ABBR[id] || null;
}

const DATE = process.argv[2] || "2026-05-04";

function normalizeName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function str(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function getMarket(r) {
  return str(r.market, r.stat, r.statType, r.type, r.projectionType).toUpperCase();
}

function getDirection(r) {
  return str(r.direction, r.side, r.pick, r.choice).toUpperCase();
}

function getProb(r) {
  return num(r.prob, r.probability, r.recommendedProb, r.winProb);
}

function getEv(r) {
  return num(r.ev, r.expectedValue, r.edge, r.value);
}

function validForGrading(r) {
  const market = getMarket(r);
  const direction = getDirection(r);
  const line = num(r.line, r.value, r.target);
  const prob = getProb(r);
  const ev = getEv(r);
  const game = canonicalGameKey(r);

  return (
    market === "HRR" &&
    str(r.player, r.playerName) &&
    str(r.team) &&
    game &&
    Number.isFinite(line) &&
    Number.isFinite(prob) &&
    Number.isFinite(ev) &&
    prob > 0 &&
    ev > 0 &&
    ["MORE", "LESS", "OVER", "UNDER"].includes(direction)
  );
}

function findInputFile() {
  const files = [
    `outputs/history/${DATE}-hrr-tracking-report.json`,
    "outputs/hrr-tracker.json",
    "data/hrr-tracker.json"
  ];

  for (const f of files) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) return p;
  }

  throw new Error("No HRR tracker file found.");
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function resultFor(direction, actual, line) {
  if (actual === line) return "PUSH";
  if (direction === "MORE" || direction === "OVER") return actual > line ? "HIT" : "MISS";
  if (direction === "LESS" || direction === "UNDER") return actual < line ? "HIT" : "MISS";
  return "UNGRADED";
}

async function buildActuals(date) {
  const schedule = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const games = schedule.dates?.[0]?.games || [];

  const playerMap = new Map();
  const teamGameMap = new Map();

  for (const game of games) {
    const gamePk = game.gamePk;
    const away = teamAbbr(game.teams?.away?.team);
    const home = teamAbbr(game.teams?.home?.team);
    const gameKey = `${away} @ ${home}`;

    teamGameMap.set(away, gameKey);
    teamGameMap.set(home, gameKey);

    const box = await getJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);

    for (const side of ["away", "home"]) {
      const team = side === "away" ? away : home;
      const players = box.teams?.[side]?.players || {};

      for (const p of Object.values(players)) {
        const name = p.person?.fullName;
        if (!name) continue;

        const batting = p.stats?.batting || {};
        const hits = Number(batting.hits || 0);
        const runs = Number(batting.runs || 0);
        const rbi = Number(batting.rbi || 0);

        playerMap.set(`${team}|${normalizeName(name)}`, {
          player: name,
          team,
          gameKey,
          actual: hits + runs + rbi,
          hits,
          runs,
          rbi,
          atBats: Number(batting.atBats || 0),
          plateAppearances: Number(batting.plateAppearances || 0)
        });
      }
    }
  }

  return { playerMap, teamGameMap };
}

async function main() {
  const inputFile = findInputFile();
  console.log(`Using input: ${inputFile}`);
  console.log(`Grading date: ${DATE}`);

  const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.rows || raw.data || raw.results || raw.props || [];

  const hrrRows = rows.filter(r => getMarket(r) === "HRR");
  const validRows = hrrRows.filter(validForGrading);
  const invalidRows = hrrRows.filter(r => !validForGrading(r));

  const { playerMap, teamGameMap } = await buildActuals(DATE);

  const graded = [];
  const unmatched = [];

  for (const row of validRows) {
    const player = str(row.player, row.playerName);
    const team = normTeam(row.team);
    const actual = playerMap.get(`${team}|${normalizeName(player)}`);

    if (!actual) {
      unmatched.push({
        ...row,
        unmatchedReason: "player_not_found_in_boxscore",
        lookupKey: `${team}|${normalizeName(player)}`
      });
      continue;
    }

    const direction = getDirection(row);
    const line = num(row.line, row.value, row.target);

    graded.push({
      ...row,
      market: "HRR",
      player,
      team,
      direction,
      line,
      prob: getProb(row),
      ev: getEv(row),
      canonicalGameKey: teamGameMap.get(team) || canonicalGameKey(row),
      actual: actual.actual,
      hits: actual.hits,
      runs: actual.runs,
      rbi: actual.rbi,
      atBats: actual.atBats,
      plateAppearances: actual.plateAppearances,
      result: resultFor(direction, actual.actual, line)
    });
  }

  fs.mkdirSync("outputs/history", { recursive: true });

  fs.writeFileSync("outputs/graded-props.json", JSON.stringify(graded, null, 2));
  fs.writeFileSync("outputs/hrr-graded.json", JSON.stringify(graded, null, 2));
  fs.writeFileSync("outputs/hrr-unmatched.json", JSON.stringify([...invalidRows, ...unmatched], null, 2));
  fs.writeFileSync(`outputs/history/${DATE}-hrr-graded.json`, JSON.stringify(graded, null, 2));

  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const rate = hits + misses ? ((hits / (hits + misses)) * 100).toFixed(1) : "0.0";

  console.log("\nHRR GRADING SUMMARY");
  console.log("-------------------");
  console.log(`Raw HRR rows: ${hrrRows.length}`);
  console.log(`Valid projection rows: ${validRows.length}`);
  console.log(`Invalid projection rows: ${invalidRows.length}`);
  console.log(`Graded rows: ${graded.length}`);
  console.log(`Unmatched boxscore rows: ${unmatched.length}`);
  console.log(`Record: ${hits}-${misses}-${pushes}`);
  console.log(`Hit rate: ${rate}%`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
