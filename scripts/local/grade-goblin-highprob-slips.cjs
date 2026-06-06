const fs = require("fs");
const { prizePicksSlipValidation } = require("./lib/prizepicks-slip-rules.cjs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
const IN = "outputs/goblin-highprob-slips.json";
const FULL_BOARD_GRADED = `outputs/history/${DATE}-full-board-graded.json`;
const PP_BOARD_GRADED = `outputs/history/${DATE}-prizepicks-board-graded.json`;
const OUT = `outputs/history/${DATE}-goblin-highprob-slips-graded.json`;
const TXT = `outputs/history/${DATE}-goblin-highprob-slips-graded.txt`;

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
  if (t.includes("pitching outs") || t.includes("outs recorded") || t === "outs" || t.includes(" outs")) return "pitching_outs";
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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function player(r) {
  return r?.player || r?.playerName || r?.name || "";
}

function line(r) {
  return num(r?.line ?? r?.ppLine ?? r?.prizepicksLine);
}

function key(r) {
  return [
    norm(player(r)),
    market(r?.market || r?.stat || r?.projectionType || r?.type),
    side(r?.side || r?.recommendedSide),
    String(line(r))
  ].join("|");
}

function resultOf(r) {
  const raw = String(
    r?.result ||
    r?.gradeResult ||
    r?.outcome ||
    r?.status ||
    r?.gradingStatus ||
    ""
  ).toUpperCase();

  if (["HIT", "WIN", "WON", "CASH"].includes(raw)) return "HIT";
  if (["MISS", "LOSS", "LOST"].includes(raw)) return "MISS";
  if (["PUSH", "TIE"].includes(raw)) return "PUSH";
  if (["REFUND", "DNP", "VOID"].includes(raw)) return "REFUND";

  if (r?.hit === true) return "HIT";
  if (r?.hit === false) return "MISS";

  return raw || "UNKNOWN";
}

const built = readJson(IN, null);
const gradedRows = [
  ...readJson(FULL_BOARD_GRADED, []),
  ...readJson(PP_BOARD_GRADED, [])
].filter(x => x && typeof x === "object");

const index = new Map();
for (const r of gradedRows) {
  const k = key(r);
  if (!index.has(k)) index.set(k, []);
  index.get(k).push(r);
}

const slips = Array.isArray(built?.slips) ? built.slips : [];
const gradedSlips = slips.map(slip => {
  const legs = (slip.legs || []).map(leg => {
    const matches = index.get(key(leg)) || [];
    const match = matches[0] || null;
    const result = match ? resultOf(match) : "UNMATCHED";

    return {
      ...leg,
      gradingKey: key(leg),
      result,
      actual: match?.actual ?? match?.actualValue ?? match?.boxscoreValue ?? null,
      matched: !!match,
      matchedMarket: match ? market(match.market || match.stat) : null,
      matchedRaw: match
    };
  });

  const counts = {
    hit: legs.filter(l => l.result === "HIT").length,
    miss: legs.filter(l => l.result === "MISS").length,
    push: legs.filter(l => l.result === "PUSH").length,
    refund: legs.filter(l => l.result === "REFUND").length,
    unmatched: legs.filter(l => l.result === "UNMATCHED").length
  };

  const needed = slip.size || legs.length;
  const cleanLegs = needed - counts.refund - counts.push;
  const slipHit = counts.unmatched === 0 && counts.miss === 0 && counts.hit >= cleanLegs;

  return {
    ...slip,
    prizePicksValidation: prizePicksSlipValidation(legs),
    grade: {
      result: slipHit ? "HIT" : (counts.unmatched > 0 ? "PARTIAL_UNMATCHED" : "MISS"),
      ...counts
    },
    legs
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  input: IN,
  gradedSourceUsed: fs.existsSync(FULL_BOARD_GRADED) ? FULL_BOARD_GRADED : PP_BOARD_GRADED,
  slips: gradedSlips.length,
  bySize: {},
  results: {
    hit: gradedSlips.filter(s => s.grade.result === "HIT").length,
    miss: gradedSlips.filter(s => s.grade.result === "MISS").length,
    partialUnmatched: gradedSlips.filter(s => s.grade.result === "PARTIAL_UNMATCHED").length
  },
  legResults: {
    hit: gradedSlips.flatMap(s => s.legs).filter(l => l.result === "HIT").length,
    miss: gradedSlips.flatMap(s => s.legs).filter(l => l.result === "MISS").length,
    push: gradedSlips.flatMap(s => s.legs).filter(l => l.result === "PUSH").length,
    refund: gradedSlips.flatMap(s => s.legs).filter(l => l.result === "REFUND").length,
    unmatched: gradedSlips.flatMap(s => s.legs).filter(l => l.result === "UNMATCHED").length
  }
};

for (const s of gradedSlips) {
  const size = String(s.size || s.legs.length);
  summary.bySize[size] ||= { slips: 0, hit: 0, miss: 0, partialUnmatched: 0 };
  summary.bySize[size].slips++;
  if (s.grade.result === "HIT") summary.bySize[size].hit++;
  else if (s.grade.result === "MISS") summary.bySize[size].miss++;
  else summary.bySize[size].partialUnmatched++;
}

fs.mkdirSync(`outputs/history`, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ summary, slips: gradedSlips }, null, 2) + "\n");

const lines = [];
lines.push("GOBLIN HIGH-PROBABILITY SLIPS GRADED");
lines.push("====================================");
lines.push(JSON.stringify(summary, null, 2));
lines.push("");

for (const slip of gradedSlips) {
  lines.push(`${slip.name} | ${slip.size}-man | ${slip.grade.result} | hits=${slip.grade.hit} misses=${slip.grade.miss} unmatched=${slip.grade.unmatched}`);
  lines.push(`PrizePicks valid=${slip.prizePicksValidation.valid} | teams=${slip.prizePicksValidation.teams.join(",")}`);
  for (const [i, l] of slip.legs.entries()) {
    lines.push(`${i + 1}. ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | ${l.result} | actual=${l.actual ?? "?"}`);
  }
  lines.push("");
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
