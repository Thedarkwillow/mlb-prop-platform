const fs = require("fs");

const OUT_JSON = "outputs/manual/auto-reverse-hitter-signal.json";
const OUT_TXT = "outputs/manual/auto-reverse-hitter-signal.txt";

const SOURCES = [
  "outputs/priced-board.json",
  "outputs/final-slips.json",
  "outputs/blocked-final-candidates.json",
  "outputs/production-candidates.json"
];

const TARGET_MARKETS = new Set([
  "hrr",
  "bases",
  "hits",
  "runs",
  "rbis",
  "walks",
  "singles",
  "hitter_fantasy_score"
]);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function lower(v) {
  return String(v || "").toLowerCase();
}

function sideOf(r) {
  return String(r.side || r.pickSide || r.direction || "").toUpperCase();
}

function marketOf(r) {
  return lower(r.market || r.statType || r.type || "");
}

function lineOf(r) {
  return num(r.line ?? r.ppLine ?? r.projectionLine);
}

function playerOf(r) {
  return r.player || r.playerName || r.name || "";
}

function tierOf(r) {
  return lower(r.tier || r.oddsTier || r.projectionTier || "standard");
}

function projectionOf(r) {
  return num(
    r.projection ??
    r.projected ??
    r.mean ??
    r.componentProjection ??
    r.fantasyProjection ??
    r.modelProjection
  );
}

function probOf(r) {
  return num(r.prob ?? r.probability ?? r.calibratedProb ?? r.modelProb);
}

function edgeOf(r) {
  return num(r.edge ?? r.ev ?? r.adjEdge ?? r.expectedValue);
}

function key(r) {
  return [
    playerOf(r).toLowerCase(),
    marketOf(r),
    sideOf(r),
    String(lineOf(r))
  ].join("|");
}

function hitRateUnderFromField(r, names) {
  for (const name of names) {
    const v = r[name];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) {
      // Accept either 0-1 or 0-100.
      return n > 1 ? n / 100 : n;
    }
  }
  return null;
}

