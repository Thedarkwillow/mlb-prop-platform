const fs = require("fs");

function getDate() {
  const arg = process.argv.find(x => /^--date=/.test(x));
  if (arg) return arg.replace(/^--date=/, "");
  const bare = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (bare) return bare;
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();
const DATED_INPUT = `outputs/history/${DATE}-reverse-hitter-signal.json`;
const LIVE_INPUT = "outputs/manual/auto-reverse-hitter-signal.json";
const INPUT = fs.existsSync(DATED_INPUT) ? DATED_INPUT : LIVE_INPUT;
const FULL = `outputs/history/${DATE}-full-board-graded.json`;
const OUT = `outputs/history/${DATE}-reverse-hitter-signal-graded.json`;
const TXT = `outputs/history/${DATE}-reverse-hitter-signal-graded.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function norm(v) {
  return s(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function player(r) { return s(r.player || r.playerName || r.name || r.athleteName); }
function team(r) { return s(r.team || r.resolvedTeam || r.rawTeam || r.abbrev); }
function market(r) { return s(r.market || r.statType || r.projectionType || r.type || r.stat).toLowerCase(); }
function side(r) { return s(r.side || r.pick || r.direction || r.recommendation).toUpperCase(); }
function line(r) { return n(r.line ?? r.target ?? r.value ?? r.statValue); }

function result(r) {
  const raw = s(r.result || r.outcome || r.grade || r.status).toLowerCase();
  if (["hit", "win", "won"].includes(raw)) return "hit";
  if (["miss", "loss", "lost"].includes(raw)) return "miss";
  if (["push", "tie"].includes(raw)) return "push";
  if (["refund", "dnp", "void"].includes(raw)) return "refund";
  if (r.hit === true) return "hit";
  if (r.hit === false) return "miss";
  return raw || "";
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (player(v) && market(v) && line(v) !== null) out.push(v);

  for (const val of Object.values(v)) flatten(val, out);
  return out;
}

function key(r, forcedSide = null) {
  return [
    norm(player(r)),
    norm(team(r)),
    norm(market(r)),
    forcedSide || side(r),
    String(line(r) ?? "")
  ].join("|");
}

function looseKey(r, forcedSide = null) {
  return [
    norm(player(r)),
    norm(market(r)),
    forcedSide || side(r),
    String(line(r) ?? "")
  ].join("|");
}

function oppositeSide(x) {
  const raw = String(x || "").toUpperCase();
  if (raw === "MORE") return "LESS";
  if (raw === "LESS") return "MORE";
  return "";
}

function inverseResult(res) {
  if (res === "hit") return "miss";
  if (res === "miss") return "hit";
  return res;
}

function emptyBucket() {
  return { total: 0, hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0, graded: 0, hitRate: null };
}
function inc(bucket, res) {
  bucket.total++;
  if (["hit", "miss", "push", "refund"].includes(res)) {
    bucket[res]++;
    bucket.graded++;
  } else {
    bucket.unmatched++;
  }
}
function finalize(bucket) {
  bucket.hitRate = bucket.graded ? Number((bucket.hit / bucket.graded).toFixed(4)) : null;
  return bucket;
}

fs.mkdirSync("outputs/history", { recursive: true });

const reverse = readJson(INPUT, {});
const candidatesRaw = flatten(reverse).filter(r => {
  const mk = market(r);
  const sd = side(r);
  return player(r) && mk && line(r) !== null && (sd === "MORE" || sd === "LESS");
});

const seen = new Set();
const candidates = [];
for (const r of candidatesRaw) {
  const k = looseKey(r);
  if (seen.has(k)) continue;
  seen.add(k);
  candidates.push(r);
}

if (!fs.existsSync(FULL)) {
  const msg = [
    "MISSING_FULL_BOARD_GRADE_SOURCE",
    `Expected: ${FULL}`,
    "Run postgame/full-board grading first.",
    "Refusing to write misleading matched=0 reverse hitter grading output."
  ].join("\n");

  fs.writeFileSync(TXT, msg + "\n");
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    date: DATE,
    error: "MISSING_FULL_BOARD_GRADE_SOURCE",
    expectedSource: FULL,
    input: INPUT,
    candidates: candidates.length,
    matched: 0,
    unmatched: candidates.length,
    graded: []
  }, null, 2));

  console.error(msg);
  if (process.env.ALLOW_MISSING_GRADE_SOURCE === "1") process.exit(0);
  process.exit(2);
}

const gradedRows = flatten(readJson(FULL, []));
const exact = new Map();
const loose = new Map();

for (const r of gradedRows) {
  const res = result(r);
  if (!res) continue;

  exact.set(key(r), r);

  const lk = looseKey(r);
  if (!loose.has(lk)) loose.set(lk, []);
  loose.get(lk).push(r);
}

const graded = [];
const bySignal = {};
const byMarket = {};

for (const c of candidates) {
  let match = exact.get(key(c));
  let matchType = "exact";
  let res = match ? result(match) : "";

  if (!match) {
    const options = loose.get(looseKey(c)) || [];
    if (options.length === 1) {
      match = options[0];
      matchType = "loose_unique";
      res = result(match);
    } else if (options.length > 1) {
      matchType = "loose_ambiguous";
    }
  }

  if (!match) {
    const opp = oppositeSide(side(c));
    if (opp) {
      match = exact.get(key(c, opp));
      if (match) {
        matchType = "inverse_exact";
        res = inverseResult(result(match));
      } else {
        const options = loose.get(looseKey(c, opp)) || [];
        if (options.length === 1) {
          match = options[0];
          matchType = "inverse_loose_unique";
          res = inverseResult(result(match));
        } else if (options.length > 1) {
          matchType = "inverse_loose_ambiguous";
        }
      }
    }
  }

  if (!match) res = "unmatched";

  const signal = s(c.signal || c.signalClass || c.reverseSignal || c.classification || "UNKNOWN");
  const mk = market(c) || "unknown";

  const row = {
    date: DATE,
    player: player(c),
    team: team(c),
    game: s(c.game || c.matchup),
    market: mk,
    side: side(c),
    line: line(c),
    probability: n(c.probability ?? c.prob ?? c.calibratedDistributionProb),
    projection: n(c.projection ?? c.contextAdjustedProjection ?? c.rawProjection),
    edge: n(c.edge ?? c.adjustedEdge),
    books: n(c.books ?? c.bookCount),
    signal,
    score: n(c.score),
    reasons: c.reasons || c.reasonCodes || [],
    result: res,
    actual: match?.actual ?? match?.value ?? match?.stat ?? null,
    matchType,
    gradedSource: match ? FULL : null,
    source: INPUT,
    lane: "reverse_hitter_signal",
    promotionEligible: false,
    promotionStatus: "RESEARCH_ONLY_UNTIL_ROLLING_GATE"
  };

  graded.push(row);

  bySignal[signal] ||= emptyBucket();
  byMarket[mk] ||= emptyBucket();

  inc(bySignal[signal], res);
  inc(byMarket[mk], res);
}

for (const obj of [bySignal, byMarket]) {
  for (const k of Object.keys(obj)) finalize(obj[k]);
}

const results = finalize(graded.reduce((b, x) => {
  inc(b, x.result);
  return b;
}, emptyBucket()));

const summary = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  lane: "reverse_hitter_signal",
  mode: "graded_research_lane_no_direct_official_promotion",
  input: INPUT,
  gradedSourceUsed: FULL,
  candidates: candidates.length,
  matched: graded.filter(x => x.result !== "unmatched").length,
  unmatched: graded.filter(x => x.result === "unmatched").length,
  results,
  bySignal,
  byMarket,
  graded
};

const lines = [];
lines.push("REVERSE HITTER SIGNAL GRADED");
lines.push("============================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  date: summary.date,
  mode: summary.mode,
  candidates: summary.candidates,
  matched: summary.matched,
  unmatched: summary.unmatched,
  results: summary.results,
  bySignal: summary.bySignal,
  byMarket: summary.byMarket
}, null, 2));
lines.push("");
lines.push("GRADED CANDIDATES");
lines.push("-----------------");
graded.slice(0, 80).forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.side} ${x.line} | signal=${x.signal} | score=${x.score ?? "?"} | result=${x.result} | actual=${x.actual ?? "?"} | match=${x.matchType}`);
});

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: summary.generatedAt,
  date: summary.date,
  candidates: summary.candidates,
  matched: summary.matched,
  unmatched: summary.unmatched,
  results: summary.results,
  bySignal: summary.bySignal,
  byMarket: summary.byMarket
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
