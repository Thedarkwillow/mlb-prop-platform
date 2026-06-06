const fs = require("fs");

function argDate() {
  return process.argv.slice(2).find(x => /^\d{4}-\d{2}-\d{2}$/.test(x))
    || process.env.npm_config_date
    || new Date().toISOString().slice(0, 10);
}
const DATE = argDate();
const INPUT = "outputs/goblin-highprob-construction-ranked.json";
const GRADED = `outputs/history/${DATE}-full-board-graded.json`;
const OUT = `outputs/history/${DATE}-goblin-highprob-construction-graded.json`;
const TXT = `outputs/history/${DATE}-goblin-highprob-construction-graded.txt`;

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
  if (t.includes("hrr") || t.includes("hits+runs+rbis")) return "hrr";
  if (t.includes("fantasy")) return t.includes("pitcher") ? "pitcher_fantasy_score" : "hitter_fantasy_score";
  if (t.includes("earned") || t.includes("runs_allowed")) return "earned_runs_allowed";
  if (t.includes("hits_allowed") || t.includes("hits allowed")) return "hits_allowed";
  if (t.includes("strikeout")) return "strikeouts";
  if (t.includes("pitching_outs") || t.includes("pitching outs")) return "pitching_outs";
  if (t.includes("bases") || t.includes("total bases")) return "bases";
  if (t.includes("walks_allowed") || t.includes("walks allowed")) return "walks_allowed";
  if (t.includes("walk")) return "walks";
  if (t.includes("hit")) return "hits";
  return t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
function player(x) { return x?.player || x?.playerName || x?.name || ""; }
function team(x) { return x?.team || x?.resolvedTeam || x?.rawTeam || ""; }
function side(x) { return String(x?.side || x?.recommendedSide || x?.playableSide || "").toUpperCase(); }
function line(x) { return String(x?.line ?? x?.ppLine ?? x?.prizepicksLine ?? ""); }
function resultOf(x) {
  const r = String(x?.result || x?.grade || x?.outcome || x?.status || "").toUpperCase();
  if (r.includes("HIT") || r === "WIN") return "HIT";
  if (r.includes("MISS") || r === "LOSS") return "MISS";
  if (r.includes("PUSH")) return "PUSH";
  if (r.includes("REFUND") || r.includes("VOID")) return "REFUND";
  return "";
}
function keyExact(x) {
  return [norm(player(x)), market(x.market || x.stat || x.projectionType), side(x), line(x)].join("|");
}
function keyLoose(x) {
  return [norm(player(x)), market(x.market || x.stat || x.projectionType), side(x)].join("|");
}
function addBucket(obj, key, res) {
  obj[key] ||= { total: 0, hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0, graded: 0 };
  obj[key].total++;
  const k = String(res || "unmatched").toLowerCase();
  if (k === "hit") obj[key].hit++;
  else if (k === "miss") obj[key].miss++;
  else if (k === "push") obj[key].push++;
  else if (k === "refund") obj[key].refund++;
  else obj[key].unmatched++;
  obj[key].graded = obj[key].hit + obj[key].miss;
}
function finalizeBucket(b) {
  for (const v of Object.values(b)) {
    v.hitRate = v.graded ? v.hit / v.graded : null;
    v.roiProxy = v.graded ? (v.hit - v.miss) / v.graded : null;
  }
}

const data = readJson(INPUT, {});
const ranked = Array.isArray(data.ranked) ? data.ranked : [];
const gradedRows = readJson(GRADED, []);

const exact = new Map();
const loose = new Map();
for (const r of gradedRows) {
  if (!r || typeof r !== "object") continue;
  const res = resultOf(r);
  if (!res) continue;
  exact.set(keyExact(r), r);
  const lk = keyLoose(r);
  if (!loose.has(lk)) loose.set(lk, []);
  loose.get(lk).push(r);
}

function matchLeg(leg) {
  const ek = keyExact(leg);
  if (exact.has(ek)) return { row: exact.get(ek), match: "exact" };
  const list = loose.get(keyLoose(leg)) || [];
  if (list.length === 1) return { row: list[0], match: "loose_unique" };
  return { row: null, match: "unmatched" };
}

