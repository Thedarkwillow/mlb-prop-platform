const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const PROD_FILE = "outputs/production-candidates.json";
const BOARD_FILE = "outputs/priced-board.json";
const VEGAS_FILE = "data/vegas-raw.json";

function read(p, f) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return f; }
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name || v.market || v.stat || v.participant || v.description) out.push(v);
  for (const x of Object.values(v)) if (x && typeof x === "object") flat(x, out);
  return out;
}

function normName(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function market(v) {
  let m = String(v?.market || v?.stat || v?.type || v || "").toLowerCase().replace(/\s+/g, "_");
  if (m === "pitcher_strikeouts") m = "strikeouts";
  if (m === "pitcher_outs" || m === "outs_recorded") m = "pitching_outs";
  if (m === "pitcher_hits_allowed") m = "hits_allowed";
  if (m === "pitcher_walks_allowed") m = "walks_allowed";
  if (m === "pitcher_earned_runs") m = "earned_runs_allowed";
  if (m === "pitcher_fantasy_score") m = "pitcher_fantasy_score";
  return m;
}

function side(v) {
  const raw = String(v?.side ?? v?.recommendedSide ?? v?.playableSide ?? v?.outcome ?? v?.selection ?? "").toUpperCase();
  if (raw === "OVER") return "MORE";
  if (raw === "UNDER") return "LESS";
  return raw;
}

function line(v) {
  const n = Number(v?.line ?? v?.points ?? v?.point ?? v?.target ?? v?.value ?? v?.threshold);
  return Number.isFinite(n) ? n : null;
}

function player(v) {
  return v?.player || v?.playerName || v?.name || v?.participant || v?.description || "";
}

function isPitcherMarket(m) {
  return [
    "strikeouts",
    "pitching_outs",
    "hits_allowed",
    "walks_allowed",
    "earned_runs_allowed",
    "pitcher_fantasy_score"
  ].includes(market(m));
}

function uniqKey(r) {
  return [
    normName(player(r)),
    market(r),
    side(r),
    String(line(r) ?? ""),
    String(r.oddsTier || r.tier || "standard").toLowerCase()
  ].join("|");
}

function teamGame(r) {
  return String(r.game || r.resolvedGame || r.event || "").replace(/\s+/g, " ").trim();
}

function dist(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a) return b.length;
  if (!b) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function bookCount(rows) {
  return [...new Set(rows.map(r => r.sportsbook || r.sportsbookTitle || r.book || r.bookmaker).filter(Boolean))].length;
}

const prod = read(PROD_FILE, {});
const board = read(BOARD_FILE, []);
const vegasRaw = read(VEGAS_FILE, []);

const prodRows = flat(prod.all || prod.classes || prod)
  .filter(r => player(r) && isPitcherMarket(r));

const boardRows = flat(board)
  .filter(r => player(r) && isPitcherMarket(r));

const byKey = new Map();
for (const r of [...prodRows, ...boardRows]) {
  const k = uniqKey(r);
  if (!byKey.has(k)) byKey.set(k, r);
}
const pitcherRows = [...byKey.values()];

const vegasRows = flat(vegasRaw)
  .filter(r => player(r) && isPitcherMarket(r) && side(r) && line(r) !== null)
  .map(r => ({
    sportsbook: r.sportsbook || r.sportsbookTitle || r.book || r.bookmaker || "",
    player: player(r),
    playerKey: normName(player(r)),
    market: market(r),
    side: side(r),
    line: line(r),
    odds: Number(r.odds ?? r.price),
    game: teamGame(r),
    event: r.event || r.game || "",
    rawMarket: r.rawMarket || r.market || r.key || "",
    lastUpdate: r.lastUpdate || r.last_update || ""
  }));

function classify(row) {
  const p = player(row);
  const pk = normName(p);
  const m = market(row);
  const sd = side(row);
  const ln = line(row);

  const sameMarket = vegasRows.filter(v => v.market === m);
  const samePlayer = vegasRows.filter(v => v.playerKey === pk);
  const samePlayerMarket = vegasRows.filter(v => v.playerKey === pk && v.market === m);
  const samePlayerMarketSide = samePlayerMarket.filter(v => v.side === sd);
  const exact = samePlayerMarketSide.filter(v => Number(v.line) === Number(ln));

  const closest = samePlayerMarketSide
    .slice()
    .sort((a, b) => Math.abs(Number(a.line) - Number(ln)) - Math.abs(Number(b.line) - Number(ln)))
    .slice(0, 8);

  const fuzzySameMarket = sameMarket
    .map(v => ({
      player: v.player,
      playerKey: v.playerKey,
      market: v.market,
      side: v.side,
      line: v.line,
      sportsbook: v.sportsbook,
      nameDistance: dist(pk, v.playerKey)
    }))
    .filter(v => v.nameDistance <= 5)
    .sort((a, b) => a.nameDistance - b.nameDistance)
    .slice(0, 8);

  let coverage = "UNKNOWN";
  if (exact.length && bookCount(exact) >= 2) coverage = "EXACT_SUPPORTED";
  else if (exact.length && bookCount(exact) === 1) coverage = "EXACT_LOW_BOOK";
  else if (samePlayerMarketSide.length) coverage = "LINE_MISMATCH";
  else if (samePlayerMarket.length) coverage = "SIDE_MISSING";
  else if (samePlayer.length) coverage = "MARKET_MISSING_FOR_PLAYER";
  else if (sameMarket.length) coverage = "PLAYER_NOT_IN_VEGAS_RAW";
  else coverage = "SPORTSBOOK_MARKET_MISSING";

  return {
    player: p,
    team: row.team || row.resolvedTeam || "",
    game: teamGame(row),
    market: m,
    side: sd,
    line: ln,
    tier: row.oddsTier || row.tier || "standard",
    source: row.source || row.recordType || row.class || row.classification || "",
    productionClass: row.class || row.classification || row.candidateClass || "",
    support: row.support || row.marketSupportFlag || "",
    grade: row.grade || row.qualityGrade || "",
    books: Number(row.books ?? row.sportsbookBookCount ?? row.bookCount ?? 0),
    prob: row.prob ?? row.recommendedProb ?? row.calibratedDistributionProb ?? null,
    edge: row.edge ?? row.expectedValue ?? row.sportsbookEdge ?? null,
    coverage,
    vegasSameMarketRows: sameMarket.length,
    vegasSamePlayerRows: samePlayer.length,
    vegasSamePlayerMarketRows: samePlayerMarket.length,
    vegasSamePlayerMarketSideRows: samePlayerMarketSide.length,
    exactBooks: bookCount(exact),
    closestLines: [...new Set(closest.map(x => x.line))].join(","),
    closestBooks: bookCount(closest),
    closestCandidates: closest,
    fuzzySameMarket
  };
}

function group(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([bucket, rows]) => ({ bucket, rows }))
    .sort((a,b) => b.rows - a.rows || String(a.bucket).localeCompare(String(b.bucket)));
}

