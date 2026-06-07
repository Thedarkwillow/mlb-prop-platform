const fs = require("fs");
const path = require("path");

function getDate() {
  const arg = process.argv.find(x => /^--date=/.test(x));
  if (arg) return arg.replace(/^--date=/, "");
  const bare = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (bare) return bare;
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();
const HIST = "outputs/history";
const FULL = `${HIST}/${DATE}-full-board-graded.json`;
const CANON_HRR = `${HIST}/${DATE}-hrr-graded.json`;
const CANON_HRR_TXT = `${HIST}/${DATE}-hrr-graded.txt`;
const OUT = `${HIST}/${DATE}-goblin-hrr-controlled-repaired.json`;
const TXT = `${HIST}/${DATE}-goblin-hrr-controlled-repaired.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function norm(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function player(r) { return s(r.player || r.playerName || r.name || r.athleteName); }
function team(r) { return s(r.team || r.resolvedTeam || r.rawTeam || r.abbrev); }
function market(r) { return s(r.market || r.statType || r.projectionType || r.type).toLowerCase(); }
function side(r) { return s(r.side || r.pick || r.direction || r.recommendation).toUpperCase(); }
function line(r) { return n(r.line ?? r.target ?? r.value ?? r.statValue); }
function actual(r) { return n(r.actual ?? r.value ?? r.stat ?? r.final ?? r.finalStat); }

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
  if (player(v) || market(v) || result(v) || Array.isArray(v.legs)) out.push(v);
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

function opposite(x) {
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

function gradeByActualValue(leg, value) {
  const a = n(value);
  const ln = line(leg);
  const sd = side(leg);
  if (a === null || ln === null || !sd) return "unmatched";
  if (a === ln) return "push";
  if (sd === "MORE") return a > ln ? "hit" : "miss";
  if (sd === "LESS") return a < ln ? "hit" : "miss";
  return "unmatched";
}

function gradeLeg(leg, exact, loose) {
  let match = exact.get(key(leg));
  let matchType = match ? "exact" : "unmatched";
  let inverse = false;

  if (!match) {
    const opts = loose.get(looseKey(leg)) || [];
    if (opts.length === 1) {
      match = opts[0];
      matchType = "loose_unique";
    } else if (opts.length > 1) {
      matchType = "loose_ambiguous";
    }
  }

  if (!match) {
    const opp = opposite(side(leg));
    match = exact.get(key(leg, opp));
    if (match) {
      matchType = "inverse_exact";
      inverse = true;
    }
  }

  if (!match) {
    const opp = opposite(side(leg));
    const opts = loose.get(looseKey(leg, opp)) || [];
    if (opts.length === 1) {
      match = opts[0];
      matchType = "inverse_loose_unique";
      inverse = true;
    } else if (opts.length > 1 && matchType === "unmatched") {
      matchType = "inverse_loose_ambiguous";
    }
  }

  let srcResult = match ? result(match) : "unmatched";
  let finalResult = match ? (inverse ? inverseResult(srcResult) : srcResult) : "unmatched";
  let actualValue = match ? actual(match) : null;
  let actualFallbackSource = null;

  if (!match) {
    const pm = [norm(player(leg)), norm(market(leg))].join("|");
    const options = actualByPlayerMarket.get(pm) || [];
    const usable = options.filter(x => actual(x) !== null);

    if (usable.length === 1) {
      const src = usable[0];
      actualValue = actual(src);
      finalResult = gradeByActualValue(leg, actualValue);
      srcResult = result(src);
      matchType = "actual_same_player_market_any_line";
      actualFallbackSource = {
        player: player(src),
        market: market(src),
        sourceSide: side(src),
        sourceLine: line(src),
        sourceResult: result(src)
      };
    } else if (usable.length > 1) {
      const actuals = [...new Set(usable.map(x => actual(x)).filter(x => x !== null))];
      if (actuals.length === 1) {
        const src = usable[0];
        actualValue = actuals[0];
        finalResult = gradeByActualValue(leg, actualValue);
        srcResult = result(src);
        matchType = "actual_same_player_market_multi_line";
        actualFallbackSource = {
          player: player(src),
          market: market(src),
          sourceLines: usable.map(x => ({ side: side(x), line: line(x), result: result(x) })).slice(0, 10)
        };
      } else {
        matchType = "actual_same_player_market_ambiguous";
      }
    }
  }

  if (!match && finalResult === "unmatched" && /earned_runs_allowed|hits_allowed|walks_allowed|pitching_outs|strikeouts/.test(norm(market(leg)))) {
    const playerOptions = actualByPlayerAnyMarket.get(norm(player(leg))) || [];
    matchType = playerOptions.length
      ? "missing_same_pitcher_market_actual_source"
      : "missing_pitcher_actual_source";
  }

  return {
    ...leg,
    result: finalResult,
    actual: actualValue,
    matchType,
    inverseMatched: inverse,
    sourceSide: match ? side(match) : null,
    sourceResult: srcResult,
    actualFallbackSource,
    gradedSource: match || actualFallbackSource ? FULL : null
  };
}

function bucket(rows) {
  const b = { total: rows.length, hit: 0, miss: 0, push: 0, refund: 0, unmatched: 0, graded: 0, hitRate: null };
  for (const r of rows) {
    const res = result(r);
    if (["hit", "miss", "push", "refund"].includes(res)) {
      b[res]++;
      b.graded++;
    } else {
      b.unmatched++;
    }
  }
  b.hitRate = b.graded ? Number((b.hit / b.graded).toFixed(4)) : null;
  return b;
}

if (!fs.existsSync(FULL)) {
  console.error(`Missing full-board source: ${FULL}`);
  process.exit(2);
}

const fullRows = flatten(readJson(FULL, []))
  .filter(r => player(r) && market(r) && line(r) !== null && result(r));

const exact = new Map();
const loose = new Map();
const actualByPlayerMarket = new Map();
const actualByPlayerAnyMarket = new Map();

for (const r of fullRows) {
  exact.set(key(r), r);
  const lk = looseKey(r);
  if (!loose.has(lk)) loose.set(lk, []);
  loose.get(lk).push(r);

  const pm = [norm(player(r)), norm(market(r))].join("|");
  if (!actualByPlayerMarket.has(pm)) actualByPlayerMarket.set(pm, []);
  actualByPlayerMarket.get(pm).push(r);

  const pOnly = norm(player(r));
  if (!actualByPlayerAnyMarket.has(pOnly)) actualByPlayerAnyMarket.set(pOnly, []);
  actualByPlayerAnyMarket.get(pOnly).push(r);
}

// 1) Canonical HRR grade file from full-board rows.
const hrrRows = fullRows
  .filter(r => norm(market(r)) === "hrr" || /hrr|hitsrunsrbis/.test(norm(market(r))))
  .map(r => ({ ...r, date: DATE, canonicalHrrSource: FULL }));

writeJson(CANON_HRR, {
  generatedAt: new Date().toISOString(),
  date: DATE,
  source: FULL,
  mode: "canonical_hrr_from_full_board",
  summary: bucket(hrrRows),
  rows: hrrRows
});

const hrrLines = [];
hrrLines.push("CANONICAL HRR GRADED");
hrrLines.push("====================");
hrrLines.push(JSON.stringify({
  generatedAt: new Date().toISOString(),
  date: DATE,
  source: FULL,
  summary: bucket(hrrRows)
}, null, 2));
fs.writeFileSync(CANON_HRR_TXT, hrrLines.join("\n") + "\n");

// 2) Repair goblin HRR controlled slips/legs by searching available input/grade files.
const candidateFiles = [
  `${HIST}/${DATE}-goblin-hrr-controlled-slips-graded.json`
].filter(fs.existsSync);

// Do not pull generic current files or neighboring dates into a date-specific repair.
// Generic outputs/goblin-hrr-controlled-slips.json may belong to today's slate, not DATE.


const sourceObjects = [];
for (const file of candidateFiles) {
  const data = readJson(file, null);
  if (!data) continue;
  const rows = flatten(data).filter(x => Array.isArray(x.legs) || player(x));
  sourceObjects.push({ file, rows });
}

const slips = [];
const standaloneLegs = [];

for (const src of sourceObjects) {
  for (const r of src.rows) {
    if (Array.isArray(r.legs) && r.legs.length) {
      slips.push({ sourceFile: src.file, ...r });
    } else if (player(r) && market(r)) {
      standaloneLegs.push({ sourceFile: src.file, ...r });
    }
  }
}

const repairedSlips = slips.map(slip => {
  const legs = slip.legs.map(l => gradeLeg(l, exact, loose));
  const summary = bucket(legs);
  const complete = legs.every(l => ["hit", "miss", "push", "refund"].includes(result(l)));
  const slipResult = complete
    ? (legs.every(l => result(l) === "hit") ? "hit" : "miss")
    : "partial_unmatched";
  return {
    ...slip,
    legs,
    repairedSummary: summary,
    complete,
    slipResult
  };
});

const repairedStandaloneLegs = standaloneLegs.map(l => gradeLeg(l, exact, loose));

const allLegs = [
  ...repairedSlips.flatMap(s => s.legs),
  ...repairedStandaloneLegs
];

const byMarket = {};
for (const l of allLegs) {
  const mk = market(l) || "unknown";
  byMarket[mk] ||= [];
  byMarket[mk].push(l);
}

const out = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  fullBoardSource: FULL,
  candidateFiles,
  canonicalHrrFile: CANON_HRR,
  sourceObjects: sourceObjects.map(x => ({ file: x.file, rows: x.rows.length })),
  slips: repairedSlips,
  standaloneLegs: repairedStandaloneLegs,
  summary: {
    slips: bucket(repairedSlips.map(s => ({ result: s.slipResult }))),
    legs: bucket(allLegs),
    byMarket: Object.fromEntries(Object.entries(byMarket).map(([k, v]) => [k, bucket(v)]))
  }
};

writeJson(OUT, out);

const lines = [];
lines.push("GOBLIN HRR CONTROLLED REPAIRED");
lines.push("==============================");
lines.push(JSON.stringify({
  generatedAt: out.generatedAt,
  date: DATE,
  fullBoardSource: FULL,
  canonicalHrrFile: CANON_HRR,
  candidateFiles,
  sourceObjects: out.sourceObjects,
  summary: out.summary
}, null, 2));
lines.push("");
lines.push("TOP REPAIRED SLIPS");
lines.push("------------------");
repairedSlips.slice(0, 30).forEach((s, i) => {
  lines.push(`${i + 1}. ${s.id || s.name || s.sourceFile} | result=${s.slipResult} | complete=${s.complete} | legs=${s.legs.length} | hit=${s.repairedSummary.hit} miss=${s.repairedSummary.miss} unmatched=${s.repairedSummary.unmatched}`);
  for (const l of s.legs) {
    lines.push(`   - ${player(l)} | ${market(l)} ${side(l)} ${line(l)} | result=${result(l)} | actual=${actual(l) ?? "?"} | match=${l.matchType} | inverse=${l.inverseMatched}`);
  }
});
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log({
  generatedAt: out.generatedAt,
  date: DATE,
  canonicalHrrFile: CANON_HRR,
  hrrSummary: bucket(hrrRows),
  candidateFiles,
  repairedSlipCount: repairedSlips.length,
  repairedLegSummary: out.summary.legs,
  out: OUT,
  txt: TXT
});
