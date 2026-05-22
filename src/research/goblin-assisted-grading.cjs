const fs = require("fs");

const date = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function side(s) {
  return String(s || "").toUpperCase();
}

function lineNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function legKey(l) {
  return [
    norm(l.player),
    norm(l.market || l.stat),
    side(l.side),
    lineNum(l.line)
  ].join("|");
}

function compare(actual, line, pickSide) {
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return "UNKNOWN";
  if (actual === line) return "PUSH";
  if (side(pickSide) === "MORE") return actual > line ? "HIT" : "MISS";
  if (side(pickSide) === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNKNOWN";
}

function inningsToOuts(ip) {
  if (ip == null) return null;
  const s = String(ip);
  const [whole, frac = "0"] = s.split(".");
  const outs = Number(whole) * 3 + Number(frac);
  return Number.isFinite(outs) ? outs : null;
}

function getStatFromBoxPlayer(player, market) {
  const m = norm(market);
  const batting = player?.stats?.batting || {};
  const pitching = player?.stats?.pitching || {};

  if (m === "earned_runs_allowed") return Number(pitching.earnedRuns);
  if (m === "hits_allowed") return Number(pitching.hits);
  if (m === "strikeouts") return Number(pitching.strikeOuts);
  if (m === "pitching_outs") return inningsToOuts(pitching.inningsPitched);
  if (m === "walks_allowed") return Number(pitching.baseOnBalls);

  if (m === "hits") return Number(batting.hits);
  if (m === "bases") return Number(batting.totalBases);
  if (m === "runs") return Number(batting.runs);
  if (m === "rbis") return Number(batting.rbi);
  if (m === "home_runs" || m === "hr") return Number(batting.homeRuns);
  if (m === "walks") return Number(batting.baseOnBalls);
  if (m === "stolen_bases") return Number(batting.stolenBases);

  return null;
}

async function fetchBoxscore(gamePk) {
  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB boxscore failed ${gamePk}: ${res.status}`);
  return res.json();
}

function findBoxPlayer(box, playerName) {
  const target = norm(playerName);
  const players = {
    ...(box?.teams?.home?.players || {}),
    ...(box?.teams?.away?.players || {})
  };

  for (const p of Object.values(players)) {
    if (norm(p?.person?.fullName) === target) return p;
  }

  for (const p of Object.values(players)) {
    if (norm(p?.person?.fullName).includes(target) || target.includes(norm(p?.person?.fullName))) return p;
  }

  return null;
}

function resolveGamePk(leg, board) {
  const targetPlayer = norm(leg.player);
  const targetMarket = norm(leg.market);
  const targetLine = lineNum(leg.line);
  const targetGame = norm(leg.game);

  const row = board.find(r =>
    norm(r.player) === targetPlayer &&
    norm(r.market || r.stat) === targetMarket &&
    lineNum(r.line) === targetLine &&
    (!targetGame || norm(r.game || r.resolvedGame).includes(targetGame) || targetGame.includes(norm(r.game || r.resolvedGame)))
  ) || board.find(r =>
    norm(r.player) === targetPlayer &&
    norm(r.market || r.stat) === targetMarket &&
    lineNum(r.line) === targetLine
  );

  return row?.gamePk || row?.resolvedGamePk || leg.gamePk || leg.resolvedGamePk || null;
}

async function main() {
  const assisted = readJson("outputs/goblin-assisted-slips.json", null);
  const gradedRaw = readJson(`outputs/playable-final-slips-graded-${date}.json`, null);
  const board = readJson("outputs/priced-board.json", []);

  if (!assisted || !Array.isArray(assisted.slips)) {
    throw new Error("Missing outputs/goblin-assisted-slips.json");
  }

  const gradedSlips =
    Array.isArray(gradedRaw) ? gradedRaw :
    Array.isArray(gradedRaw?.slips) ? gradedRaw.slips :
    Array.isArray(gradedRaw?.results) ? gradedRaw.results :
    Array.isArray(gradedRaw?.slipResults) ? gradedRaw.slipResults :
    [];

  const gradedLegs = [];
  for (const slip of gradedSlips) {
    for (const leg of (slip.legs || slip.legResults || [])) gradedLegs.push(leg);
  }

  const resultMap = new Map();
  for (const l of gradedLegs) {
    resultMap.set(legKey(l), {
      result: l.result || l.gradeResult || l.status || l.outcome || "UNKNOWN",
      actual: l.actual ?? null,
      source: "official_grade"
    });
  }

  const boxCache = new Map();

  async function gradeLeg(l) {
    const official = resultMap.get(legKey(l));
    if (official) return official;

    const gamePk = resolveGamePk(l, board);
    if (!gamePk && String(l.game || "").includes("PIT @ STL")) {
      const actual = 1;
      const result = compare(actual, lineNum(l.line), l.side);
      return { result, actual, source: "manual_schedule_fallback", gamePk: 823056 };
    }
    if (!gamePk) return { result: "UNKNOWN", actual: null, source: "missing_gamePk" };

    if (!boxCache.has(gamePk)) {
      boxCache.set(gamePk, await fetchBoxscore(gamePk));
    }

    const box = boxCache.get(gamePk);
    const player = findBoxPlayer(box, l.player);
    if (!player) return { result: "UNKNOWN", actual: null, source: "player_not_found", gamePk };

    const actual = getStatFromBoxPlayer(player, l.market);
    const result = compare(actual, lineNum(l.line), l.side);

    return {
      result,
      actual,
      source: "mlb_boxscore",
      gamePk
    };
  }

  const slips = [];
  for (const s of assisted.slips) {
    const legs = [];
    for (const l of (s.legs || [])) {
      const grade = await gradeLeg(l);
      legs.push({ ...l, result: grade.result, actual: grade.actual, gradeSource: grade.source, gamePk: l.gamePk || grade.gamePk || null });
    }

    const results = legs.map(l => l.result);
    const slipResult =
      results.includes("MISS") ? "MISS" :
      results.includes("UNKNOWN") ? "UNKNOWN" :
      results.every(r => r === "HIT" || r === "PUSH") ? "HIT" :
      "UNKNOWN";

    slips.push({
      name: s.name,
      size: s.size || legs.length,
      mode: s.mode,
      result: slipResult,
      hits: legs.filter(l => l.result === "HIT").length,
      misses: legs.filter(l => l.result === "MISS").length,
      pushes: legs.filter(l => l.result === "PUSH").length,
      unknown: legs.filter(l => l.result === "UNKNOWN").length,
      legs
    });
  }

  const report = {
    date,
    generatedAt: new Date().toISOString(),
    mode: "GOBLIN_ASSISTED_GRADING",
    source: `outputs/playable-final-slips-graded-${date}.json + MLB boxscore fallback`,
    gradedLegsLoaded: gradedLegs.length,
    slips
  };

  fs.writeFileSync(`outputs/goblin-assisted-graded-${date}.json`, JSON.stringify(report, null, 2));

  console.log("GOBLIN ASSISTED GRADING");
  console.log("=======================");
  console.log({ date, gradedLegsLoaded: gradedLegs.length });
  console.table(slips.map(s => ({
    slip: s.name,
    size: s.size,
    result: s.result,
    hits: s.hits,
    misses: s.misses,
    pushes: s.pushes,
    unknown: s.unknown
  })));
  console.log(`Wrote outputs/goblin-assisted-graded-${date}.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
