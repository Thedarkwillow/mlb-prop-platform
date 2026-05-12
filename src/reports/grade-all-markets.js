import fs from "fs";
import path from "path";
import { normTeam, canonicalGameKey } from "../utils/canonical-game-key.js";

const DATE = process.argv[2] || "2026-05-04";

const MLB_TEAM_ID_TO_ABBR = {
  108: "LAA", 109: "ARI", 110: "BAL", 111: "BOS", 112: "CHC",
  113: "CIN", 114: "CLE", 115: "COL", 116: "DET", 117: "HOU",
  118: "KC", 119: "LAD", 120: "WSH", 121: "NYM", 133: "ATH",
  134: "PIT", 135: "SD", 136: "SEA", 137: "SF", 138: "STL",
  139: "TB", 140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI",
  144: "ATL", 145: "CWS", 146: "MIA", 147: "NYY", 158: "MIL"
};

function teamAbbr(teamObj) {
  return normTeam(teamObj?.abbreviation) || MLB_TEAM_ID_TO_ABBR[teamObj?.id] || null;
}

function normalizeName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function str(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  return "";
}

function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function marketName(r) {
  return str(r.market, r.stat, r.statType, r.type, r.projectionType)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function sideName(r) {
  const s = str(r.side, r.direction, r.pick, r.choice).toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function getProb(r) {
  return num(r.prob, r.probability, r.recommendedProb, r.winProb);
}

function getEv(r) {
  return num(r.ev, r.expectedValue, r.edge, r.valueEV);
}

function getLine(r) {
  return num(r.line, r.target, r.value);
}

function findInputFile() {
  const files = [
    "outputs/slips.json",
    "outputs/merged-board.json",
    "outputs/slip-candidates.json",
    "outputs/candidates.json",
    "data/merged-board.json",
    "data/candidates.json"
  ];

  for (const f of files) {
    const p = path.resolve(process.cwd(), f);
    if (fs.existsSync(p)) return p;
  }

  throw new Error("No merged board/candidate file found.");
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function resultFor(side, actual, line) {
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return "UNGRADED";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNGRADED";
}

function actualForMarket(market, playerActual) {
  const b = playerActual.batting || {};
  const p = playerActual.pitching || {};

  const singles = Math.max(0, b.hits - b.doubles - b.triples - b.homeRuns);
  const totalBases = singles + 2 * b.doubles + 3 * b.triples + 4 * b.homeRuns;
  const hrr = b.hits + b.runs + b.rbi;

  if (market.includes("HRR")) return hrr;
  if (market === "HITS" || market === "HIT") return b.hits;
  if (market.includes("BASE")) return totalBases;
  if (market === "RUNS" || market === "RUN") return b.runs;
  if (market.includes("RBI")) return b.rbi;
  if (market.includes("HOME RUN")) return b.homeRuns;
  if (market.includes("STOLEN")) return b.stolenBases;

  if (market.includes("STRIKEOUT")) return p.strikeOuts;
  if (market.includes("PITCHING OUT")) return p.outs;
  if (market.includes("OUTS")) return p.outs;
  if (market.includes("HITS ALLOWED")) return p.hits;
  if (market.includes("EARNED RUN")) return p.earnedRuns;
  if (market.includes("RUNS ALLOWED")) return p.runs;
  if (market.includes("WALKS ALLOWED")) return p.baseOnBalls;

  return NaN;
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

      for (const x of Object.values(players)) {
        const name = x.person?.fullName;
        if (!name) continue;

        const battingRaw = x.stats?.batting || {};
        const pitchingRaw = x.stats?.pitching || {};

        const batting = {
          hits: Number(battingRaw.hits || 0),
          doubles: Number(battingRaw.doubles || 0),
          triples: Number(battingRaw.triples || 0),
          homeRuns: Number(battingRaw.homeRuns || 0),
          runs: Number(battingRaw.runs || 0),
          rbi: Number(battingRaw.rbi || 0),
          stolenBases: Number(battingRaw.stolenBases || 0)
        };

        const pitching = {
          strikeOuts: Number(pitchingRaw.strikeOuts || 0),
          outs: Number(pitchingRaw.outs || 0),
          hits: Number(pitchingRaw.hits || 0),
          runs: Number(pitchingRaw.runs || 0),
          earnedRuns: Number(pitchingRaw.earnedRuns || 0),
          baseOnBalls: Number(pitchingRaw.baseOnBalls || 0)
        };

        playerMap.set(`${team}|${normalizeName(name)}`, {
          player: name,
          team,
          gameKey,
          batting,
          pitching
        });
      }
    }
  }

  return { playerMap, teamGameMap };
}

function teamsFromGameKey(game) {
  return String(game || "")
    .replace(/\s+/g, " ")
    .split("@")
    .map(x => x.trim())
    .filter(Boolean);
}

function sameGameTeams(a, b) {
  const aa = teamsFromGameKey(a).sort().join("|");
  const bb = teamsFromGameKey(b).sort().join("|");
  return aa && bb && aa === bb;
}

function safeCanonicalGameKey(row, teamGameMap) {
  const rowGame = row.resolvedGame || row.game || row.rawGame || "";
  const byRow = canonicalGameKey({ ...row, game: rowGame });
  const byTeam = teamGameMap.get(normTeam(row.resolvedTeam || row.team || row.rawTeam));

  if (byTeam && rowGame && sameGameTeams(byTeam, rowGame)) return byTeam;
  if (byRow) return byRow;
  return byTeam || "unknown";
}

function addStat(map, key, result) {
  if (!map[key]) map[key] = { hits: 0, misses: 0, pushes: 0, ungraded: 0 };
  if (result === "HIT") map[key].hits++;
  else if (result === "MISS") map[key].misses++;
  else if (result === "PUSH") map[key].pushes++;
  else map[key].ungraded++;
}

function pct(s) {
  const d = s.hits + s.misses;
  return d ? `${((s.hits / d) * 100).toFixed(1)}%` : "0.0%";
}

function bucketProb(p) {
  if (!Number.isFinite(p)) return "unknown";
  if (p >= 0.80) return "80%+";
  if (p >= 0.70) return "70-79%";
  if (p >= 0.60) return "60-69%";
  if (p >= 0.55) return "55-59%";
  return "<55%";
}

function printGroup(title, map) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  for (const [k, s] of Object.entries(map).sort((a,b)=>(b[1].hits+b[1].misses)-(a[1].hits+a[1].misses))) {
    console.log(`${k}: ${s.hits}-${s.misses}-${s.pushes} | graded=${s.hits+s.misses} | hitRate=${pct(s)} | ungraded=${s.ungraded}`);
  }
}

