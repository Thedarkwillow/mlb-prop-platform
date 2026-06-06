const fs = require("fs");
const path = require("path");
const { prizePicksSlipValidation } = require("./lib/prizepicks-slip-rules.cjs");

function argDate() {
  const raw = process.argv.slice(2).find(x => /^\d{4}-\d{2}-\d{2}$/.test(x))
    || process.env.npm_config_date
    || new Date().toISOString().slice(0, 10);
  return String(raw).replace(/^--date=/, "");
}

const DATE = argDate();
const INPUT = "outputs/goblin-hrr-controlled-slips.json";
const GRADED = `outputs/history/${DATE}-full-board-graded.json`;
const OUT = `outputs/history/${DATE}-goblin-hrr-controlled-slips-graded.json`;
const TXT = `outputs/history/${DATE}-goblin-hrr-controlled-slips-graded.txt`;
const UNMATCHED_TXT = `outputs/history/${DATE}-goblin-hrr-controlled-unmatched-debug.txt`;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function normName(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function market(v) {
  const t = String(v || "").toLowerCase();

  if (t.includes("hrr") || t.includes("hits+runs+rbis") || t.includes("hits plus runs plus rbis") || t.includes("hits_runs_rbis")) return "hrr";
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

function marketAliases(m) {
  const x = market(m);
  const set = new Set([x]);

  if (x === "hrr") {
    ["hrr", "hits_runs_rbis", "hits+runs+rbis", "hits_plus_runs_plus_rbis", "hitsrunsrbis"].forEach(v => set.add(v));
  }

  if (x === "earned_runs_allowed") {
    ["earned_runs_allowed", "runs_allowed", "runs", "earned_runs", "pitcher_runs"].forEach(v => set.add(v));
  }

  if (x === "hits_allowed") {
    ["hits_allowed", "pitcher_hits_allowed"].forEach(v => set.add(v));
  }

  if (x === "strikeouts") {
    ["strikeouts", "pitcher_strikeouts", "ks", "k"].forEach(v => set.add(v));
  }

  if (x === "bases") {
    ["bases", "total_bases", "tb"].forEach(v => set.add(v));
  }

  return [...set].map(v => String(v).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
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

function lineKey(v) {
  const n = line(v);
  return Number.isFinite(n) ? String(n) : "";
}

function player(x) {
  return x?.player || x?.playerName || x?.name || x?.raw?.player || x?.raw?.playerName || "";
}

function team(x) {
  return x?.resolvedTeam || x?.team || x?.rawTeam || x?.playerTeam || x?.raw?.resolvedTeam || x?.raw?.team || "";
}

function statText(x) {
  return x?.market || x?.stat || x?.projectionType || x?.type || x?.raw?.market || x?.raw?.stat || "";
}

function exactKeys(x) {
  const name = normName(player(x));
  const sd = side(x.side || x.recommendedSide || x.playableSide || x.raw?.side);
  const ln = lineKey(x.line ?? x.ppLine ?? x.prizepicksLine ?? x.raw?.line);
  const aliases = marketAliases(statText(x));

  return aliases.map(m => [name, m, sd, ln].join("|"));
}

function looseKeys(x) {
  const name = normName(player(x));
  const sd = side(x.side || x.recommendedSide || x.playableSide || x.raw?.side);
  const aliases = marketAliases(statText(x));

  return aliases.flatMap(m => [
    [name, m, sd].join("|"),
    [name, m].join("|")
  ]);
}

function firstNum(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function actualFromRow(g, wantedMarket) {
  const m = market(wantedMarket);

  const direct = firstNum(
    g.actual,
    g.actualValue,
    g.boxscoreValue,
    g.value,
    g.finalValue,
    g.statValue,
    g.resultValue,
    g.raw?.actual,
    g.raw?.actualValue,
    g.raw?.boxscoreValue
  );
  if (direct !== null) return direct;

  if (m === "hrr") {
    const h = firstNum(g.hits, g.H, g.batterHits, g.raw?.hits, g.raw?.H);
    const r = firstNum(g.runs, g.R, g.raw?.runs, g.raw?.R);
    const rbi = firstNum(g.rbi, g.rbis, g.RBI, g.raw?.rbi, g.raw?.rbis, g.raw?.RBI);
    if ([h, r, rbi].every(Number.isFinite)) return h + r + rbi;
  }

  if (m === "bases") {
    const tb = firstNum(g.totalBases, g.bases, g.TB, g.raw?.totalBases, g.raw?.TB);
    if (tb !== null) return tb;
  }

  if (m === "earned_runs_allowed") {
    return firstNum(
      g.earnedRunsAllowed,
      g.earned_runs_allowed,
      g.earnedRuns,
      g.runsAllowed,
      g.ER,
      g.raw?.earnedRunsAllowed,
      g.raw?.earnedRuns,
      g.raw?.ER
    );
  }

  if (m === "hits_allowed") {
    return firstNum(
      g.hitsAllowed,
      g.hits_allowed,
      g.HA,
      g.raw?.hitsAllowed,
      g.raw?.HA
    );
  }

  if (m === "strikeouts") {
    return firstNum(
      g.strikeouts,
      g.pitcherStrikeouts,
      g.K,
      g.SO,
      g.raw?.strikeouts,
      g.raw?.K,
      g.raw?.SO
    );
  }

  return null;
}

function gradeByActual(actual, ln, sd) {
  if (!Number.isFinite(actual) || !Number.isFinite(ln)) return "UNMATCHED";
  if (actual === ln) return "PUSH";
  if (sd === "MORE") return actual > ln ? "HIT" : "MISS";
  if (sd === "LESS") return actual < ln ? "HIT" : "MISS";
  return "UNMATCHED";
}

function resultOf(g, leg) {
  if (!g) return "UNMATCHED";

  const raw = String(g.result || g.grade || g.outcome || g.status || "").toUpperCase();
  if (raw.includes("HIT") || raw === "WIN") return "HIT";
  if (raw.includes("MISS") || raw === "LOSS") return "MISS";
  if (raw.includes("PUSH")) return "PUSH";
  if (raw.includes("REFUND") || raw.includes("DNP")) return "REFUND";

  const actual = actualFromRow(g, leg.market || leg.stat);
  return gradeByActual(actual, line(leg.line), side(leg.side));
}

function addIndex(map, k, row) {
  if (!k || k.includes("||")) return;
  if (!map.has(k)) map.set(k, []);
  map.get(k).push(row);
}

function unique(map, k) {
  const rows = map.get(k) || [];
  return rows.length === 1 ? rows[0] : null;
}

function findMatch(leg, indexes) {
  for (const k of exactKeys(leg)) {
    const hit = unique(indexes.exact, k);
    if (hit) return { row: hit, matchType: "exact", key: k };
  }

  for (const k of looseKeys(leg)) {
    const hit = unique(indexes.loose, k);
    if (hit) return { row: hit, matchType: "loose_unique", key: k };
  }

  const name = normName(player(leg));
  const candidates = indexes.byPlayer.get(name) || [];
  const aliases = new Set(marketAliases(leg.market || leg.stat));
  const sd = side(leg.side);
  const ln = line(leg.line);

  const filtered = candidates.filter(g => {
    const gm = marketAliases(statText(g));
    const marketOk = gm.some(x => aliases.has(x));
    const sideOk = !side(g.side || g.recommendedSide || g.playableSide) || side(g.side || g.recommendedSide || g.playableSide) === sd;
    const gln = line(g.line);
    const lineOk = !Number.isFinite(gln) || !Number.isFinite(ln) || gln === ln;
    return marketOk && sideOk && lineOk;
  });

  if (filtered.length === 1) {
    return { row: filtered[0], matchType: "player_market_filtered_unique", key: name };
  }

  return { row: null, matchType: filtered.length ? `ambiguous_${filtered.length}` : "unmatched", key: name };
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

const indexes = {
  exact: new Map(),
  loose: new Map(),
  byPlayer: new Map()
};

for (const g of gradedRows) {
  if (!g || typeof g !== "object") continue;

  for (const k of exactKeys(g)) addIndex(indexes.exact, k, g);
  for (const k of looseKeys(g)) addIndex(indexes.loose, k, g);

  const pn = normName(player(g));
  if (pn) {
    if (!indexes.byPlayer.has(pn)) indexes.byPlayer.set(pn, []);
    indexes.byPlayer.get(pn).push(g);
  }
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
  byMarket: {},
  matchTypes: {}
};

function inc(obj, k) {
  obj[k] = (obj[k] || 0) + 1;
}

const unmatchedDebug = [];
const gradedSlips = [];

for (const slip of input.slips) {
  const legs = Array.isArray(slip.legs) ? slip.legs : [];
  const validation = prizePicksSlipValidation(legs);

  const gradedLegs = legs.map(l => {
    const found = findMatch(l, indexes);
    const g = found.row;
    const result = resultOf(g, l);
    const role = l.role || (market(l.market || l.stat) === "hrr" ? "HRR_ANCHOR" : "FILLER");
    const m = market(l.market || l.stat);
    const actual = g ? actualFromRow(g, m) : null;

    inc(summary.matchTypes, found.matchType);

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

    if (result === "UNMATCHED") {
      unmatchedDebug.push({
        player: l.player,
        team: l.team,
        market: m,
        side: side(l.side),
        line: l.line,
        role,
        matchType: found.matchType,
        key: found.key
      });
    }

    return {
      ...l,
      result,
      actual,
      matched: !!g,
      matchType: found.matchType
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
    lines.push(`${i + 1}. ${l.role || "-"} | ${l.player} | ${l.team} | ${l.market} ${l.side} ${l.line} | ${l.result} | actual=${l.actual ?? "?"} | match=${l.matchType}`);
  }
}

fs.writeFileSync(TXT, lines.join("\n") + "\n");

const debugLines = [];
debugLines.push("CONTROLLED HRR GOBLIN UNMATCHED DEBUG");
debugLines.push("=====================================");
debugLines.push(`date=${DATE}`);
debugLines.push(`unmatched=${unmatchedDebug.length}`);
for (const x of unmatchedDebug.slice(0, 200)) {
  debugLines.push(`${x.player} | ${x.team} | ${x.market} ${x.side} ${x.line} | role=${x.role} | match=${x.matchType}`);
}
fs.writeFileSync(UNMATCHED_TXT, debugLines.join("\n") + "\n");

console.log(summary);
console.log("saved:", OUT);
console.log("saved:", TXT);
console.log("saved:", UNMATCHED_TXT);
