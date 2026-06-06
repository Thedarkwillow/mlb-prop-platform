const fs = require("fs");
const path = require("path");
const { prizePicksSlipValidation } = require("./lib/prizepicks-slip-rules.cjs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const INPUT = "outputs/goblin-hrr-controlled-slips.json";
const GRADED = `outputs/history/${DATE}-full-board-graded.json`;
const OUT = `outputs/history/${DATE}-goblin-hrr-controlled-slips-graded.json`;
const TXT = `outputs/history/${DATE}-goblin-hrr-controlled-slips-graded.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function norm(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function market(v) {
  const t = String(v || "").toLowerCase();
  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis")) return "hrr";
  if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
  if (t.includes("strikeouts") || t.includes("strikeout")) return "strikeouts";
  if (t.includes("pitching outs") || t === "outs" || t.includes(" outs")) return "pitching_outs";
  if (t.includes("total bases") || t === "bases") return "bases";
  if (t.includes("hits allowed")) return "hits_allowed";
  if (t === "hits" || t.includes("batter hits") || t.includes("player hits")) return "hits";
  if (t.includes("earned") || t.includes("runs allowed") || t === "runs") return "earned_runs_allowed";
  if (t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walks")) return "walks";
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function side(v) {
  const s = String(v || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return s;
}

function line(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function player(x) {
  return x.player || x.playerName || x.name || "";
}

function team(x) {
  return x.resolvedTeam || x.team || x.rawTeam || x.playerTeam || "";
}

function key(x) {
  return [
    norm(player(x)),
    market(x.market || x.stat || x.projectionType || x.type),
    side(x.side || x.recommendedSide || x.playableSide),
    String(line(x.line ?? x.ppLine ?? x.prizepicksLine))
  ].join("|");
}

function resultOf(g) {
  const raw = String(g.result || g.grade || g.outcome || g.status || "").toUpperCase();
  if (raw.includes("HIT") || raw === "WIN") return "HIT";
  if (raw.includes("MISS") || raw === "LOSS") return "MISS";
  if (raw.includes("PUSH")) return "PUSH";
  if (raw.includes("REFUND") || raw.includes("DNP")) return "REFUND";

  const actual = Number(g.actual ?? g.actualValue ?? g.boxscoreValue);
  const ln = line(g.line);
  const sd = side(g.side || g.recommendedSide || g.playableSide);
  if (Number.isFinite(actual) && Number.isFinite(ln)) {
    if (actual === ln) return "PUSH";
    if (sd === "MORE") return actual > ln ? "HIT" : "MISS";
    if (sd === "LESS") return actual < ln ? "HIT" : "MISS";
  }

  return "UNMATCHED";
}

function actualOf(g) {
  return g.actual ?? g.actualValue ?? g.boxscoreValue ?? g.value ?? null;
}

const input = readJson(INPUT, null);
const gradedRows = readJson(GRADED, []);

if (!input || !Array.isArray(input.slips)) {
  console.error(`Missing or invalid ${INPUT}`);
  process.exit(1);
}

if (!Array.isArray(gradedRows) || !gradedRows.length) {
  console.error(`Missing or empty ${GRADED}`);
  process.exit(1);
}

const gradedIndex = new Map();
for (const g of gradedRows) {
  if (!g || typeof g !== "object") continue;
  gradedIndex.set(key(g), g);
}

const summary = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  input: INPUT,
  gradedSourceUsed: GRADED,
  slips: input.slips.length,
  bySize: {},
  results: { hit: 0, miss: 0, partialUnmatched: 0, allUnmatched: 0 },
  legResults: { hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0 },
  hrrAnchor: { hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0 },
  filler: { hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0 },
  byMarket: {}
};

function inc(obj, k) {
  obj[k] = (obj[k] || 0) + 1;
}

const gradedSlips = [];

for (const slip of input.slips) {
  const legs = Array.isArray(slip.legs) ? slip.legs : [];
  const validation = prizePicksSlipValidation(legs);

  const gradedLegs = legs.map(l => {
    const g = gradedIndex.get(key(l));
    const result = g ? resultOf(g) : "UNMATCHED";
    const role = l.role || (market(l.market || l.stat) === "hrr" ? "HRR_ANCHOR" : "FILLER");
    const m = market(l.market || l.stat);

    if (result === "HIT") summary.legResults.hit++;
    else if (result === "MISS") summary.legResults.miss++;
    else if (result === "PUSH") summary.legResults.push++;
    else if (result === "REFUND") summary.legResults.refund++;
    else summary.legResults.unmatched++;

    const roleObj = role === "HRR_ANCHOR" ? summary.hrrAnchor : summary.filler;
    if (result === "HIT") roleObj.hit++;
    else if (result === "MISS") roleObj.miss++;
    else if (result === "PUSH") roleObj.push++;
    else if (result === "REFUND") roleObj.refund++;
    else roleObj.unmatched++;

    const bucket = `${m}|${side(l.side)}`;
    summary.byMarket[bucket] ||= { total: 0, hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0 };
    summary.byMarket[bucket].total++;
    inc(summary.byMarket[bucket], result.toLowerCase());

    return {
      ...l,
      result,
      actual: g ? actualOf(g) : null,
      matched: !!g
    };
  });

  const hits = gradedLegs.filter(l => l.result === "HIT").length;
  const misses = gradedLegs.filter(l => l.result === "MISS").length;
  const unmatched = gradedLegs.filter(l => l.result === "UNMATCHED").length;
  const pushRefund = gradedLegs.filter(l => l.result === "PUSH" || l.result === "REFUND").length;
  const gradedCount = gradedLegs.length - unmatched;

  let slipResult = "MISS";
  if (unmatched === gradedLegs.length) slipResult = "ALL_UNMATCHED";
  else if (unmatched > 0) slipResult = "PARTIAL_UNMATCHED";
  else if (misses === 0 && hits + pushRefund === gradedLegs.length) slipResult = "HIT";

  const size = Number(slip.size || legs.length);
  summary.bySize[size] ||= { slips: 0, hit: 0, miss: 0, partialUnmatched: 0, allUnmatched: 0 };
  summary.bySize[size].slips++;
  if (slipResult === "HIT") summary.bySize[size].hit++;
  else if (slipResult === "MISS") summary.bySize[size].miss++;
  else if (slipResult === "PARTIAL_UNMATCHED") summary.bySize[size].partialUnmatched++;
  else summary.bySize[size].allUnmatched++;

  if (slipResult === "HIT") summary.results.hit++;
  else if (slipResult === "MISS") summary.results.miss++;
  else if (slipResult === "PARTIAL_UNMATCHED") summary.results.partialUnmatched++;
  else summary.results.allUnmatched++;

  gradedSlips.push({
    ...slip,
    result: slipResult,
    hits,
    misses,
    unmatched,
    gradedCount,
    prizePicksValidation: validation,
    legs: gradedLegs
  });
}

for (const b of Object.values(summary.byMarket)) {
  const graded = b.hit + b.miss;
  b.graded = graded;
  b.hitRate = graded ? b.hit / graded : null;
  b.roiProxy = graded ? (b.hit - b.miss) / graded : null;
}

for (const obj of [summary.hrrAnchor, summary.filler]) {
  const graded = obj.hit + obj.miss;
  obj.graded = graded;
  obj.hitRate = graded ? obj.hit / graded : null;
  obj.roiProxy = graded ? (obj.hit - obj.miss) / graded : null;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, slips: gradedSlips }, null, 2) + "\n");

const lines = [];
lines.push("CONTROLLED HRR GOBLIN SLIPS GRADED");
lines.push("===================================");
lines.push(JSON.stringify(summary, null, 2));

for (const slip of gradedSlips) {
  lines.push("");
  lines.push(`${slip.name} | ${slip.size}-man | ${slip.result} | hits=${slip.hits} misses=${slip.misses} unmatched=${slip.unmatched}`);
  lines.push(`PrizePicks valid=${slip.prizePicksValidation.valid} | teams=${[...slip.prizePicksValidation.teams].join(",")}`);
  for (const [i,l] of slip.legs.entries()) {
    lines.push(`${i + 1}. ${l.role || "-"} | ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | ${l.result} | actual=${l.actual ?? "?"}`);
  }
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
