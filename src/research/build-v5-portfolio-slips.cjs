const fs = require("fs");

function readJson(path, fallback) {
  try { return JSON.parse(fs.readFileSync(path, "utf8")); }
  catch { return fallback; }
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function keyOf(l) {
  return [
    l.player,
    l.team,
    l.market,
    l.side,
    l.line
  ].join("|");
}

function classifyRole(l) {
  const market = norm(l.market);
  const side = String(l.side || "").toUpperCase();

  if (
    market === "hitter_fantasy_score" && side === "MORE" ||
    market === "pitcher_fantasy_score" ||
    market === "triples" ||
    market === "doubles" ||
    market === "singles"
  ) return "DEAD";

  if (
    (market === "hits_allowed" && side === "LESS") ||
    (market === "pitching_outs" && side === "LESS") ||
    (market === "strikeouts" && side === "LESS") ||
    (market === "walks" && side === "LESS") ||
    (market === "walks_allowed" && side === "LESS")
  ) return "CORE";

  if (
    (market === "earned_runs_allowed" && side === "LESS") ||
    (market === "hits" && side === "LESS")
  ) return "CORE_PLUS";

  if (
    (market === "hrr" && side === "LESS") ||
    (market === "bases" && side === "MORE") ||
    (market === "pitching_outs" && side === "MORE")
  ) return "SUPPORT";

  if (
    (market === "hitter_fantasy_score" && side === "LESS") ||
    (market === "runs" && side === "MORE") ||
    (market === "rbis" && side === "MORE") ||
    (market === "hrr" && side === "MORE") ||
    (market === "earned_runs_allowed" && side === "MORE") ||
    (market === "hits_allowed" && side === "MORE") ||
    (market === "bases" && side === "LESS") ||
    (market === "walks" && side === "MORE") ||
    (market === "walks_allowed" && side === "MORE")
  ) return "TEST";

  return "SUPPORT";
}

function decorate(l) {
  const prob = num(l.calibratedDistributionProb ?? l.distributionProb ?? l.prob ?? l.recommendedProb);
  const ev = num(l.adjustedEdge ?? l.adjEdge ?? l.edge ?? l.expectedValue);
  const books = num(l.books);
  const grade = String(l.grade || "").toUpperCase();
  const support = String(l.support || l.marketSupportFlag || l.priceCoverageTier || "");
  const role = classifyRole(l);
  const isUnsupported = books <= 1 || /LOW_BOOK|UNSUPPORTED|SYNTHETIC/i.test(support);
  const contextScore = num(l.eliteContext?.contextScore ?? 0);

  let score =
    0.40 * prob +
    0.35 * Math.max(ev, 0) +
    0.15 * Math.min(books / 6, 1) +
    0.10 * contextScore;

  if (isUnsupported) score *= 0.85;
  if (role === "TEST") score *= 0.8;
  if (role === "SUPPORT") score *= 0.9;
  if (role === "DEAD") score = -999;

  const fantasy = fantasyByKey.get(norm(l.player));
  const fantasyUnlock =
    norm(l.market) === "hitter_fantasy_score" &&
    String(l.side || "").toUpperCase() === "LESS" &&
    fantasy
      ? {
          directProjection: fantasy.directProjection,
          componentProjection: fantasy.componentProjection,
          fantasyLine: fantasy.fantasyLine,
          unlocked: false
        }
      : null;

  return {
    ...l,
    v5: {
      role,
      isUnsupported,
      prob,
      ev,
      books,
      grade,
      support,
      score: Number(score.toFixed(6)),
      fantasyUnlock
    }
  };
}

function passesBase(l) {
  if (!l) return false;

  if (l.v5.role === "DEAD") return false;

  if (norm(l.market) === "hitter_fantasy_score" && String(l.side || "").toUpperCase() === "MORE") {
    return false;
  }

  if (norm(l.market) === "hitter_fantasy_score" && String(l.side || "").toUpperCase() === "LESS") {
    return fantasyLessUnlock(l);
  }

  if (l.v5.grade && !["GREEN", "NEUTRAL"].includes(l.v5.grade)) return false;
  if (l.v5.prob < 0.52) return false;
  if (l.v5.ev < 0.02) return false;

  if (l.v5.isUnsupported) {
    return l.v5.prob >= 0.70 && l.v5.ev >= 0.08 && l.v5.grade === "GREEN";
  }

  return true;
}

function samePlayer(a, b) {
  return norm(a.player) && norm(a.player) === norm(b.player);
}

function sameGame(a, b) {
  return norm(a.game || a.resolvedGame) && norm(a.game || a.resolvedGame) === norm(b.game || b.resolvedGame);
}

function badCorrelation(a, b) {
  if (samePlayer(a, b)) return true;

  const am = norm(a.market);
  const bm = norm(b.market);
  const as = String(a.side || "").toUpperCase();
  const bs = String(b.side || "").toUpperCase();

  if (sameGame(a, b)) {
    if (am === "hits_allowed" && as === "LESS" && bm === "bases" && bs === "MORE") return true;
    if (bm === "hits_allowed" && bs === "LESS" && am === "bases" && as === "MORE") return true;
  }

  return false;
}

function canAdd(slip, leg, type) {
  if (slip.legs.some(x => keyOf(x) === keyOf(leg))) return false;
  if (slip.legs.some(x => badCorrelation(x, leg))) return false;

  const unsupportedCount = slip.legs.filter(x => x.v5.isUnsupported).length;
  const testCount = slip.legs.filter(x => x.v5.role === "TEST").length;

  if (leg.v5.isUnsupported && unsupportedCount >= 1) return false;
  if (leg.v5.role === "TEST" && testCount >= 1) return false;

  if (type === "INDEPENDENT" && leg.v5.isUnsupported) return false;
  if (type === "INDEPENDENT" && leg.v5.role === "TEST") return false;

  if (type === "STACK" && slip.legs.length > 0 && !slip.legs.some(x => sameGame(x, leg))) {
    return false;
  }

  return true;
}

function buildSlip(type, size, candidates, usedGlobal) {
  const slip = {
    name: `v5_${type.toLowerCase()}_${size}_man`,
    type,
    size,
    complete: false,
    legs: []
  };

  const core = candidates.filter(l => ["CORE", "CORE_PLUS"].includes(l.v5.role));
  const support = candidates.filter(l => l.v5.role === "SUPPORT");
  const test = candidates.filter(l => l.v5.role === "TEST");

  const pools =
    type === "INDEPENDENT"
      ? [core, support]
      : type === "LIGHT_CORR"
        ? [core, support, test]
        : [support, core, test];

  for (const pool of pools) {
    for (const leg of pool) {
      if (slip.legs.length >= size) break;
      const globalKey = keyOf(leg);
      if ((usedGlobal.get(globalKey) || 0) >= 1) continue;
      if (!canAdd(slip, leg, type)) continue;
      slip.legs.push(leg);
      usedGlobal.set(globalKey, (usedGlobal.get(globalKey) || 0) + 1);
    }
  }

  const coreCount = slip.legs.filter(l => ["CORE", "CORE_PLUS"].includes(l.v5.role)).length;
  const unsupportedCount = slip.legs.filter(l => l.v5.isUnsupported).length;
  const avgProb = slip.legs.reduce((s, l) => s + l.v5.prob, 0) / Math.max(slip.legs.length, 1);
  const avgEv = slip.legs.reduce((s, l) => s + l.v5.ev, 0) / Math.max(slip.legs.length, 1);
  const score = slip.legs.reduce((s, l) => s + l.v5.score, 0);

  slip.complete = slip.legs.length === size && coreCount >= Math.min(2, size);
  slip.summary = {
    coreCount,
    unsupportedCount,
    avgProb: Number(avgProb.toFixed(4)),
    avgEv: Number(avgEv.toFixed(4)),
    score: Number(score.toFixed(6))
  };

  return slip;
}

const final = readJson("outputs/final-slips.json", {});
const priced = readJson("outputs/slips-priced.json", []);
const fantasyDecomp = readJson("outputs/fantasy-decomposition.json", []);
const topLegs = Array.isArray(final.topLegs) ? final.topLegs : [];

const fantasyByKey = new Map();
for (const r of fantasyDecomp) {
  if (!r || r.type !== "hitter") continue;
  fantasyByKey.set(norm(r.player), r);
}

function fantasyLessUnlock(l) {
  if (norm(l.market) !== "hitter_fantasy_score") return false;
  if (String(l.side || "").toUpperCase() !== "LESS") return false;

  const f = fantasyByKey.get(norm(l.player));
  if (!f) return false;

  const line = num(l.line ?? f.fantasyLine);
  const direct = num(f.directProjection);
  const component = num(f.componentProjection);

  return (
    line >= 7.5 &&
    direct > 0 &&
    component > 0 &&
    direct <= line - 0.75 &&
    component <= line - 0.75
  );
}

const source = [...topLegs, ...priced]
  .map(decorate)
  .map(l => {
    if (
      l.v5?.fantasyUnlock &&
      norm(l.market) === "hitter_fantasy_score" &&
      String(l.side || "").toUpperCase() === "LESS"
    ) {
      l.v5.fantasyUnlock.unlocked = fantasyLessUnlock(l);
    }
    return l;
  })
  .filter(passesBase)
  .sort((a, b) => b.v5.score - a.v5.score);

const dedup = [];
const seen = new Set();
for (const l of source) {
  const k = keyOf(l);
  if (seen.has(k)) continue;
  seen.add(k);
  dedup.push(l);
}

const usedGlobal = new Map();
const plan = [
  ["INDEPENDENT", 2],
  ["INDEPENDENT", 3],
  ["LIGHT_CORR", 3],
  ["LIGHT_CORR", 4],
  ["STACK", 3],
  ["STACK", 4]
];

const slips = plan.map(([type, size]) => buildSlip(type, size, dedup, usedGlobal));

const out = {
  generatedAt: new Date().toISOString(),
  version: "slipbuilder_v5_shadow_1",
  note: "Shadow portfolio builder. Does not replace official V4.5 slips yet.",
  candidateCount: dedup.length,
  roleCounts: dedup.reduce((m, l) => {
    m[l.v5.role] = (m[l.v5.role] || 0) + 1;
    return m;
  }, {}),
  unsupportedCount: dedup.filter(l => l.v5.isUnsupported).length,
  slips
};

writeJson("outputs/v5-portfolio-slips.json", out);

console.log("SLIPBUILDER V5 SHADOW PORTFOLIO");
console.log("================================");
console.log({
  candidates: out.candidateCount,
  unsupported: out.unsupportedCount,
  roleCounts: out.roleCounts,
  slips: slips.length,
  complete: slips.filter(s => s.complete).length
});

console.table(slips.map(s => ({
  name: s.name,
  type: s.type,
  size: s.size,
  complete: s.complete,
  legs: s.legs.length,
  core: s.summary.coreCount,
  unsupported: s.summary.unsupportedCount,
  avgProb: s.summary.avgProb,
  avgEv: s.summary.avgEv,
  score: s.summary.score
})));

for (const s of slips) {
  console.log(`\n${s.name} | complete=${s.complete}`);
  console.table(s.legs.map(l => ({
    player: l.player,
    market: l.market,
    side: l.side,
    line: l.line,
    role: l.v5.role,
    prob: l.v5.prob,
    ev: l.v5.ev,
    books: l.v5.books,
    unsupported: l.v5.isUnsupported,
    score: l.v5.score
  })));
}
