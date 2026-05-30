const fs = require("fs");

const CURRENT = "outputs/manual/pickfinder-current-context-enriched.json";
const OUT_JSON = "outputs/manual/auto-pickfinder-hitter-signal.json";
const OUT_TXT = "outputs/manual/auto-pickfinder-hitter-signal.txt";

const HISTORY_ROOTS = [
  "outputs/history",
  "outputs/manual",
  "data/manual"
];

const HITTER_MARKETS = new Set([
  "hrr",
  "bases",
  "hits",
  "runs",
  "rbis",
  "walks",
  "singles",
  "doubles",
  "triples",
  "home_runs",
  "hitter_fantasy_score",
  "hitter_strikeouts"
]);

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function lower(v) {
  return String(v || "").toLowerCase();
}

function upper(v) {
  return String(v || "").toUpperCase();
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (v.player || v.playerName || v.name) out.push(v);

  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }

  return out;
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = `${dir}/${name}`;
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (!p.includes("node_modules")) walkFiles(p, out);
    } else if (p.endsWith(".json")) {
      out.push(p);
    }
  }
  return out;
}

function marketOf(r) {
  return lower(r.market || r.statType || r.type || r.projectionType || "");
}

function playerOf(r) {
  return r.player || r.playerName || r.name || "";
}

function sideOf(r) {
  return upper(r.side || r.pickSide || r.direction || "");
}

function resultOf(r) {
  return upper(r.result || r.outcome || r.grade || "");
}

function dateOf(r) {
  return String(r.date || r.slateDate || r.gameDate || r.createdAt || r.timestampUtc || "");
}

function actualOf(r) {
  return num(r.actual ?? r.actualValue ?? r.score ?? r.resultValue, null);
}

function lineOf(r) {
  return num(r.line ?? r.ppLine ?? r.projectionLine, null);
}

function hitFor(row) {
  const result = resultOf(row);
  if (result === "HIT") return true;
  if (result === "MISS") return false;

  const actual = actualOf(row);
  const line = lineOf(row);
  const side = sideOf(row);

  if (actual === null || line === null || !side) return null;
  if (actual === line) return null;

  if (side === "MORE") return actual > line;
  if (side === "LESS") return actual < line;

  return null;
}

function usableHistoryRow(r) {
  const player = playerOf(r);
  const market = marketOf(r);
  const side = sideOf(r);
  const line = lineOf(r);
  const hit = hitFor(r);

  return Boolean(
    player &&
    HITTER_MARKETS.has(market) &&
    side &&
    line !== null &&
    hit !== null
  );
}

function toHistoryRow(r, sourceFile) {
  return {
    sourceFile,
    date: dateOf(r),
    player: playerOf(r),
    playerKey: norm(playerOf(r)),
    market: marketOf(r),
    side: sideOf(r),
    line: lineOf(r),
    actual: actualOf(r),
    hit: hitFor(r),
    result: resultOf(r),
    team: upper(r.team || r.resolvedTeam || r.playerTeam || ""),
    opponent: upper(r.opponent || r.opp || r.opposingTeam || ""),
    homeAway: lower(r.homeAway || r.home_away || ""),
    opposingPitcher: r.opposingPitcher || r.probablePitcher || r.opponentPitcher || "",
    opposingPitcherKey: norm(r.opposingPitcher || r.probablePitcher || r.opponentPitcher || ""),
    opposingPitcherHand: upper(r.opposingPitcherHand || r.pitcherHand || r.opponentPitcherHand || ""),
    gamePk: r.gamePk || r.mlbGamePk || r.gameId || null
  };
}

function loadHistory() {
  const files = [];
  for (const root of HISTORY_ROOTS) walkFiles(root, files);

  const out = [];
  for (const file of files) {
    if (
      file.includes("node_modules") ||
      file.includes("pickfinder-current-context-enriched") ||
      file.includes("auto-pickfinder-hitter-signal")
    ) continue;

    const raw = readJson(file, null);
    if (!raw) continue;

    const rows = flatten(raw);
    for (const r of rows) {
      if (!usableHistoryRow(r)) continue;
      out.push(toHistoryRow(r, file));
    }
  }

  out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return out;
}

function summarize(rows) {
  const graded = rows.filter(r => r.hit !== null);
  const hits = graded.filter(r => r.hit).length;
  const misses = graded.filter(r => r.hit === false).length;

  return {
    sample: graded.length,
    hits,
    misses,
    hitRate: graded.length ? hits / graded.length : null
  };
}

