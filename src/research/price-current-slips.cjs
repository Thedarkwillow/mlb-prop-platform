const fs = require("fs");
const { modelStrikeouts } = require("../models/markets/strikeouts.cjs");

const slipsRaw = JSON.parse(fs.readFileSync("outputs/slips.json", "utf8"));
const vegasRaw = JSON.parse(fs.readFileSync("data/vegas-raw.json", "utf8"));

const slips = slipsRaw.slips || slipsRaw;
const legs = Array.isArray(slips) ? slips.flatMap(s => s.legs || []) : [];

const EDGE_MIN = -0.015;
const SINGLE_BOOK_EDGE_CAP = 0.12;
const SINGLE_BOOK_EDGE_PENALTY = 0.035;

// New anti-fake-green rules
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
  if (s.includes("home run")) return "home_runs";

  return s;
}

function normSide(s) {
  s = String(s || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function dkLine(row) {
  if (row.points != null) return Number(row.points);

  const sel = String(row.selection || "").trim();
  const m = sel.match(/^(\d+)\+$/);

  if (m) return Number(m[1]) - 0.5;

  return null;
}

function dkSide(row) {
  const sel = String(row.selection || "").toLowerCase();
  const out = String(row.outcome || "").toLowerCase();

  if (sel === "over" || out === "over") return "MORE";
  if (sel === "under" || out === "under") return "LESS";
  if (/^\d+\+$/.test(sel)) return "MORE";

  return null;
}

function impliedProb(decimalOdds) {
  const d = Number(decimalOdds);
  if (!Number.isFinite(d) || d <= 1) return null;
  return Number((1 / d).toFixed(4));
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

  // Hard downgrade weak market support.
  // 1-book props can only be GREEN with very large adjusted edge.
  if (books < MIN_GREEN_BOOKS) {
    if (adjustedEdge >= SINGLE_BOOK_GREEN_EDGE_MIN) return "GREEN";
    if (adjustedEdge >= SINGLE_BOOK_NEUTRAL_EDGE_MIN) return "NEUTRAL";
    return "FADE";
  }

  // Multi-book props use normal thresholds.
  if (adjustedEdge >= 0.015) return "GREEN";
  if (adjustedEdge >= EDGE_MIN) return "NEUTRAL";
  return "FADE";
}

const confirmed = new Set(
  readJson("outputs/confirmed-lineups.json", []).map(x => normName(x))
);

const priceBuckets = new Map();

for (const r of vegasRaw) {
  if (r.marketType !== "player_prop" && r.source !== "oddsapi") continue;
  const player = r.participant || r.player;
  const market = normMarket(r.market);
  const side = r.source === "oddsapi" ? normSide(r.side) : dkSide(r);
  const line = r.source === "oddsapi" ? Number(r.line) : dkLine(r);
  const prob = r.source === "oddsapi"
    ? impliedProb(Number(r.odds) > 0 ? 1 + Number(r.odds) / 100 : 1 + 100 / Math.abs(Number(r.odds)))
    : impliedProb(r.decimalOdds);
  if (!player || !market || !side || line == null || prob == null) continue;

  const k = key(player, market, side, line);

  if (!priceBuckets.has(k)) {
    priceBuckets.set(k, {
      player,
      market,
      side,
      line,
      probs: [],
      games: new Set()
    });
  }

  const b = priceBuckets.get(k);
  b.probs.push(prob);
  b.games.add(String(r.event || ""));
}

const priceMap = new Map();

for (const [k, b] of priceBuckets) {
  const avgImpliedProb = Number(
    (b.probs.reduce((a, x) => a + x, 0) / b.probs.length).toFixed(4)
  );

  priceMap.set(k, {
    player: b.player,
    market: b.market,
    side: b.side,
    line: b.line,
    avgImpliedProb,
    bookCount: b.probs.length,
    game: [...b.games][0] || null
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
  const edge = baseEdge == null ? null : Number((baseEdge + Number(p?.lineDeltaBonus || 0)).toFixed(4));

  const books = p ? Number(p.bookCount || 0) : 0;
  const savantGrade = sav?.savantGradeReport || sav?.grade || "UNKNOWN";
  const adjustedEdge = qualityScore(edge, books, savantGrade);

  const sportsbookGrade =
    edge == null ? "UNKNOWN" :
    edge >= 0.015 ? "GREEN" :
    edge >= EDGE_MIN ? "NEUTRAL" :
    "FADE";

  const qualityGrade = getQualityGrade({
    edge,
    adjustedEdge,
    books
  });

  const marketSupportFlag =
    books < MIN_GREEN_BOOKS
      ? "LOW_BOOK_SUPPORT"
      : "OK";

  return {
    ...l,
    market,
    side,
    sportsbookMatch: !!p,
    sportsbookAvgProb: p ? p.avgImpliedProb : null,
    sportsbookBookCount: books,
    sportsbookBaseEdge: baseEdge,
    sportsbookEdge: edge,
    sportsbookLineDelta: p ? p.lineDelta : null,
    sportsbookExactLine: p ? p.exactLine : false,
    sportsbookAdjustedEdge: adjustedEdge,
    sportsbookGame: p ? p.game : null,
    sportsbookGrade,
    savantReportGrade: savantGrade,
    marketSupportFlag,
    qualityGrade
  };
});

const dkPlayable = out.filter(x =>
  x.sportsbookMatch &&
  typeof x.sportsbookEdge === "number" &&
  x.sportsbookEdge > 0 &&
  x.qualityGrade !== "FADE"
);

const sortedPlayable = [...dkPlayable].sort((a, b) =>
  (Number(b.sportsbookAdjustedEdge ?? -999) + Number(b.recommendedProb ?? 0) * 0.01) -
  (Number(a.sportsbookAdjustedEdge ?? -999) + Number(a.recommendedProb ?? 0) * 0.01)
);

const onePerPlayer = [];
const seenPlayers = new Set();
const marketCounts = new Map();

for (const r of sortedPlayable) {
  const p = normName(r.player);
  const m = normMarket(r.market || r.stat);

  if (seenPlayers.has(p)) continue;

  const count = marketCounts.get(m) || 0;

  // Prevent HRR from swallowing the full priced board.
  if (m === "hrr" && count >= 8) continue;

  seenPlayers.add(p);
  marketCounts.set(m, count + 1);
  onePerPlayer.push(r);
}

// Backfill with remaining best props if board is too thin,
// but do not let HRR swallow the board again.
for (const r of sortedPlayable) {
  if (onePerPlayer.length >= 30) break;

  const p = normName(r.player);
  const m = normMarket(r.market || r.stat);
  if (seenPlayers.has(p)) continue;

  const count = marketCounts.get(m) || 0;
  if (m === "hrr" && count >= 8) continue;

  seenPlayers.add(p);
  marketCounts.set(m, count + 1);
  onePerPlayer.push(r);
}

const filtered = onePerPlayer
  .map(r => {
    const inLineup = confirmed.size === 0 || confirmed.has(normName(r.player));

    return {
      ...r,
      lineupBoost: inLineup ? 0.01 : 0,
      savantPenalty: r.qualityGrade === "FADE" ? -0.02 : 0
    };
  })
  .sort((a, b) =>
    ((b.sportsbookAdjustedEdge ?? -999) + b.lineupBoost + b.savantPenalty) -
    ((a.sportsbookAdjustedEdge ?? -999) + a.lineupBoost + a.savantPenalty)
  );

console.log("vegas player prop rows:", vegasRaw.filter(x => x.marketType === "player_prop" || x.source === "oddsapi").length);
console.log("price keys:", priceMap.size);
console.log("slip legs:", out.length);
console.log("matched:", out.filter(x => x.sportsbookMatch).length);
console.log("unmatched:", out.filter(x => !x.sportsbookMatch).length);
console.log("dk playable:", dkPlayable.length);
console.log("one per player:", onePerPlayer.length);
console.log("kept:", filtered.length);
console.log("faded:", out.length - filtered.length);
console.log("low book support:", out.filter(x => x.marketSupportFlag === "LOW_BOOK_SUPPORT").length);

console.table(filtered.map(x => ({
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

fs.writeFileSync("outputs/slips-priced.json", JSON.stringify(filtered, null, 2));

console.log("Wrote outputs/slips-priced.json");
