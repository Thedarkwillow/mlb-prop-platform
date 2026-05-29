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
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\\n") ? text : text + "\\n");
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

function normName(v) {
  return norm(v)
    .replace(/jr\\.?|sr\\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function marketOf(row) {
  const raw = norm(row.market ?? row.stat ?? row.type ?? row.statType ?? row.stat_type);
  if (raw.includes("pitcher") && raw.includes("fantasy")) return "pitcher_fantasy_score";
  if (raw.includes("hitter") && raw.includes("fantasy")) return "hitter_fantasy_score";
  if (raw === "fantasy score" || raw === "fantasy_score") return "fantasy_score";
  return raw;
}

function sideOf(row) {
  return String(row.side ?? row.recommendedSide ?? row.pick ?? "").trim().toUpperCase();
}

function lineOf(row) {
  return num(row.line ?? row.ppLine ?? row.target ?? row.projectionLine, null);
}

function resultOf(row) {
  return String(row.result ?? row.outcome ?? row.gradeResult ?? "").trim().toUpperCase();
}

function actualOf(row) {
  return num(
    row.actual ??
    row.actualValue ??
    row.finalValue ??
    row.score ??
    row.fantasyScore ??
    row.hitter_fantasy_score ??
    row.pitcher_fantasy_score,
    null
  );
}

function roleOf(row) {
  const market = marketOf(row);
  if (market === "pitcher_fantasy_score") return "pitcher";
  if (market === "hitter_fantasy_score") return "hitter";
  const raw = norm(row.role ?? row.playerType ?? row.positionType ?? row.type);
  if (raw.includes("pitch")) return "pitcher";
  return "hitter";
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

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  const looksLikeRow =
    v.player ||
    v.playerName ||
    v.market ||
    v.stat ||
    v.type ||
    v.statType ||
    v.result ||
    v.outcome;

  if (looksLikeRow) out.push(v);

  for (const key of ["rows", "data", "results", "grades", "items", "legs"]) {
    if (v[key]) flatten(v[key], out);
  }

  return out;
}

function fantasyScoringFromBoxLike(row) {
  const market = marketOf(row);

  if (market === "hitter_fantasy_score") {
    const singles = num(row.singles, 0);
    const doubles = num(row.doubles, 0);
    const triples = num(row.triples, 0);
    const homeRuns = num(row.home_runs ?? row.homeRuns, 0);
    const runs = num(row.runs, 0);
    const rbis = num(row.rbis ?? row.rbi, 0);
    const walks = num(row.walks ?? row.baseOnBalls, 0);
    const hbp = num(row.hit_by_pitch ?? row.hitByPitch, 0);
    const sb = num(row.stolen_bases ?? row.stolenBases, 0);

    const hasAny = [
      singles,
      doubles,
      triples,
      homeRuns,
      runs,
      rbis,
      walks,
      hbp,
      sb
    ].some(x => Number(x) > 0);

    if (!hasAny && actualOf(row) === null) return null;

    return (
      singles * 3 +
      doubles * 5 +
      triples * 8 +
      homeRuns * 10 +
      runs * 2 +
      rbis * 2 +
      walks * 2 +
      hbp * 2 +
      sb * 5
    );
  }

  if (market === "pitcher_fantasy_score") {
    const wins = num(row.wins ?? row.win, 0);
    const qualityStarts = num(row.quality_starts ?? row.qualityStart, 0);
    const earnedRuns = num(row.earned_runs ?? row.earnedRuns, 0);
    const strikeouts = num(row.strikeouts, 0);
    const outs = num(row.outs ?? row.pitching_outs, null);

    if (outs === null && actualOf(row) === null) return null;

    return (
      wins * 6 +
      qualityStarts * 4 +
      earnedRuns * -3 +
      strikeouts * 3 +
      num(outs, 0)
    );
  }

  return actualOf(row);
}

function makeKey(row) {
  return [
    normName(row.player ?? row.playerName),
    marketOf(row),
    String(lineOf(row) ?? "")
  ].join("|");
}

function makeLooseKey(row) {
  return [
    normName(row.player ?? row.playerName),
    marketOf(row)
  ].join("|");
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched: rows.filter(r => r.result === "UNMATCHED").length,
    hitRate: graded.length ? Number((hits / (hits + misses || 1)).toFixed(4)) : null,
    roi: graded.length ? Number(((hits - misses) / (hits + misses || 1)).toFixed(4)) : null
  };
}

function groupSummary(rows, fn) {
  const m = new Map();
  for (const row of rows) {
    const k = fn(row);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }
  return [...m.entries()]
    .map(([key, rows]) => ({ key, ...summarize(rows) }))
    .sort((a, b) => b.graded - a.graded || (b.hitRate ?? -1) - (a.hitRate ?? -1));
}

const boardRows = [
  ...flatten(readJson(FILES.board, [])),
  ...flatten(readJson(FILES.pricedBoard, []))
];

const directLessRows = boardRows.filter(row => {
  const market = marketOf(row);
  return (
    ["hitter_fantasy_score", "pitcher_fantasy_score"].includes(market) &&
    sideOf(row) === "LESS"
  );
});

const gradeSources = [
  { source: FILES.fantasyGrades, rows: flatten(readJson(FILES.fantasyGrades, [])) },
  { source: FILES.fullBoardGraded, rows: flatten(readJson(FILES.fullBoardGraded, [])) },
  { source: FILES.gradedResults, rows: flatten(readJson(FILES.gradedResults, [])) }
];

const exactIndex = new Map();
const looseIndex = new Map();

for (const src of gradeSources) {
  for (const row of src.rows) {
    const market = marketOf(row);
    if (!["hitter_fantasy_score", "pitcher_fantasy_score"].includes(market)) continue;

    const actual = fantasyScoringFromBoxLike(row);
    const normalized = {
      ...row,
      sourceFile: src.source,
      player: row.player ?? row.playerName,
      market,
      line: lineOf(row),
      actual
    };

    const k = makeKey(normalized);
    const lk = makeLooseKey(normalized);
    if (!exactIndex.has(k)) exactIndex.set(k, normalized);
    if (!looseIndex.has(lk)) looseIndex.set(lk, normalized);
  }
}

const tracked = directLessRows.map(row => {
  const market = marketOf(row);
  const line = lineOf(row);
  const base = {
    date,
    player: row.player ?? row.playerName ?? null,
    team: row.team ?? row.resolvedTeam ?? null,
    market,
    role: roleOf(row),
    side: "LESS",
    line,
    oddsTier: row.oddsTier ?? row.tier ?? row.specialTier ?? "standard",
    prob: num(row.prob ?? row.recommendedProb ?? row.calibratedDistributionProb, null),
    edge: num(row.edge ?? row.expectedValue ?? row.adjustedEdge, null),
    books: num(row.books ?? row.bookCount ?? row.sportsbookBookCount, null),
    support: row.support ?? row.marketSupportFlag ?? row.priceCoverageTier ?? null,
    lineBucket: lineBucket(line),
    playable: false
  };

  const exact = exactIndex.get(makeKey(base));
  const loose = looseIndex.get(makeLooseKey(base));
  const match = exact || loose || null;
  const actual = match ? fantasyScoringFromBoxLike({ ...match, market }) : null;

  let result = "UNMATCHED";
  if (actual !== null && line !== null) {
    if (actual < line) result = "HIT";
    else if (actual > line) result = "MISS";
    else result = "PUSH";
  }

  return {
    ...base,
    actual,
    result,
    matchType: exact ? "EXACT_PLAYER_MARKET_LINE" : loose ? "LOOSE_PLAYER_MARKET" : "UNMATCHED",
    sourceFile: match?.sourceFile ?? null
  };
});

const output = {
  date,
  generatedAt: new Date().toISOString(),
  policy: {
    playable: false,
    reason: "Fantasy LESS remains direct-tracked only. Do not feed official/actionable until direct sample and ROI stabilize.",
    standardFantasyLess: "DIRECT_TRACK_ONLY",
    goblinDemonFantasyLess: "NOT_ALLOWED_OR_TRACK_ONLY"
  },
  files: FILES,
  summary: summarize(tracked),
  byMarket: groupSummary(tracked, r => r.market),
  byRole: groupSummary(tracked, r => r.role),
  byLineBucket: groupSummary(tracked, r => `${r.market}|${r.lineBucket}`),
  byTier: groupSummary(tracked, r => r.oddsTier),
  rows: tracked
};

const lines = [];
lines.push("DIRECT FANTASY LESS TRACKER v2");
lines.push("==============================");
lines.push(`date: ${date}`);
lines.push(`generatedAt: ${output.generatedAt}`);
lines.push("");
lines.push("POLICY");
lines.push("------");
lines.push("Fantasy LESS = direct tracked only");
lines.push("Playable = false");
lines.push(output.policy.reason);
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
lines.push("BY MARKET");
lines.push("---------");
for (const b of output.byMarket) {
  lines.push(`${b.key}: rows=${b.rows} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)}`);
}
lines.push("");
lines.push("BY LINE BUCKET");
lines.push("--------------");
for (const b of output.byLineBucket) {
  lines.push(`${b.key}: rows=${b.rows} graded=${b.graded} hits=${b.hits} misses=${b.misses} pushes=${b.pushes} unmatched=${b.unmatched} hitRate=${pct(b.hitRate)} roi=${pct(b.roi)}`);
}
lines.push("");
lines.push("SAMPLE ROWS");
lines.push("-----------");
for (const r of tracked.slice(0, 25)) {
  lines.push(`- ${r.player} | ${r.market} LESS ${r.line} | actual=${r.actual ?? "n/a"} | result=${r.result} | bucket=${r.lineBucket} | match=${r.matchType}`);
}

writeJson(FILES.out, output);
writeJson(FILES.latest, output);
writeText(FILES.txt, lines.join("\n"));
writeText(FILES.latestTxt, lines.join("\n"));

console.log(lines.join("\n"));
console.log("saved:", FILES.out);
console.log("saved:", FILES.latest);
console.log("saved:", FILES.txt);
console.log("saved:", FILES.latestTxt);