function scoreMore(cur, splits) {
  let score = 0;
  const reasons = [];

  const checks = [
    ["L5", splits.last5, 0.7, 3.0],
    ["L10", splits.last10, 0.65, 2.5],
    ["L15", splits.last15, 0.6, 2.0],
    ["season", splits.season, 0.56, 1.5],
    ["homeAway", splits.homeAway, 0.58, 1.25],
    ["pitcherHand", splits.pitcherHand, 0.58, 1.25],
    ["homeAwayHand", splits.homeAwayHand, 0.6, 1.5],
    ["vsPitcher", splits.vsPitcher, 0.6, 1.5]
  ];

  for (const [label, s, threshold, points] of checks) {
    if (!s || !s.sample || s.hitRate === null) continue;
    if (s.hitRate >= threshold) {
      score += points;
      reasons.push(`${label}:positive:${Math.round(s.hitRate * 1000) / 10}%:n=${s.sample}`);
    } else if (s.sample >= 5 && s.hitRate < 0.45) {
      score -= points * 0.7;
      reasons.push(`${label}:weak:${Math.round(s.hitRate * 1000) / 10}%:n=${s.sample}`);
    }
  }

  const prob = num(cur.probability, null);
  const edge = num(cur.edge, null);
  const books = num(cur.books, null);

  if (prob !== null && prob >= 0.65) {
    score += 1.25;
    reasons.push(`prob_65_plus:${Math.round(prob * 1000) / 10}%`);
  }
  if (edge !== null && edge >= 0.08) {
    score += 1.0;
    reasons.push(`edge_8_plus:${Math.round(edge * 1000) / 10}%`);
  }
  if (books !== null && books >= 4) {
    score += 0.75;
    reasons.push(`book_support:${books}`);
  }

  return { score: Math.round(score * 1000) / 1000, reasons };
}

function scoreLess(cur, splits) {
  let score = 0;
  const reasons = [];

  const checks = [
    ["L5", splits.last5, 0.6, 3.0],
    ["L10", splits.last10, 0.58, 2.5],
    ["L15", splits.last15, 0.56, 2.0],
    ["season", splits.season, 0.54, 1.5],
    ["homeAway", splits.homeAway, 0.56, 1.25],
    ["pitcherHand", splits.pitcherHand, 0.56, 1.25],
    ["homeAwayHand", splits.homeAwayHand, 0.58, 1.5],
    ["vsPitcher", splits.vsPitcher, 0.58, 1.5]
  ];

  for (const [label, s, threshold, points] of checks) {
    if (!s || !s.sample || s.hitRate === null) continue;

    const lessRate = 1 - s.hitRate;
    if (lessRate >= threshold) {
      score += points;
      reasons.push(`${label}:cold_less_positive:${Math.round(lessRate * 1000) / 10}%:n=${s.sample}`);
    } else if (s.sample >= 5 && lessRate < 0.45) {
      score -= points * 0.7;
      reasons.push(`${label}:less_weak:${Math.round(lessRate * 1000) / 10}%:n=${s.sample}`);
    }
  }

  const prob = num(cur.probability, null);
  const edge = num(cur.edge, null);
  const books = num(cur.books, null);

  if (prob !== null && prob >= 0.58) {
    score += 1.25;
    reasons.push(`prob_58_plus:${Math.round(prob * 1000) / 10}%`);
  }
  if (edge !== null && edge >= 0.08) {
    score += 1.0;
    reasons.push(`edge_8_plus:${Math.round(edge * 1000) / 10}%`);
  }
  if (books !== null && books >= 3) {
    score += 0.75;
    reasons.push(`book_support:${books}`);
  }

  return { score: Math.round(score * 1000) / 1000, reasons };
}

function classFor(side, score, sample) {
  if (sample < 3) return "LOW_SAMPLE";
  if (side === "MORE") {
    if (score >= 8) return "ELITE_PICKFINDER_MORE";
    if (score >= 5.5) return "STRONG_PICKFINDER_MORE";
    if (score >= 3.5) return "GOOD_PICKFINDER_MORE";
    return "WEAK_PICKFINDER_MORE";
  }

  if (side === "LESS") {
    if (score >= 8) return "ELITE_PICKFINDER_LESS";
    if (score >= 5.5) return "STRONG_PICKFINDER_LESS";
    if (score >= 3.5) return "GOOD_PICKFINDER_LESS";
    return "WEAK_PICKFINDER_LESS";
  }

  return "UNKNOWN";
}

