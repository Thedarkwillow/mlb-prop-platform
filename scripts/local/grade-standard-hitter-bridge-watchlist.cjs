const fs = require("fs");

function getDate() {
  const argvDate = process.argv.slice(2).find(x =>
    /^\d{4}-\d{2}-\d{2}$/.test(x) || /^--date=\d{4}-\d{2}-\d{2}$/.test(x)
  );
  if (argvDate) return argvDate.replace(/^--date=/, "");
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();
const WATCH = "outputs/standard-hitter-bridge-watchlist.json";
const FULL_BOARD_GRADE = `outputs/history/${DATE}-full-board-graded.json`;
const OUT = `outputs/history/${DATE}-standard-hitter-bridge-watchlist-graded.json`;
const TXT = `outputs/history/${DATE}-standard-hitter-bridge-watchlist-graded.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function arr(v) {
  return Array.isArray(v) ? v : [];
}
function norm(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function market(r) {
  return s(r.market || r.statType || r.projectionType || r.type).toLowerCase();
}
function player(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}
function team(r) {
  return s(r.team || r.resolvedTeam || r.rawTeam || r.abbrev);
}
function side(r) {
  return s(r.side || r.pick || r.direction || r.recommendation).toUpperCase();
}
function line(r) {
  return n(r.line ?? r.target ?? r.value ?? r.statValue);
}
function result(r) {
  const raw = s(r.result || r.outcome || r.grade || r.status).toLowerCase();
  if (["hit", "win", "won", "over", "under"].includes(raw)) return "hit";
  if (["miss", "loss", "lost"].includes(raw)) return "miss";
  if (["push", "tie"].includes(raw)) return "push";
  if (["refund", "dnp", "void"].includes(raw)) return "refund";
  return raw || "";
}
function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (player(v) || market(v) || result(v)) out.push(v);
  for (const val of Object.values(v)) flatten(val, out);
  return out;
}
function key(r) {
  return [norm(player(r)), norm(team(r)), norm(market(r)), side(r), String(line(r) ?? "")].join("|");
}
function looseKey(r) {
  return [norm(player(r)), norm(market(r)), side(r), String(line(r) ?? "")].join("|");
}

function oppositeSide(x) {
  const raw = String(x || "").toUpperCase();
  if (raw === "MORE") return "LESS";
  if (raw === "LESS") return "MORE";
  return "";
}

function inverseResult(res) {
  const raw = String(res || "").toLowerCase();
  if (raw === "hit") return "miss";
  if (raw === "miss") return "hit";
  return raw;
}

function inverseKey(r) {
  return [norm(player(r)), norm(team(r)), norm(market(r)), oppositeSide(side(r)), String(line(r) ?? "")].join("|");
}

function inverseLooseKey(r) {
  return [norm(player(r)), norm(market(r)), oppositeSide(side(r)), String(line(r) ?? "")].join("|");
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

const watch = readJson(WATCH, {});
const candidates = arr(watch.candidates);

if (!fs.existsSync(FULL_BOARD_GRADE)) {
  const msg = [
    "MISSING_FULL_BOARD_GRADE_SOURCE",
    `Expected: ${FULL_BOARD_GRADE}`,
    "Run postgame/full-board grading first.",
    "Refusing to write misleading matched=0 grading output."
  ].join("\n");
  fs.mkdirSync("outputs/history", { recursive: true });
  fs.writeFileSync(TXT, msg + "\n");
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    date: DATE,
    error: "MISSING_FULL_BOARD_GRADE_SOURCE",
    expectedSource: FULL_BOARD_GRADE,
    candidates: candidates.length,
    matched: 0,
    unmatched: candidates.length,
    graded: []
  }, null, 2));
  console.error(msg);
  if (process.env.ALLOW_MISSING_GRADE_SOURCE === "1") process.exit(0);
  process.exit(2);
}

const gradedRows = flatten(readJson(FULL_BOARD_GRADE, []));

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
const byStatus = {};
const byMarket = {};
const byPlayer = {};

for (const c of candidates) {
  let match = exact.get(key(c));
  let matchType = "exact";
  let useInverse = false;

  if (!match) {
    const options = loose.get(looseKey(c)) || [];
    if (options.length === 1) {
      match = options[0];
      matchType = "loose_unique";
    } else if (options.length > 1) {
      matchType = "loose_ambiguous";
    } else {
      matchType = "unmatched";
    }
  }

  if (!match) {
    const inv = exact.get(inverseKey(c));
    if (inv) {
      match = inv;
      matchType = "inverse_exact";
      useInverse = true;
    }
  }

  if (!match) {
    const invOptions = loose.get(inverseLooseKey(c)) || [];
    if (invOptions.length === 1) {
      match = invOptions[0];
      matchType = "inverse_loose_unique";
      useInverse = true;
    } else if (invOptions.length > 1 && matchType === "unmatched") {
      matchType = "inverse_loose_ambiguous";
    }
  }

  const rawRes = match ? result(match) : "unmatched";
  const res = match && useInverse ? inverseResult(rawRes) : rawRes;
  const row = {
    ...c,
    result: res,
    matchType,
    actual: match?.actual ?? match?.value ?? match?.stat ?? null,
    sourceSide: match ? side(match) : null,
    sourceResult: match ? result(match) : null,
    inverseMatched: useInverse,
    gradedSource: match ? FULL_BOARD_GRADE : null
  };
  graded.push(row);

  const status = c.bridgeStatus || "UNKNOWN";
  const mk = c.market || "unknown";
  const pl = c.player || "unknown";

  byStatus[status] ||= emptyBucket();
  byMarket[mk] ||= emptyBucket();
  byPlayer[pl] ||= emptyBucket();

  inc(byStatus[status], res);
  inc(byMarket[mk], res);
  inc(byPlayer[pl], res);
}

for (const obj of [byStatus, byMarket, byPlayer]) {
  for (const k of Object.keys(obj)) finalize(obj[k]);
}

const summary = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  watchlistInput: WATCH,
  gradedSourceUsed: fs.existsSync(FULL_BOARD_GRADE) ? FULL_BOARD_GRADE : null,
  candidates: candidates.length,
  matched: graded.filter(x => x.result !== "unmatched").length,
  unmatched: graded.filter(x => x.result === "unmatched").length,
  results: finalize(graded.reduce((b, x) => {
    inc(b, x.result);
    return b;
  }, emptyBucket())),
  byStatus,
  byMarket,
  byPlayer,
  graded
};

const lines = [];
lines.push("STANDARD HITTER BRIDGE WATCHLIST GRADED");
lines.push("=======================================");
lines.push(JSON.stringify({
  generatedAt: summary.generatedAt,
  date: summary.date,
  candidates: summary.candidates,
  matched: summary.matched,
  unmatched: summary.unmatched,
  results: summary.results,
  byStatus: summary.byStatus,
  byMarket: summary.byMarket
}, null, 2));

lines.push("");
lines.push("GRADED CANDIDATES");
lines.push("-----------------");
graded.forEach((x, i) => {
  lines.push(`${i + 1}. ${x.player} | ${x.team} | ${x.market} ${x.side} ${x.line} | ${x.bridgeStatus} | prob=${((Number(x.probability || 0)) * 100).toFixed(1)}% | result=${x.result} | actual=${x.actual ?? "?"} | match=${x.matchType}`);
});

fs.mkdirSync("outputs/history", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
fs.writeFileSync(TXT, lines.join("\n"));

console.log({
  generatedAt: summary.generatedAt,
  date: summary.date,
  candidates: summary.candidates,
  matched: summary.matched,
  unmatched: summary.unmatched,
  results: summary.results,
  byStatus: summary.byStatus,
  byMarket: summary.byMarket
});
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