function avgFromField(r, names) {
  for (const name of names) {
    const n = Number(r[name]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function reverseScore(r) {
  const market = marketOf(r);
  const side = sideOf(r);
  const line = lineOf(r);
  const proj = projectionOf(r);
  const prob = probOf(r);
  const edge = edgeOf(r);
  const tier = tierOf(r);

  let score = 0;
  const reasons = [];

  if (!playerOf(r) || !TARGET_MARKETS.has(market) || side !== "LESS" || line === null) {
    return { eligible: false, score: 0, reasons: ["not_reverse_hitter_less_target"] };
  }

  if (["goblin", "demon"].includes(tier)) {
    return { eligible: false, score: 0, reasons: ["special_tier_less_not_playable"] };
  }

  if (proj !== null && proj < line) {
    const gap = line - proj;
    score += Math.min(4, gap * 1.5);
    reasons.push(`projection_below_line:${gap.toFixed(2)}`);
  }

  if (prob !== null && prob >= 0.58) {
    score += 2;
    reasons.push(`prob_58_plus:${(prob * 100).toFixed(1)}%`);
  } else if (prob !== null && prob >= 0.54) {
    score += 1;
    reasons.push(`prob_54_plus:${(prob * 100).toFixed(1)}%`);
  }

  if (edge !== null && edge > 0.08) {
    score += 1.5;
    reasons.push(`positive_edge:${edge.toFixed(3)}`);
  } else if (edge !== null && edge > 0.03) {
    score += 0.75;
    reasons.push(`small_positive_edge:${edge.toFixed(3)}`);
  }

  const last5Under = hitRateUnderFromField(r, [
    "last5UnderRate",
    "l5UnderRate",
    "L5UnderRate",
    "last5LessRate",
    "l5LessRate"
  ]);
  const last10Under = hitRateUnderFromField(r, [
    "last10UnderRate",
    "l10UnderRate",
    "L10UnderRate",
    "last10LessRate",
    "l10LessRate"
  ]);
  const last15Under = hitRateUnderFromField(r, [
    "last15UnderRate",
    "l15UnderRate",
    "L15UnderRate",
    "last15LessRate",
    "l15LessRate"
  ]);
  const seasonUnder = hitRateUnderFromField(r, [
    "seasonUnderRate",
    "seasonLessRate",
    "seasonUnderHitRate",
    "seasonLessHitRate"
  ]);

  for (const [label, rate, strong, solid] of [
    ["L5", last5Under, 0.7, 0.6],
    ["L10", last10Under, 0.65, 0.58],
    ["L15", last15Under, 0.6, 0.55],
    ["season", seasonUnder, 0.58, 0.52]
  ]) {
    if (rate === null) continue;
    if (rate >= strong) {
      score += 2;
      reasons.push(`${label}_under_strong:${(rate * 100).toFixed(1)}%`);
    } else if (rate >= solid) {
      score += 1;
      reasons.push(`${label}_under_solid:${(rate * 100).toFixed(1)}%`);
    }
  }

  const last5Avg = avgFromField(r, ["last5Avg", "l5Avg", "L5Avg", "recent5Avg"]);
  const last10Avg = avgFromField(r, ["last10Avg", "l10Avg", "L10Avg", "recent10Avg"]);
  const seasonAvg = avgFromField(r, ["seasonAvg", "seasonAverage"]);

  for (const [label, avg] of [
    ["L5_avg", last5Avg],
    ["L10_avg", last10Avg],
    ["season_avg", seasonAvg]
  ]) {
    if (avg === null) continue;
    if (avg < line) {
      score += 1;
      reasons.push(`${label}_below_line:${avg}`);
    }
  }

  const sideBias = String(r.sideBias?.tier || r.sideBiasTier || "").toUpperCase();
  const sideRoi = num(r.sideBias?.roi ?? r.sideROI ?? r.sideRoi);
  if (sideBias.includes("POSITIVE")) {
    score += 1;
    reasons.push(`positive_less_side_bias:${sideBias}`);
  }
  if (sideRoi !== null && sideRoi > 0.05) {
    score += 1;
    reasons.push(`positive_less_side_roi:${sideRoi.toFixed(3)}`);
  }

  const books = num(r.books ?? r.bookCount ?? r.numBooks);
  if (books !== null && books >= 3) {
    score += 0.5;
    reasons.push(`book_support:${books}`);
  }

  const matchupNotes = [];
  if (r.homeAway) matchupNotes.push(`homeAway=${r.homeAway}`);
  if (r.pitcherHand || r.opposingPitcherHand) matchupNotes.push(`hand=${r.pitcherHand || r.opposingPitcherHand}`);
  if (r.opposingPitcher || r.probablePitcher) matchupNotes.push(`vs=${r.opposingPitcher || r.probablePitcher}`);
  if (matchupNotes.length) reasons.push(`context:${matchupNotes.join(",")}`);

  let signal = "WEAK_REVERSE_SIGNAL";
  if (score >= 8) signal = "ELITE_REVERSE_SIGNAL";
  else if (score >= 6) signal = "STRONG_REVERSE_SIGNAL";
  else if (score >= 4) signal = "GOOD_REVERSE_SIGNAL";

  return {
    eligible: score >= 4,
    score: Math.round(score * 1000) / 1000,
    signal,
    reasons
  };
}

const byKey = new Map();

for (const file of SOURCES) {
  const raw = readJson(file, null);
  if (!raw) continue;
  for (const row of flatten(raw)) {
    const market = marketOf(row);
    const side = sideOf(row);
    if (!TARGET_MARKETS.has(market) || side !== "LESS") continue;
    const k = key(row);
    if (!byKey.has(k)) byKey.set(k, { ...row, sourceFiles: [file] });
    else {
      const existing = byKey.get(k);
      existing.sourceFiles = Array.from(new Set([...(existing.sourceFiles || []), file]));
      for (const [field, value] of Object.entries(row)) {
        if (existing[field] === undefined || existing[field] === null || existing[field] === "") {
          existing[field] = value;
        }
      }
    }
  }
}

const rows = [];
for (const row of byKey.values()) {
  const scored = reverseScore(row);
  rows.push({
    date: row.date || row.slateDate || process.env.npm_config_date || null,
    player: playerOf(row),
    team: row.team || row.resolvedTeam || null,
    game: row.game || row.resolvedGame || row.matchup || null,
    market: marketOf(row),
    side: sideOf(row),
    line: lineOf(row),
    tier: tierOf(row),
    projection: projectionOf(row),
    prob: probOf(row),
    edge: edgeOf(row),
    books: num(row.books ?? row.bookCount ?? row.numBooks),
    grade: row.grade || row.displayGrade || null,
    support: row.support || row.bookSupport || null,
    signal: scored.signal,
    score: scored.score,
    eligible: scored.eligible,
    reasons: scored.reasons,
    sourceFiles: row.sourceFiles || []
  });
}

rows.sort((a, b) =>
  Number(b.eligible) - Number(a.eligible) ||
  b.score - a.score ||
  (b.prob || 0) - (a.prob || 0)
);

const eligible = rows.filter(r => r.eligible);
const bySignal = {};
for (const r of rows) bySignal[r.signal] = (bySignal[r.signal] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  mode: "RESEARCH_ONLY_NO_OFFICIAL_PROMOTION",
  markets: Array.from(TARGET_MARKETS),
  total: rows.length,
  eligible: eligible.length,
  bySignal,
  rows,
  top: eligible.slice(0, 25)
};

const lines = [];
lines.push("AUTO REVERSE HITTER SIGNAL");
lines.push("==========================");
lines.push(`mode: ${report.mode}`);
lines.push(`total LESS candidates scanned: ${rows.length}`);
lines.push(`eligible reverse research candidates: ${eligible.length}`);
lines.push("");
lines.push("BY SIGNAL");
lines.push("---------");
for (const [k, v] of Object.entries(bySignal).sort((a, b) => b[1] - a[1])) {
  lines.push(`- ${k}: ${v}`);
}
lines.push("");
lines.push("TOP REVERSE RESEARCH CANDIDATES");
lines.push("--------------------------------");
if (!eligible.length) lines.push("none");
for (const r of eligible.slice(0, 25)) {
  lines.push(`- ${r.player} | ${r.team || "NA"} | ${r.market} ${r.side} ${r.line} | ${r.tier} | signal=${r.signal} score=${r.score} | prob=${r.prob ?? "n/a"} edge=${r.edge ?? "n/a"} books=${r.books ?? "n/a"}`);
  lines.push(`  reasons: ${r.reasons.join(", ")}`);
}
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push("Reverse hitter signal is research-only. It can identify cold/overvalued LESS profiles, but cannot create official plays yet.");

fs.mkdirSync("outputs/manual", { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
