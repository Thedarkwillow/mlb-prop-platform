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

  if (s.includes("hits runs rbis") || s.includes("hits+runs+rbis") || s === "hrr") return "hrr";
  if (s.includes("total bases") || s === "bases") return "bases";
  if (s === "hit" || s === "hits") return "hits";
  if (s.includes("strikeout")) return "strikeouts";
  if (s.includes("pitching outs") || s.includes("outs recorded")) return "pitching_outs";
  if (s.includes("earned runs")) return "earned_runs_allowed";
  if (s.includes("hits allowed")) return "hits_allowed";
  if (s.includes("walks allowed")) return "walks_allowed";
  if (s.includes("home run") || s === "hr") return "home_runs";
  if (s.includes("rbi")) return "rbis";
  if (s === "run" || s === "runs") return "runs";
  if (s.includes("single")) return "singles";
  if (s.includes("double")) return "doubles";
  if (s.includes("walk")) return "walks";

  return s.replace(/\s+/g, "_");
}

function sideOf(x) {
  return String(x.side || x.recommendedSide || x.pickSide || x.direction || "").toUpperCase();
}

function lineOf(x) {
  const v = Number(x.line ?? x.ppLine ?? x.sportsbookMatchedLine ?? x.bookLine);
  return Number.isFinite(v) ? v : null;
}

function playerOf(x) {
  return x.player || x.playerName || x.name || x.description || "";
}

function marketOf(x) {
  return normMarket(x.market || x.stat || x.statType || x.prop || x.projectionType || "");
}

function bookRows() {
  const raw = read("data/vegas-consensus.json", []);
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.rows)) return raw.rows;
  if (Array.isArray(raw.props)) return raw.props;
  if (Array.isArray(raw.playerProps)) return raw.playerProps;
  return [];
}

function slipRows() {
  const priced = read("outputs/slips-priced.json", []);
  if (Array.isArray(priced)) return priced;
  return priced.rows || priced.legs || [];
}

const books = bookRows().map(r => ({
  raw: r,
  player: playerOf(r),
  playerKey: normName(playerOf(r)),
  market: marketOf(r),
  side: sideOf(r),
  line: lineOf(r),
  odds: r.odds ?? r.price ?? r.consensusOdds ?? null
}));

const priced = slipRows();

const diagnostics = [];

for (const leg of priced) {
  if (leg.sportsbookMatch === true) continue;

  const player = playerOf(leg);
  const playerKey = normName(player);
  const market = marketOf(leg);
  const side = sideOf(leg);
  const line = lineOf(leg);

  const samePlayer = books.filter(b => b.playerKey === playerKey);
  const samePlayerMarket = samePlayer.filter(b => b.market === market);
  const samePlayerMarketSide = samePlayerMarket.filter(b => !side || !b.side || b.side === side);

  let reason = "UNKNOWN";
  let nearestLine = null;
  let nearestDistance = null;

  if (!samePlayer.length) {
    reason = "NO_PLAYER_AT_BOOKS";
  } else if (!samePlayerMarket.length) {
    reason = "PLAYER_FOUND_MARKET_MISS";
  } else if (!samePlayerMarketSide.length) {
    reason = "PLAYER_MARKET_FOUND_SIDE_MISS";
  } else {
    const lines = samePlayerMarketSide.map(x => x.line).filter(x => Number.isFinite(x));
    if (line != null && lines.length) {
      const nearest = lines
        .map(x => ({ line: x, dist: Math.abs(x - line) }))
        .sort((a, b) => a.dist - b.dist)[0];

      nearestLine = nearest.line;
      nearestDistance = nearest.dist;

      if (nearest.dist === 0) reason = "EXACT_LINE_EXISTS_BUT_NOT_MATCHED";
      else if (nearest.dist <= 1) reason = "NEARBY_LINE_ONLY";
      else reason = "NO_CLOSE_LINE";
    } else {
      reason = "LINE_MISSING_OR_UNPARSEABLE";
    }
  }

  diagnostics.push({
    player,
    team: leg.team || null,
    game: leg.game || null,
    market,
    side,
    ppLine: line,
    reason,
    nearestLine,
    nearestDistance,
    availableMarkets: [...new Set(samePlayer.map(x => x.market))].sort(),
    availableLinesSameMarket: [...new Set(samePlayerMarket.map(x => x.line).filter(x => x != null))].sort((a, b) => a - b),
    availableSidesSameMarket: [...new Set(samePlayerMarket.map(x => x.side).filter(Boolean))].sort()
  });
}

function countBy(arr, fn) {
  const out = {};
  for (const x of arr) {
    const k = fn(x);
    out[k] = (out[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

fs.writeFileSync("outputs/unmatched-pricing.json", JSON.stringify(diagnostics, null, 2) + "\n");

console.log("UNMATCHED PRICING DIAGNOSTICS");
console.log("=============================");
console.log(`Unmatched: ${diagnostics.length}`);
console.log("");
console.log("Reasons:");
console.table(countBy(diagnostics, x => x.reason));
console.log("Markets:");
console.table(countBy(diagnostics, x => x.market));
console.log("Top unmatched:");
console.table(diagnostics.slice(0, 30).map(x => ({
  player: x.player,
  market: x.market,
  side: x.side,
  ppLine: x.ppLine,
  reason: x.reason,
  nearestLine: x.nearestLine,
  availableMarkets: x.availableMarkets.join(", "),
  availableLines: x.availableLinesSameMarket.join(", ")
})));
console.log("Wrote outputs/unmatched-pricing.json");
