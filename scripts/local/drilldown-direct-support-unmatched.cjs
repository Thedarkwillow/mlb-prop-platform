const fs = require("fs");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const AUDIT_FILE = `outputs/direct-support-repair-audit-${DATE}.json`;
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
  if (v.player || v.playerName || v.market || v.stat || v.sportsbook || v.participant || v.description) out.push(v);
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
  if (m === "total_bases" || m === "batter_total_bases") m = "bases";
  if (m === "batter_hits") m = "hits";
  if (m === "batter_rbis" || m === "runs_batted_in") m = "rbis";
  if (m === "batter_runs_scored") m = "runs";
  if (m === "batter_walks") m = "walks";
  if (m === "batter_home_runs") m = "hr";
  if (m === "batter_hits_runs_rbis" || m === "hits+runs+rbis" || m === "hits_runs_rbis") m = "hrr";
  if (m === "pitcher_strikeouts") m = "strikeouts";
  if (m === "pitcher_outs" || m === "outs_recorded") m = "pitching_outs";
  if (m === "pitcher_hits_allowed") m = "hits_allowed";
  if (m === "pitcher_walks_allowed") m = "walks_allowed";
  if (m === "pitcher_earned_runs") m = "earned_runs_allowed";
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

function books(rows) {
  return [...new Set(rows.map(r => r.sportsbook || r.book || r.bookmaker || r.sportsbookTitle).filter(Boolean))];
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

const audit = read(AUDIT_FILE, {});
const vegas = flat(read(VEGAS_FILE, []));

const allAuditRows = [
  ...(audit.unmatchedRows || []),
  ...(audit.patchedRows || []),
  ...(audit.rows || []),
  ...(audit.all || [])
];

const targetRows = allAuditRows.filter(r => {
  const reason = String(r.reason || r.repairReason || r.status || "").toLowerCase();
  return reason.includes("unmatched") || reason.includes("market_exists") || reason.includes("sportsbook_market_missing");
});

const vegasRows = vegas
  .filter(r => player(r) && market(r) && side(r) && line(r) !== null)
  .map(r => ({
    sportsbook: r.sportsbook || r.book || r.bookmaker || r.sportsbookTitle || "",
    player: player(r),
    playerKey: normName(player(r)),
    market: market(r),
    side: side(r),
    line: line(r),
    odds: Number(r.odds ?? r.price),
    game: r.game || r.event || "",
    rawMarket: r.rawMarket || r.market || r.key || "",
    lastUpdate: r.lastUpdate || r.last_update || ""
  }));

function classifyMiss(row) {
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

  let missType = "unknown";
  if (!sameMarket.length) missType = "sportsbook_market_missing";
  else if (!samePlayer.length) missType = "player_not_in_vegas_raw";
  else if (!samePlayerMarket.length) missType = "player_found_market_missing_for_player";
  else if (!samePlayerMarketSide.length) missType = "player_market_found_side_missing";
  else if (!exact.length) missType = "player_market_side_found_line_mismatch";
  else missType = "exact_exists";

  const samePlayerMarketCandidates = samePlayerMarketSide
    .sort((a,b) => Math.abs(Number(a.line) - Number(ln)) - Math.abs(Number(b.line) - Number(ln)))
    .slice(0, 8);

  const fuzzyPlayers = sameMarket
    .map(v => ({
      player: v.player,
      market: v.market,
      side: v.side,
      line: v.line,
      sportsbook: v.sportsbook,
      nameDistance: dist(pk, v.playerKey)
    }))
    .filter(v => v.nameDistance <= 5)
    .sort((a,b) => a.nameDistance - b.nameDistance)
    .slice(0, 8);

  return {
    player: p,
    market: m,
    side: sd,
    line: ln,
    reason: row.reason || row.repairReason || row.status || "",
    missType,
    sameMarketRows: sameMarket.length,
    samePlayerRows: samePlayer.length,
    samePlayerMarketRows: samePlayerMarket.length,
    samePlayerMarketSideRows: samePlayerMarketSide.length,
    closestLines: [...new Set(samePlayerMarketCandidates.map(x => x.line))].join(","),
    booksOnClosest: books(samePlayerMarketCandidates).length,
    closestCandidates: samePlayerMarketCandidates,
    fuzzyPlayers
  };
}

const drill = targetRows.map(classifyMiss);

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

const report = {
  date: DATE,
  generatedAt: new Date().toISOString(),
  auditFile: AUDIT_FILE,
  vegasFile: VEGAS_FILE,
  summary: {
    targetRows: drill.length,
    byMissType: group(drill, r => r.missType),
    byMarketMissType: group(drill, r => `${r.market}|${r.missType}`)
  },
  rows: drill
};

const outJson = `outputs/direct-support-unmatched-drilldown-${DATE}.json`;
const outTxt = `outputs/direct-support-unmatched-drilldown-${DATE}.txt`;

fs.writeFileSync(outJson, JSON.stringify(report, null, 2) + "\n");

const lines = [];
lines.push(`DIRECT SUPPORT UNMATCHED DRILLDOWN ${DATE}`);
lines.push("=========================================");
lines.push("");
lines.push("BY MISS TYPE");
for (const r of report.summary.byMissType) lines.push(`${r.bucket}: ${r.rows}`);
lines.push("");
lines.push("BY MARKET + MISS TYPE");
for (const r of report.summary.byMarketMissType) lines.push(`${r.bucket}: ${r.rows}`);
lines.push("");
lines.push("DETAILS");
for (const r of drill) {
  lines.push(`- ${r.player} | ${r.market} ${r.side} ${r.line} | ${r.missType} | reason=${r.reason} | closestLines=${r.closestLines || "none"} | booksOnClosest=${r.booksOnClosest}`);
  if (r.closestCandidates.length) {
    for (const c of r.closestCandidates.slice(0, 3)) {
      lines.push(`   closest: ${c.player} | ${c.market} ${c.side} ${c.line} | ${c.sportsbook} | odds=${c.odds}`);
    }
  }
  if (r.fuzzyPlayers.length) {
    for (const f of r.fuzzyPlayers.slice(0, 3)) {
      lines.push(`   fuzzy: ${f.player} | ${f.market} ${f.side} ${f.line} | ${f.sportsbook} | nameDistance=${f.nameDistance}`);
    }
  }
}
fs.writeFileSync(outTxt, lines.join("\n") + "\n");

console.log(report.summary);
console.log("BY MISS TYPE");
console.table(report.summary.byMissType);
console.log("BY MARKET + MISS TYPE");
console.table(report.summary.byMarketMissType);
console.log("SAMPLE");
console.table(drill.slice(0, 30).map(r => ({
  player: r.player,
  market: r.market,
  side: r.side,
  line: r.line,
  missType: r.missType,
  closestLines: r.closestLines,
  booksOnClosest: r.booksOnClosest
})));
console.log(`saved: ${outJson}`);
console.log(`saved: ${outTxt}`);
