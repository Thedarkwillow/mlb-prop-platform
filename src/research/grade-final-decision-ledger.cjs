const fs = require("fs");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normPlayer(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’`-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function normMarket(m) {
  const x = norm(m);
  if (x.includes("strikeout") || x === "ks" || x === "k") return "strikeouts";
  if (x.includes("pitching_out") || x.includes("pitcher_out") || x === "outs") return "pitching_outs";
  if (x.includes("hit") && x.includes("allowed")) return "hits_allowed";
  if (x === "hits" || x.includes("batter_hits")) return "hits";
  if (x.includes("earned_run")) return "earned_runs_allowed";
  if (x === "runs" || x.includes("batter_runs")) return "runs";
  if (x === "rbis" || x.includes("batter_rbis")) return "rbis";
  if (x.includes("walk")) return "walks";
  if (x.includes("hrr") || x.includes("hits_runs_rbis")) return "hrr";
  if (x.includes("base")) return "bases";
  return x;
}

function nline(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(1) : "";
}

function key(x) {
  return [
    normPlayer(x.player || x.fullName || x.matchedName),
    normMarket(x.market || x.stat || x.statKey),
    norm(x.side || x.direction || x.recommendedSide),
    nline(x.line)
  ].join("|");
}


function candidateKeys(x) {
  const player = normPlayer(x.player || x.fullName || x.matchedName);
  const market = normMarket(x.market || x.stat || x.statKey);
  const side = norm(x.side || x.direction || x.recommendedSide);
  const line = nline(x.line);

  const keys = [[player, market, side, line].join("|")];

  // Pitcher aliases from PrizePicks final board to full-board graded file.
  if (market === "hits") keys.push([player, "hits_allowed", side, line].join("|"));
  if (market === "runs") keys.push([player, "earned_runs_allowed", side, line].join("|"));

  return keys;
}

function rowsFrom(obj) {
  if (Array.isArray(obj)) return obj;
  if (!obj || typeof obj !== "object") return [];
  return obj.rows || obj.legs || obj.results || obj.graded || obj.props || [];
}

function resultOf(r) {
  const raw = String(r.result || r.outcome || r.status || r.gradeResult || r.pickResult || "").toUpperCase();
  if (raw.includes("PUSH")) return "PUSH";
  if (raw.includes("MISS") || raw.includes("LOSS") || raw === "L") return "MISS";
  if (raw.includes("HIT") || raw.includes("WIN") || raw === "W") return "HIT";
  if (r.hit === true || r.won === true || r.isHit === true) return "HIT";
  if (r.hit === false || r.won === false || r.isHit === false) return "MISS";
  return null;
}

const finalSlips = readJson(`outputs/final-slips-${date}.json`, readJson("outputs/final-slips.json", {}));
const topLegs = rowsFrom(finalSlips.topLegs || []);
const blocked = readJson("outputs/blocked-final-candidates.json", []);

const ledger = [
  ...topLegs.map(x => ({ ...x, decisionStatus: "TOP_LEG", blocked: false })),
  ...blocked.map(x => ({ ...x, decisionStatus: "BLOCKED", blocked: true }))
];

const gradedSources = [
  "outputs/graded-results.json",
  `outputs/history/${date}-full-board-graded.json`,
  "outputs/all-markets-graded.json",
  "outputs/graded-props.json",
  "outputs/fantasy-graded.json",
  `outputs/playable-final-slips-graded-${date}.json`
];

const gradeMap = new Map();

for (const file of gradedSources) {
  const data = readJson(file, null);
  for (const r of rowsFrom(data)) {
    const res = resultOf(r);
    if (!res) continue;

    const k = key(r);
    if (!gradeMap.has(k)) {
      gradeMap.set(k, {
        result: res,
        source: file,
        actual: r.actual ?? r.actualValue ?? r.statValue ?? null,
        hits: r.hits ?? null,
        runs: r.runs ?? null,
        rbi: r.rbi ?? r.rbis ?? null,
        outs: r.outs ?? r.pitchingOuts ?? null,
        strikeouts: r.strikeouts ?? r.ks ?? null
      });
    }
  }
}

const graded = ledger.map(x => {
  let g = null;
  for (const k of candidateKeys(x)) {
    if (gradeMap.has(k)) {
      g = gradeMap.get(k);
      break;
    }
  }

  // Nearest-line fallback for same player/market/side only, max 1.0 line away.
  if (!g) {
    const player = normPlayer(x.player || x.fullName || x.matchedName);
    const market = normMarket(x.market || x.stat || x.statKey);
    const side = norm(x.side || x.direction || x.recommendedSide);
    const aliases = new Set([market]);
    if (market === "hits") aliases.add("hits_allowed");
    if (market === "runs") aliases.add("earned_runs_allowed");
    const wanted = Number(x.line);

    let best = null;
    for (const [k, v] of gradeMap.entries()) {
      const [kp, km, ks, kl] = k.split("|");
      if (kp !== player || ks !== side || !aliases.has(km)) continue;
      const delta = Math.abs(Number(kl) - wanted);
      if (!Number.isFinite(delta) || delta > 1.0) continue;
      if (!best || delta < best.delta) best = { delta, value: v };
    }
    if (best) g = best.value;
  }

  // Inverse-side inference:
  // Example: MORE 16.5 MISS implies LESS 17.5 HIT.
  if (!g) {
    const player = normPlayer(x.player || x.fullName || x.matchedName);
    const market = normMarket(x.market || x.stat || x.statKey);
    const side = norm(x.side || x.direction || x.recommendedSide);
    const opposite = side === "less" ? "more" : side === "more" ? "less" : "";
    const aliases = new Set([market]);
    if (market === "hits") aliases.add("hits_allowed");
    if (market === "runs") aliases.add("earned_runs_allowed");
    const wanted = Number(x.line);

    let best = null;
    for (const [k, v] of gradeMap.entries()) {
      const [kp, km, ks, kl] = k.split("|");
      if (kp !== player || ks !== opposite || !aliases.has(km)) continue;
      const delta = Math.abs(Number(kl) - wanted);
      if (!Number.isFinite(delta) || delta > 1.0) continue;
      if (String(v.result).toUpperCase() === "PUSH") continue;
      if (!best || delta < best.delta) best = { delta, value: v };
    }

    if (best) {
      const r = String(best.value.result).toUpperCase();
      g = {
        ...best.value,
        result: r === "HIT" ? "MISS" : r === "MISS" ? "HIT" : r,
        inferredInverseLine: true
      };
    }
  }
  return {
    date,
    player: x.player,
    team: x.team,
    game: x.game,
    market: normMarket(x.market || x.stat),
    side: x.side,
    line: x.line,
    prob: x.calibratedDistributionProb ?? x.prob,
    edge: x.adjustedEdge ?? x.edge,
    finalScore: x.finalScore ?? x.score ?? null,
    grade: x.grade ?? null,
    decisionStatus: x.decisionStatus,
    blocked: x.blocked,
    blockReason: x.reason ?? null,
    blockReasons: x.reasons ?? [],
    result: g?.result ?? "UNMATCHED",
    actual: g?.actual ?? null,
    gradeSource: g?.source ?? null,
    box: g ? {
      hits: g.hits,
      runs: g.runs,
      rbi: g.rbi,
      outs: g.outs,
      strikeouts: g.strikeouts
    } : null
  };
});

fs.mkdirSync("data/results", { recursive: true });

fs.writeFileSync(`outputs/final-decision-ledger-graded-${date}.json`, JSON.stringify(graded, null, 2));
fs.writeFileSync("outputs/final-decision-ledger-graded.json", JSON.stringify(graded, null, 2));

const histPath = "data/results/final-decision-ledger-history.json";
const hist = readJson(histPath, []);
const filtered = hist.filter(x => x.date !== date);
fs.writeFileSync(histPath, JSON.stringify([...filtered, ...graded], null, 2));

console.log("FINAL DECISION LEDGER");
console.log("date:", date);
console.log("rows:", graded.length);
console.log("matched:", graded.filter(x => x.result !== "UNMATCHED").length);
console.table(graded.map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  status: x.decisionStatus,
  result: x.result,
  actual: x.actual,
  reason: x.blockReason
})));