const rows = pitcherRows.map(classify);

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  sources: {
    production: PROD_FILE,
    board: BOARD_FILE,
    vegas: VEGAS_FILE
  },
  counts: {
    productionPitcherRows: prodRows.length,
    boardPitcherRows: boardRows.length,
    uniquePitcherRows: rows.length,
    vegasPitcherRows: vegasRows.length
  },
  summary: {
    byCoverage: group(rows, r => r.coverage),
    byMarketCoverage: group(rows, r => `${r.market}|${r.coverage}`),
    unsupportedByMarket: group(rows.filter(r => !["EXACT_SUPPORTED", "EXACT_LOW_BOOK"].includes(r.coverage)), r => r.market)
  },
  rows
};

const outJson = `outputs/pitcher-vegas-coverage-audit-${DATE}.json`;
const outTxt = `outputs/pitcher-vegas-coverage-audit-${DATE}.txt`;

fs.writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");

const lines = [];
lines.push(`PITCHER VEGAS COVERAGE AUDIT ${DATE}`);
lines.push("===================================");
lines.push("");
lines.push(`productionPitcherRows: ${report.counts.productionPitcherRows}`);
lines.push(`boardPitcherRows: ${report.counts.boardPitcherRows}`);
lines.push(`uniquePitcherRows: ${report.counts.uniquePitcherRows}`);
lines.push(`vegasPitcherRows: ${report.counts.vegasPitcherRows}`);
lines.push("");
lines.push("BY COVERAGE");
for (const r of report.summary.byCoverage) lines.push(`${r.bucket}: ${r.rows}`);
lines.push("");
lines.push("BY MARKET + COVERAGE");
for (const r of report.summary.byMarketCoverage) lines.push(`${r.bucket}: ${r.rows}`);
lines.push("");
lines.push("UNSUPPORTED DETAILS");
for (const r of rows.filter(x => !["EXACT_SUPPORTED", "EXACT_LOW_BOOK"].includes(x.coverage)).slice(0, 200)) {
  lines.push(`- ${r.player} | ${r.team || "?"} | ${r.market} ${r.side} ${r.line} | ${r.coverage} | closestLines=${r.closestLines || "none"} | closestBooks=${r.closestBooks} | game=${r.game || "?"}`);
  for (const c of r.closestCandidates.slice(0, 3)) {
    lines.push(`   closest: ${c.player} | ${c.market} ${c.side} ${c.line} | ${c.sportsbook} | odds=${c.odds}`);
  }
  for (const f of r.fuzzySameMarket.slice(0, 3)) {
    lines.push(`   fuzzy: ${f.player} | ${f.market} ${f.side} ${f.line} | ${f.sportsbook} | nameDistance=${f.nameDistance}`);
  }
}
fs.writeFileSync(outTxt, lines.join("\n") + "\n");

console.log(report.counts);
console.log("BY COVERAGE");
console.table(report.summary.byCoverage);
console.log("BY MARKET + COVERAGE");
console.table(report.summary.byMarketCoverage);
console.log("UNSUPPORTED SAMPLE");
console.table(rows.filter(r => !["EXACT_SUPPORTED", "EXACT_LOW_BOOK"].includes(r.coverage)).slice(0, 40).map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  coverage: r.coverage,
  closestLines: r.closestLines,
  closestBooks: r.closestBooks
})));
console.log(`saved: ${outJson}`);
console.log(`saved: ${outTxt}`);
