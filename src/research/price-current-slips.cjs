const fs = require("fs");

const slipsRaw = JSON.parse(fs.readFileSync("outputs/slips.json", "utf8"));

const vegasFile = fs.existsSync("data/vegas-consensus.json")
  ? "data/vegas-consensus.json"
  : "data/vegas-raw.json";

const vegasData = JSON.parse(fs.readFileSync(vegasFile, "utf8"));
const vegasRaw = Array.isArray(vegasData)
  ? vegasData
  : (vegasData.rows || vegasData.slips || []);

const slips = slipsRaw.slips || slipsRaw;
const legs = Array.isArray(slips) ? slips.flatMap(s => s.legs || []) : [];

const EDGE_MIN = -0.015;
const SINGLE_BOOK_EDGE_CAP = 0.12;
const SINGLE_BOOK_EDGE_PENALTY = 0.035;
const MIN_GREEN_BOOKS = 2;
const SINGLE_BOOK_GREEN_EDGE_MIN = 0.12;
const SINGLE_BOOK_NEUTRAL_EDGE_MIN = 0.06;

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normMarket(s) {
  s = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (s.includes("strikeout")) return "strikeouts";
  if (s.includes("hits + runs + rbis") || s.includes("hits+runs+rbis") || s.includes("hrr")) return "hrr";
  if (s.includes("home runs") || s.includes("home run")) return "home_runs";
  if (s.includes("total bases")) return "bases";
  if (s.includes("rbi")) return "rbis";
  if (s.includes("runs")) return "runs";
  if (s.includes("hits")) return "hits";
  return s;
}

