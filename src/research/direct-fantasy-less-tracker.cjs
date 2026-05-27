const fs = require("fs");
const path = require("path");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = {
  board: "outputs/sportsbook-enriched-board.json",
  pricedBoard: "outputs/priced-board.json",
  fullBoardGraded: `outputs/history/${date}-full-board-graded.json`,
  fantasyGrades: `outputs/history/${date}-fantasy-grades.json`,
  gradedResults: "outputs/graded-results.json",
  out: `outputs/direct-fantasy-less-tracker-${date}.json`,
  latest: "outputs/direct-fantasy-less-tracker-latest.json",
  txt: `outputs/direct-fantasy-less-tracker-${date}.txt`,
  latestTxt: "outputs/direct-fantasy-less-tracker-latest.txt"
};

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

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function marketOf(row) {
  return norm(row.market || row.statType || row.stat_type || row.type);
}

function playerOf(row) {
  return row.player || row.name || row.playerName || row.player_name || row.description || null;
}

function teamOf(row) {
  return row.team || row.teamAbbr || row.team_abbr || row.projectionTeam || null;
}

function lineOf(row) {
  return num(row.line ?? row.ppLine ?? row.projectionLine ?? row.line_score ?? row.score, null);
}

function tierOf(row) {
  return norm(row.oddsTier || row.tier || row.projectionType || row.type || "standard") || "standard";
}

function canonicalFantasyMarket(market) {
  const m = norm(market);
  if (m.includes("hitter_fantasy_score")) return "hitter_fantasy_score";
  if (m.includes("pitcher_fantasy_score")) return "pitcher_fantasy_score";
  return m;
}

function isFantasyMarket(market) {
  const m = canonicalFantasyMarket(market);
  return m === "hitter_fantasy_score" || m === "pitcher_fantasy_score";
}

function fantasyKind(market) {
  const m = canonicalFantasyMarket(market);
  if (m === "hitter_fantasy_score") return "hitter";
  if (m === "pitcher_fantasy_score") return "pitcher";
  return "unknown";
}

function isStandardTier(row) {
  const tier = tierOf(row);
  return !tier || tier === "standard" || tier === "normal";
}

function key(player, market) {
  return `${norm(player)}|${norm(market)}`;
}

function getActual(row) {
  return num(
    row.actual ??
    row.actualValue ??
    row.actual_value ??
    row.fantasyScore ??
    row.fantasy_score ??
    row.score,
    null
  );
}

function resultForLess(actual, line) {
  if (actual === null || line === null) return "UNMATCHED";
  if (actual < line) return "HIT";
  if (actual > line) return "MISS";
  return "PUSH";
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const unmatched = rows.length - graded.length;
  const denom = hits + misses;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : null,
    roi: denom ? Number(((hits - misses) / denom).toFixed(4)) : null
  };
}

function lineBucket(line) {
  const n = num(line, null);
  if (n === null) return "unknown";
  if (n < 3) return "<3";
  if (n <= 4.5) return "3-4.5";
  if (n <= 6.5) return "5-6.5";
  if (n <= 8.5) return "7-8.5";
  if (n <= 10.5) return "9-10.5";
  if (n <= 12.5) return "11-12.5";
  return "13+";
}

const board = readJson(FILES.board, readJson(FILES.pricedBoard, []));
const fullBoardGraded = readJson(FILES.fullBoardGraded, []);
const fantasyGrades = readJson(FILES.fantasyGrades, []);
const gradedResults = readJson(FILES.gradedResults, []);

const actualIndex = new Map();

for (const source of [
  { name: FILES.fantasyGrades, rows: Array.isArray(fantasyGrades) ? fantasyGrades : [] },
  { name: FILES.fullBoardGraded, rows: Array.isArray(fullBoardGraded) ? fullBoardGraded : [] },
  { name: FILES.gradedResults, rows: Array.isArray(gradedResults) ? gradedResults : [] }
]) {
  for (const row of source.rows) {
    const player = playerOf(row);
    const market = canonicalFantasyMarket(marketOf(row));
    if (!player || !isFantasyMarket(market)) continue;
    const actual = getActual(row);
    if (actual === null) continue;
    const k = key(player, market);
    if (!actualIndex.has(k)) {
      actualIndex.set(k, { actual, source: source.name, sourceRow: row });
    }
  }
}

const candidates = [];

