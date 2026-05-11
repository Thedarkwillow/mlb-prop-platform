const fs = require("fs");

function read(path, fallback) {
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
  s = String(s || "").toLowerCase().replace(/[_\s]+/g, " ").trim();
  if (s.includes("strikeout")) return "strikeouts";
  if (s.includes("hits runs rbis") || s.includes("hits+runs+rbis") || s.includes("hrr")) return "hrr";
  if (s.includes("home run") || s === "hr") return "home_runs";
  if (s.includes("total bases") || s === "bases") return "bases";
  if (s.includes("rbi")) return "rbis";
  if (s.includes("runs")) return "runs";
  if (s.includes("hits allowed")) return "hits_allowed";
  if (s.includes("earned runs")) return "earned_runs_allowed";
  if (s.includes("pitching outs")) return "pitching_outs";
  if (s.includes("hits")) return "hits";
  return s.replace(/\s+/g, "_");
}

function normSide(s) {
  s = String(s || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function key(player, market, side, line) {
  return [normName(player), normMarket(market), normSide(side), String(Number(line))].join("|");
}

function sideCompatible(a, b) {
  return normSide(a) === normSide(b);
}

const priced = read("outputs/slips-priced.json", []);
const vegas = read("data/vegas-consensus.json", []);
const legs = Array.isArray(priced) ? priced : [];

const exact = new Map();
const byPlayerMarketSide = new Map();
const byPlayer = new Map();

for (const v of vegas) {
  const player = v.player || v.participant;
  const market = normMarket(v.market || v.rawMarket);
  const side = normSide(v.side);
  const line = Number(v.line);
  if (!player || !market || !side || !Number.isFinite(line)) continue;

  const k = key(player, market, side, line);
  exact.set(k, v);

  const pms = [normName(player), market, side].join("|");
  if (!byPlayerMarketSide.has(pms)) byPlayerMarketSide.set(pms, []);
  byPlayerMarketSide.get(pms).push(v);

  const pn = normName(player);
  if (!byPlayer.has(pn)) byPlayer.set(pn, []);
  byPlayer.get(pn).push(v);
}

const rows = legs.map(l => {
  const player = l.player;
  const market = normMarket(l.market || l.stat);
  const side = normSide(l.side || l.recommendedSide);
  const line = Number(l.line);

  const exactMatch = exact.get(key(player, market, side, line));
  const nearby = byPlayerMarketSide.get([normName(player), market, side].join("|")) || [];
  const playerRows = byPlayer.get(normName(player)) || [];

  const nearest = nearby
    .filter(x => Number.isFinite(Number(x.line)))
    .map(x => ({
      ...x,
      lineDistance: Math.abs(Number(x.line) - line)
    }))
    .sort((a, b) => a.lineDistance - b.lineDistance)[0];

  let reason = "MATCHED";
  if (!l.sportsbookMatch) {
    if (!playerRows.length) reason = "NO_PLAYER_AT_BOOKS";
    else if (!nearby.length) reason = "PLAYER_FOUND_MARKET_SIDE_MISS";
    else reason = "NEARBY_LINE_ONLY";
  }

  return {
    player,
    team: l.team,
    game: l.game || l.resolvedGame,
    market,
    side,
    line,
    sportsbookMatch: !!l.sportsbookMatch,
    qualityGrade: l.qualityGrade || l.grade || "UNKNOWN",
    books: l.sportsbookBookCount || l.books || 0,
    reason,
    nearestBookLine: nearest?.line ?? null,
    nearestBookMarket: nearest?.market ?? null,
    nearestBookSide: nearest?.side ?? null,
    nearestDistance: nearest?.lineDistance ?? null,
    availableBookMarkets: [...new Set(playerRows.map(x => normMarket(x.market || x.rawMarket)))].slice(0, 10).join(", ")
  };
});

const matched = rows.filter(x => x.sportsbookMatch);
const unmatched = rows.filter(x => !x.sportsbookMatch);

const reasonCounts = {};
for (const r of unmatched) reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;

const marketCounts = {};
for (const r of unmatched) marketCounts[r.market] = (marketCounts[r.market] || 0) + 1;

fs.writeFileSync("outputs/sportsbook-match-diagnostics.json", JSON.stringify(rows, null, 2) + "\n");

console.log("SPORTSBOOK MATCH DIAGNOSTICS");
console.log("============================");
console.log(`Priced legs: ${rows.length}`);
console.log(`Matched: ${matched.length}`);
console.log(`Unmatched: ${unmatched.length}`);
console.log(`Match rate: ${rows.length ? ((matched.length / rows.length) * 100).toFixed(1) : "0.0"}%`);
console.log("");
console.log("UNMATCHED REASONS");
console.table(reasonCounts);
console.log("UNMATCHED MARKETS");
console.table(marketCounts);
console.log("TOP UNMATCHED");
console.table(unmatched.slice(0, 30).map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  line: x.line,
  reason: x.reason,
  nearestLine: x.nearestBookLine,
  dist: x.nearestDistance,
  available: x.availableBookMarkets
})));
console.log("Wrote outputs/sportsbook-match-diagnostics.json");