const bySize = {};
const byEntryType = {};
const byShape = {};
const byMarket = {};
const matchTypes = {};
const gradedSlips = [];

for (const slip of ranked) {
  const legGrades = [];
  for (const leg of slip.legs || []) {
    const m = matchLeg(leg);
    const res = m.row ? resultOf(m.row) : "UNMATCHED";
    matchTypes[m.match] = (matchTypes[m.match] || 0) + 1;
    addBucket(byMarket, `${market(leg.market || leg.stat || leg.projectionType)}|${side(leg)}`, res);
    legGrades.push({
      player: player(leg),
      team: team(leg),
      market: market(leg.market || leg.stat || leg.projectionType),
      side: side(leg),
      line: line(leg),
      result: res,
      actual: m.row?.actual ?? m.row?.actualValue ?? null,
      match: m.match
    });
  }

  const hits = legGrades.filter(x => x.result === "HIT").length;
  const misses = legGrades.filter(x => x.result === "MISS").length;
  const unmatched = legGrades.filter(x => x.result === "UNMATCHED").length;
  const pushes = legGrades.filter(x => x.result === "PUSH").length;
  const refunds = legGrades.filter(x => x.result === "REFUND").length;

  let slipResult = "MISS";
  if (misses === 0 && unmatched === 0 && hits > 0) slipResult = "HIT";
  else if (misses === 0 && unmatched > 0) slipResult = "PARTIAL_UNMATCHED";
  else if (misses > 0) slipResult = "MISS";

  const size = String(slip.size || (slip.legs || []).length);
  const et = slip.entryType || "UNKNOWN";
  const shape = `${size}|${et}`;

  for (const [bucket, key] of [[bySize, size], [byEntryType, et], [byShape, shape]]) {
    bucket[key] ||= { slips: 0, hit: 0, miss: 0, partialUnmatched: 0 };
    bucket[key].slips++;
    if (slipResult === "HIT") bucket[key].hit++;
    else if (slipResult === "PARTIAL_UNMATCHED") bucket[key].partialUnmatched++;
    else bucket[key].miss++;
  }

  gradedSlips.push({
    id: slip.id,
    size: slip.size,
    entryType: slip.entryType,
    lane: slip.lane,
    score: slip.score,
    result: slipResult,
    hits,
    misses,
    pushes,
    refunds,
    unmatched,
    legs: legGrades
  });
}

finalizeBucket(byMarket);

const summary = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  input: INPUT,
  gradedSourceUsed: GRADED,
  slips: gradedSlips.length,
  bySize,
  byEntryType,
  byShape,
  byMarket,
  matchTypes,
  results: {
    hit: gradedSlips.filter(x => x.result === "HIT").length,
    miss: gradedSlips.filter(x => x.result === "MISS").length,
    partialUnmatched: gradedSlips.filter(x => x.result === "PARTIAL_UNMATCHED").length
  },
  slipsGraded: gradedSlips
};

fs.mkdirSync(`outputs/history`, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

const lines = [];
lines.push("GOBLIN HIGH-PROB CONSTRUCTION GRADED");
lines.push("====================================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  date: summary.date,
  slips: summary.slips,
  results: summary.results,
  byShape: summary.byShape,
  byMarket: summary.byMarket,
  matchTypes: summary.matchTypes
}, null, 2));
lines.push("");
for (const s of gradedSlips.slice(0, 40)) {
  lines.push(`${s.id} | ${s.size}-man ${s.entryType} | ${s.result} | hits=${s.hits} misses=${s.misses} unmatched=${s.unmatched}`);
  s.legs.forEach((l, i) => lines.push(`${i+1}. ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | ${l.result} | actual=${l.actual ?? "?"} | match=${l.match}`));
  lines.push("");
}
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  date: summary.date,
  slips: summary.slips,
  results: summary.results,
  byShape: summary.byShape,
  matchTypes: summary.matchTypes
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