async function main() {
  const inputFile = findInputFile();
  console.log(`Using input: ${inputFile}`);
  console.log(`Grading date: ${DATE}`);

  const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  let rows;
  if (Array.isArray(raw)) {
    if (raw.length && raw[0]?.legs) rows = raw.flatMap(s => s.legs || []);
    else rows = raw;
  } else if (Array.isArray(raw.slips)) {
    rows = raw.slips.flatMap(s => s.legs || []);
  } else {
    rows = raw.rows || raw.data || raw.props || raw.candidates || raw.legs || [];
  }

  const { playerMap, teamGameMap } = await buildActuals(DATE);

  const graded = [];
  const unmatched = [];

  for (const row of rows) {
    const player = str(row.player, row.playerName, row.name);
    const team = normTeam(str(row.team));
    const market = marketName(row);
    const side = sideName(row);
    const line = getLine(row);
    const prob = getProb(row);
    const ev = getEv(row);

    if (!player || !team || !market || !["MORE","LESS"].includes(side) || !Number.isFinite(line)) {
      unmatched.push({ ...row, unmatchedReason: "invalid_projection_shape" });
      continue;
    }

    const actualRow = playerMap.get(`${team}|${normalizeName(player)}`);

    if (!actualRow) {
      unmatched.push({ ...row, unmatchedReason: "player_not_found", lookupKey: `${team}|${normalizeName(player)}` });
      continue;
    }

    const actual = actualForMarket(market, actualRow);

    if (!Number.isFinite(actual)) {
      unmatched.push({ ...row, unmatchedReason: "unsupported_market", market });
      continue;
    }

    const result = resultFor(side, actual, line);

    graded.push({
      ...row,
      player,
      team,
      market,
      side,
      line,
      prob,
      ev,
      canonicalGameKey: safeCanonicalGameKey(row, teamGameMap),
      actual,
      result
    });
  }

  const overall = {};
  const byMarket = {};
  const bySide = {};
  const byMarketSide = {};
  const byLine = {};
  const byConf = {};
  const byProb = {};
  const byGame = {};
  const byTeam = {};

  for (const r of graded) {
    const conf = str(r.confidenceBucket, r.confidence, r.conf).toLowerCase() || "unknown";

    addStat(overall, "ALL", r.result);
    addStat(byMarket, r.market, r.result);
    addStat(bySide, r.side, r.result);
    addStat(byMarketSide, `${r.market} ${r.side}`, r.result);
    addStat(byLine, `${r.market} ${r.side} ${r.line}`, r.result);
    addStat(byConf, conf, r.result);
    addStat(byProb, bucketProb(r.prob), r.result);
    addStat(byGame, r.canonicalGameKey || "unknown", r.result);
    addStat(byTeam, r.team, r.result);
  }

  fs.mkdirSync("outputs/history", { recursive: true });
  fs.writeFileSync("outputs/all-markets-graded.json", JSON.stringify(graded, null, 2));
  fs.writeFileSync("outputs/all-markets-unmatched.json", JSON.stringify(unmatched, null, 2));
  fs.writeFileSync(`outputs/history/${DATE}-all-markets-graded.json`, JSON.stringify(graded, null, 2));
  fs.writeFileSync(`outputs/history/${DATE}-all-markets-unmatched.json`, JSON.stringify(unmatched, null, 2));

  console.log("\nALL MARKET GRADING SUMMARY");
  console.log("--------------------------");
  console.log(`Raw rows: ${rows.length}`);
  console.log(`Graded rows: ${graded.length}`);
  console.log(`Unmatched/excluded rows: ${unmatched.length}`);

  printGroup("Overall", overall);
  printGroup("By Market", byMarket);
  printGroup("By Side", bySide);
  printGroup("By Market + Side", byMarketSide);
  printGroup("By Confidence", byConf);
  printGroup("By Probability Bucket", byProb);
  printGroup("By Team", byTeam);

  console.log("\nWrote:");
  console.log("outputs/all-markets-graded.json");
  console.log("outputs/all-markets-unmatched.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