function normSide(s) {
  s = String(s || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function impliedProbFromAmerican(odds) {
  const o = Number(odds);
  if (!Number.isFinite(o)) return null;
  if (o > 0) return 100 / (o + 100);
  return Math.abs(o) / (Math.abs(o) + 100);
}

function key(player, market, side, line) {
  return [normName(player), normMarket(market), normSide(side), String(Number(line))].join("|");
}

function lineDeltaEdge(side, ppLine, bookLine) {
  const delta = Number(bookLine) - Number(ppLine);
  if (!Number.isFinite(delta)) return 0;
  if (side === "MORE") return delta;
  if (side === "LESS") return -delta;
  return 0;
}

function qualityScore(edge, books, savantGrade) {
  let score = Number(edge ?? -999);

  if (books >= 3) score += 0.006;
  else if (books === 2) score += 0.003;

  if (books <= 1) {
    score = Math.min(score, SINGLE_BOOK_EDGE_CAP);
    score -= SINGLE_BOOK_EDGE_PENALTY;
  }

  if (savantGrade === "UPGRADE" || savantGrade === "BOOST") score += 0.006;
  if (savantGrade === "DOWNGRADE") score -= 0.012;

  return Number(score.toFixed(4));
}

function getQualityGrade({ edge, adjustedEdge, books }) {
  if (edge == null || adjustedEdge == null) return "UNKNOWN";

  if (books < MIN_GREEN_BOOKS) {
    if (adjustedEdge >= SINGLE_BOOK_GREEN_EDGE_MIN) return "GREEN";
    if (adjustedEdge >= SINGLE_BOOK_NEUTRAL_EDGE_MIN) return "NEUTRAL";
    return "FADE";
  }

  if (adjustedEdge >= 0.015) return "GREEN";
  if (adjustedEdge >= EDGE_MIN) return "NEUTRAL";
  return "FADE";
}

function bestPriceForLeg(priceMap, player, market, side, ppLine) {
  const exact = priceMap.get(key(player, market, side, ppLine));
  let best = exact ? { ...exact, lineDelta: 0, lineDeltaBonus: 0, exactLine: true } : null;

  for (const [, p] of priceMap) {
    if (normName(p.player) !== normName(player)) continue;
    if (normMarket(p.market) !== normMarket(market)) continue;
    if (normSide(p.side) !== normSide(side)) continue;

    const d = lineDeltaEdge(side, ppLine, p.line);
    if (d <= 0) continue;

    const bonus = Math.min(0.12, d * 0.06);
    const candidate = { ...p, lineDelta: d, lineDeltaBonus: bonus, exactLine: false };

    if (!best || candidate.lineDeltaBonus > best.lineDeltaBonus) {
      best = candidate;
    }
  }

  return best;
}

const priceMap = new Map();

for (const r of vegasRaw) {
  const player = r.player || r.participant;
  const market = normMarket(r.market);
  const side = normSide(r.side);
  const line = Number(r.line);

  let prob = Number(r.noVigProb ?? r.weightedImpliedProb ?? r.avgImpliedProb ?? r.impliedProb);
  if (!Number.isFinite(prob) && r.odds != null) prob = impliedProbFromAmerican(r.odds);

  if (!player || !market || !side || !Number.isFinite(line) || !Number.isFinite(prob)) continue;

  const books = Number(r.books ?? r.bookCount ?? (Array.isArray(r.sportsbooks) ? r.sportsbooks.length : 1));
  if (books < 2) continue;
  const k = key(player, market, side, line);

  priceMap.set(k, {
    player,
    market,
    side,
    line,
    avgImpliedProb: prob,
    bookCount: books,
    game: r.game || r.event || null,
    sportsbooks: r.sportsbooks || (r.sportsbook ? [r.sportsbook] : []),
    disagreement: r.disagreement ?? null,
    sharpSoftGap: r.sharpSoftGap ?? null
  });
}

const savantRaw = readJson("outputs/slips-savant.json", []);
const savantRows = Array.isArray(savantRaw)
  ? savantRaw
  : (savantRaw.savantMatchedReport || savantRaw.rows || savantRaw.legs || []);

const savantMap = new Map();
for (const s of savantRows) {
  savantMap.set(normName(s.player), s);
}

const out = legs.map(l => {
  const player = l.player;
  const market = normMarket(l.market || l.stat);
  const side = normSide(l.side || l.recommendedSide);
  const line = Number(l.line);
  const p = bestPriceForLeg(priceMap, player, market, side, line);

  const sav = savantMap.get(normName(player));
  const modelProb = Number(l.recommendedProb);
  const marketProb = p ? Number(p.avgImpliedProb) : null;

  const baseEdge = Number.isFinite(modelProb) && Number.isFinite(marketProb)
    ? Number((modelProb - marketProb).toFixed(4))
    : null;

  const edge = baseEdge == null
    ? null
    : Number((baseEdge + Number(p?.lineDeltaBonus || 0)).toFixed(4));

  const books = p ? Number(p.bookCount || 0) : 0;
  const savantGrade = sav?.savantGradeReport || sav?.grade || "UNKNOWN";
  const adjustedEdge = edge == null ? null : qualityScore(edge, books, savantGrade);

  const qualityGrade = getQualityGrade({ edge, adjustedEdge, books });

  return {
    ...l,
    market,
    side,
    line,
    sportsbookMatch: !!p,
    sportsbookEdge: edge,
    sportsbookAdjustedEdge: adjustedEdge,
    sportsbookImpliedProb: marketProb,
    sportsbookBookCount: books,
    sportsbookGame: p?.game || null,
    sportsbooks: p?.sportsbooks || [],
    sportsbookDisagreement: p?.disagreement ?? null,
    sportsbookSharpSoftGap: p?.sharpSoftGap ?? null,
    savantReportGrade: savantGrade,
    qualityGrade,
    marketSupportFlag: books < MIN_GREEN_BOOKS ? "LOW_BOOK_SUPPORT" : "OK"
  };
});

const kept = out.filter(x => x.sportsbookMatch && x.sportsbookEdge > 0 && x.qualityGrade !== "FADE");

fs.writeFileSync("outputs/slips-priced.json", JSON.stringify(out, null, 2));

console.log("vegas odds file:", vegasFile);
console.log("vegas player prop rows:", vegasRaw.length);
console.log("price keys:", priceMap.size);
console.log("slip legs:", legs.length);
console.log("matched:", out.filter(x => x.sportsbookMatch).length);
console.log("unmatched:", out.filter(x => !x.sportsbookMatch).length);
console.log("dk playable:", out.filter(x => x.sportsbookMatch && x.sportsbookEdge > 0).length);
console.log("one per player:", kept.length);
console.log("kept:", kept.length);
console.log("faded:", out.filter(x => x.qualityGrade === "FADE").length);
console.log("low book support:", out.filter(x => x.marketSupportFlag === "LOW_BOOK_SUPPORT").length);

console.table(kept.slice(0, 25).map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  edge: x.sportsbookEdge,
  adjEdge: x.sportsbookAdjustedEdge,
  books: x.sportsbookBookCount,
  support: x.marketSupportFlag,
  savant: x.savantReportGrade,
  grade: x.qualityGrade
})));

console.log("Wrote outputs/slips-priced.json");