const currentRaw = readJson(CURRENT, {});
const currentRows = Array.isArray(currentRaw?.rows) ? currentRaw.rows : Array.isArray(currentRaw) ? currentRaw : [];
const history = loadHistory();

const scored = [];

for (const cur of currentRows) {
  const playerKey = norm(cur.player);
  const market = marketOf(cur);
  const side = sideOf(cur);
  const line = lineOf(cur);

  if (!playerKey || !HITTER_MARKETS.has(market) || !side || line === null) continue;

  const currentTeam = upper(cur.team || "");
  const pool = history.filter(h =>
    h.playerKey === playerKey &&
    h.market === market &&
    h.side === side &&
    h.line === line &&
    (!currentTeam || !h.team || h.team === currentTeam)
  );

  const last = pool.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const splits = {
    last5: summarize(last.slice(0, 5)),
    last10: summarize(last.slice(0, 10)),
    last15: summarize(last.slice(0, 15)),
    season: summarize(pool),
    homeAway: summarize(pool.filter(h => h.homeAway && cur.homeAway && h.homeAway === lower(cur.homeAway))),
    pitcherHand: summarize(pool.filter(h => h.opposingPitcherHand && cur.opposingPitcherHand && h.opposingPitcherHand === upper(cur.opposingPitcherHand))),
    homeAwayHand: summarize(pool.filter(h =>
      h.homeAway &&
      cur.homeAway &&
      h.opposingPitcherHand &&
      cur.opposingPitcherHand &&
      h.homeAway === lower(cur.homeAway) &&
      h.opposingPitcherHand === upper(cur.opposingPitcherHand)
    )),
    vsPitcher: summarize(pool.filter(h =>
      h.opposingPitcherKey &&
      cur.opposingPitcher &&
      h.opposingPitcherKey === norm(cur.opposingPitcher)
    ))
  };

  const primarySample = splits.season.sample;
  const scoredSide = side === "LESS" ? scoreLess(cur, splits) : scoreMore(cur, splits);

  const signalClass = classFor(side, scoredSide.score, primarySample);
  const finalScore = signalClass === "LOW_SAMPLE"
    ? Math.min(scoredSide.score, 2.999)
    : scoredSide.score;

  scored.push({
    player: cur.player,
    team: cur.team,
    market,
    side,
    line,
    tier: cur.tier,
    opponent: cur.opponent,
    homeAway: cur.homeAway,
    opposingPitcher: cur.opposingPitcher,
    opposingPitcherHand: cur.opposingPitcherHand,
    prob: cur.probability ?? null,
    edge: cur.edge ?? null,
    books: cur.books ?? null,
    pickfinderSignalClass: signalClass,
    pickfinderSignalScore: finalScore,
    reasons: scoredSide.reasons,
    splits,
    historySample: primarySample,
    mode: "RESEARCH_ONLY_NO_OFFICIAL_PROMOTION"
  });
}

scored.sort((a, b) => b.pickfinderSignalScore - a.pickfinderSignalScore);

const counts = {};
for (const r of scored) counts[r.pickfinderSignalClass] = (counts[r.pickfinderSignalClass] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  mode: "RESEARCH_ONLY_NO_OFFICIAL_PROMOTION",
  currentRows: currentRows.length,
  historicalRows: history.length,
  scoredRows: scored.length,
  counts,
  top: scored.slice(0, 50),
  all: scored
};

const lines = [];
lines.push("AUTO PICK FINDER HITTER SIGNAL");
lines.push("==============================");
lines.push(`mode: ${report.mode}`);
lines.push(`current rows: ${report.currentRows}`);
lines.push(`historical rows: ${report.historicalRows}`);
lines.push(`scored rows: ${report.scoredRows}`);
lines.push("");
lines.push("BY SIGNAL CLASS");
lines.push("---------------");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("TOP SIGNALS");
lines.push("-----------");
for (const r of scored.filter(x => x.pickfinderSignalClass !== "LOW_SAMPLE").slice(0, 25)) {
  lines.push(`- ${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line} | ${r.tier} | ${r.pickfinderSignalClass} score=${r.pickfinderSignalScore} sample=${r.historySample}`);
  lines.push(`  context: ${r.homeAway || "?"} vs ${r.opposingPitcher || "?"} (${r.opposingPitcherHand || "?"})`);
  if (r.reasons.length) lines.push(`  reasons: ${r.reasons.join(", ")}`);
}
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push("Pick Finder signal is research/watch support only. It does not create official plays yet.");

fs.mkdirSync("outputs/manual", { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