for (const row of Array.isArray(board) ? board : []) {
  const market = canonicalFantasyMarket(marketOf(row));
  if (!isFantasyMarket(market)) continue;
  if (!isStandardTier(row)) continue;

  const player = playerOf(row);
  const line = lineOf(row);
  if (!player || line === null) continue;

  const actualMatch = actualIndex.get(key(player, market)) || null;
  const actual = actualMatch ? actualMatch.actual : null;
  const result = resultForLess(actual, line);

  candidates.push({
    date,
    player,
    team: teamOf(row),
    market,
    fantasyKind: fantasyKind(market),
    side: "LESS",
    line,
    lineBucket: lineBucket(line),
    tier: "standard",
    result,
    actual,
    directLessTrackType: "STANDARD_BOARD_SIDE",
    source: "direct_standard_fantasy_less_from_board",
    actualSource: actualMatch ? actualMatch.source : null,
    originalBoard: {
      oddsTier: row.oddsTier ?? row.tier ?? null,
      game: row.game ?? row.matchup ?? null,
      projection: row.projection ?? row.projected ?? row.proj ?? null,
      prob: row.prob ?? row.trueProb ?? row.calibrated ?? null,
      sportsbookBookCount: row.sportsbookBookCount ?? row.books ?? null,
      support: row.marketSupportFlag ?? row.support ?? null,
      grade: row.qualityGrade ?? row.grade ?? null
    }
  });
}

const byBucket = new Map();
for (const r of candidates) {
  const b = `${r.market} | ${r.side} | ${r.lineBucket}`;
  if (!byBucket.has(b)) byBucket.set(b, []);
  byBucket.get(b).push(r);
}

const buckets = [...byBucket.entries()]
  .map(([bucket, rows]) => ({
    bucket,
    market: rows[0]?.market || null,
    side: "LESS",
    lineBucket: rows[0]?.lineBucket || null,
    ...summarize(rows)
  }))
  .sort((a, b) => (b.roi ?? -99) - (a.roi ?? -99) || (b.hitRate ?? -99) - (a.hitRate ?? -99) || b.graded - a.graded);

const output = {
  date,
  generatedAt: new Date().toISOString(),
  policy: {
    fantasyLessDirectTracking: true,
    fantasyLessPlayable: false,
    note: "Tracks direct standard Fantasy LESS availability from board-generated standard sides. Goblin/demon remain MORE-only."
  },
  sourceCounts: {
    boardRows: Array.isArray(board) ? board.length : 0,
    actualIndexedPlayers: actualIndex.size,
    directFantasyLessCandidates: candidates.length
  },
  summary: summarize(candidates),
  buckets,
  rows: candidates
};

const lines = [];
lines.push("DIRECT FANTASY LESS TRACKER");
lines.push("===========================");
lines.push(`date: ${date}`);
lines.push(`generatedAt: ${output.generatedAt}`);
lines.push("");
lines.push("POLICY");
lines.push("------");
lines.push("standard fantasy LESS = direct tracked");
lines.push("goblin/demon fantasy LESS = not allowed / not created");
lines.push("playable = false");
lines.push("");
lines.push("SUMMARY");
lines.push("-------");
lines.push(`rows=${output.summary.rows}`);
lines.push(`graded=${output.summary.graded}`);
lines.push(`hits=${output.summary.hits}`);
lines.push(`misses=${output.summary.misses}`);
lines.push(`pushes=${output.summary.pushes}`);
lines.push(`unmatched=${output.summary.unmatched}`);
lines.push(`hitRate=${pct(output.summary.hitRate)}`);
lines.push(`roi=${pct(output.summary.roi)}`);
lines.push("");
lines.push("BUCKETS");
lines.push("-------");
if (!buckets.length) {
  lines.push("none");
} else {
  for (const b of buckets) {
    lines.push(`${b.bucket}: rows=${b.rows} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)}`);
  }
}
lines.push("");
lines.push("SAMPLE ROWS");
lines.push("-----------");
for (const r of candidates.slice(0, 25)) {
  lines.push(`- ${r.player} | ${r.market} LESS ${r.line} | actual=${r.actual ?? "n/a"} | result=${r.result} | bucket=${r.lineBucket}`);
}

writeJson(FILES.out, output);
writeJson(FILES.latest, output);
writeText(FILES.txt, lines.join("\n"));
writeText(FILES.latestTxt, lines.join("\n"));

console.log(lines.join("\n"));
console.log("");
console.log("saved:", FILES.out);
console.log("saved:", FILES.latest);
console.log("saved:", FILES.txt);
console.log("saved:", FILES.latestTxt);
