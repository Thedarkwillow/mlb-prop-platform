const fs = require("fs");

const OUT_JSON = "outputs/manual/pickfinder-field-coverage-report.json";
const OUT_TXT = "outputs/manual/pickfinder-field-coverage-report.txt";

const SOURCES = [
  "data/manual/manual-research-ledger.json",
  "outputs/manual/manual-model-compare.json",
  "outputs/history/market-intel-history.json",
  "outputs/history/full-board-history.json",
  "data/prizepicks-history.json",
  "outputs/priced-board.json"
];

const HITTER_MARKETS = new Set([
  "hrr",
  "bases",
  "hits",
  "runs",
  "rbis",
  "walks",
  "singles",
  "doubles",
  "triples",
  "home_runs",
  "hitter_fantasy_score",
  "hitter_strikeouts"
]);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.name) out.push(v);
  for (const val of Object.values(v)) {
    if (val && typeof val === "object") flatten(val, out);
  }
  return out;
}

function lower(v) {
  return String(v || "").toLowerCase();
}

function marketOf(r) {
  return lower(r.market || r.statType || r.type || r.projectionType || "");
}

function playerOf(r) {
  return r.player || r.playerName || r.name || "";
}

function hasAny(r, fields) {
  return fields.some(f => {
    const v = r[f];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

function valAny(r, fields) {
  for (const f of fields) {
    const v = r[f];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

const FIELD_GROUPS = {
  date: ["date", "slateDate", "gameDate"],
  player: ["player", "playerName", "name"],
  team: ["team", "resolvedTeam", "playerTeam"],
  opponent: ["opponent", "opp", "opposingTeam", "resolvedOpponent"],
  homeAway: ["homeAway", "home_away", "venueSide"],
  market: ["market", "statType", "type", "projectionType"],
  side: ["side", "pickSide", "direction"],
  line: ["line", "ppLine", "projectionLine"],
  actual: ["actual", "actualValue", "score", "resultValue"],
  result: ["result", "outcome", "grade"],
  gamePk: ["gamePk", "gameId", "mlbGamePk"],
  opposingPitcher: ["opposingPitcher", "probablePitcher", "opponentPitcher", "startingPitcher"],
  opposingPitcherHand: ["opposingPitcherHand", "pitcherHand", "hand", "throws"],
  battingOrder: ["battingOrder", "lineupSpot", "battingPosition", "order"],
  venue: ["venue", "ballpark", "park"],
  sourceGame: ["game", "matchup", "resolvedGame"]
};

const rows = [];

for (const file of SOURCES) {
  const raw = readJson(file, null);
  if (!raw) continue;

  const flat = flatten(raw).filter(r => playerOf(r) && HITTER_MARKETS.has(marketOf(r)));

  for (const r of flat) {
    const row = {
      sourceFile: file,
      player: playerOf(r),
      market: marketOf(r),
      date: valAny(r, FIELD_GROUPS.date),
      team: valAny(r, FIELD_GROUPS.team),
      opponent: valAny(r, FIELD_GROUPS.opponent),
      homeAway: valAny(r, FIELD_GROUPS.homeAway),
      side: valAny(r, FIELD_GROUPS.side),
      line: valAny(r, FIELD_GROUPS.line),
      actual: valAny(r, FIELD_GROUPS.actual),
      result: valAny(r, FIELD_GROUPS.result),
      gamePk: valAny(r, FIELD_GROUPS.gamePk),
      opposingPitcher: valAny(r, FIELD_GROUPS.opposingPitcher),
      opposingPitcherHand: valAny(r, FIELD_GROUPS.opposingPitcherHand),
      battingOrder: valAny(r, FIELD_GROUPS.battingOrder),
      venue: valAny(r, FIELD_GROUPS.venue),
      sourceGame: valAny(r, FIELD_GROUPS.sourceGame)
    };

    rows.push(row);
  }
}

function coverageFor(rows) {
  const total = rows.length;
  const out = {};
  for (const [field] of Object.entries(FIELD_GROUPS)) {
    const count = rows.filter(r => r[field] !== null && r[field] !== undefined && String(r[field]).trim() !== "").length;
    out[field] = {
      count,
      pct: total ? Math.round((count / total) * 10000) / 100 : null
    };
  }
  return out;
}

function groupBy(rows, fn) {
  const m = {};
  for (const r of rows) {
    const k = fn(r);
    (m[k] ||= []).push(r);
  }
  return m;
}

const bySource = Object.entries(groupBy(rows, r => r.sourceFile)).map(([sourceFile, rs]) => ({
  sourceFile,
  rows: rs.length,
  coverage: coverageFor(rs)
}));

const byMarket = Object.entries(groupBy(rows, r => r.market)).map(([market, rs]) => ({
  market,
  rows: rs.length,
  coverage: coverageFor(rs)
})).sort((a, b) => b.rows - a.rows);

const usablePickFinderRows = rows.filter(r =>
  r.player &&
  r.market &&
  r.line !== null &&
  r.actual !== null &&
  r.result !== null
);

const fullContextRows = rows.filter(r =>
  r.player &&
  r.market &&
  r.line !== null &&
  r.actual !== null &&
  r.result !== null &&
  r.homeAway &&
  r.opponent &&
  r.opposingPitcher &&
  r.opposingPitcherHand
);

const report = {
  generatedAt: new Date().toISOString(),
  mode: "FIELD_COVERAGE_ONLY_NO_API",
  sourceFiles: SOURCES,
  totalRows: rows.length,
  usablePickFinderRows: usablePickFinderRows.length,
  fullContextRows: fullContextRows.length,
  overallCoverage: coverageFor(rows),
  bySource,
  byMarket,
  missingPriority: {
    homeAway: rows.length - rows.filter(r => r.homeAway).length,
    opponent: rows.length - rows.filter(r => r.opponent).length,
    opposingPitcher: rows.length - rows.filter(r => r.opposingPitcher).length,
    opposingPitcherHand: rows.length - rows.filter(r => r.opposingPitcherHand).length,
    gamePk: rows.length - rows.filter(r => r.gamePk).length,
    battingOrder: rows.length - rows.filter(r => r.battingOrder).length
  },
  sampleMissingContext: rows.filter(r =>
    !r.homeAway || !r.opponent || !r.opposingPitcher || !r.opposingPitcherHand
  ).slice(0, 50)
};

const lines = [];
lines.push("PICK FINDER FIELD COVERAGE REPORT");
lines.push("=================================");
lines.push(`mode: ${report.mode}`);
lines.push(`total hitter rows scanned: ${report.totalRows}`);
lines.push(`usable Pick Finder rows: ${report.usablePickFinderRows}`);
lines.push(`full context rows: ${report.fullContextRows}`);
lines.push("");
lines.push("OVERALL COVERAGE");
lines.push("----------------");
for (const [field, c] of Object.entries(report.overallCoverage)) {
  lines.push(`- ${field}: ${c.count}/${report.totalRows} (${c.pct ?? "n/a"}%)`);
}
lines.push("");
lines.push("PRIORITY MISSING FIELDS");
lines.push("-----------------------");
for (const [field, count] of Object.entries(report.missingPriority)) {
  lines.push(`- ${field}: missing ${count}`);
}
lines.push("");
lines.push("BY SOURCE");
lines.push("---------");
for (const s of bySource) {
  lines.push(`- ${s.sourceFile}: rows=${s.rows} homeAway=${s.coverage.homeAway.pct}% opponent=${s.coverage.opponent.pct}% pitcher=${s.coverage.opposingPitcher.pct}% pitcherHand=${s.coverage.opposingPitcherHand.pct}% gamePk=${s.coverage.gamePk.pct}%`);
}
lines.push("");
lines.push("BY MARKET");
lines.push("---------");
for (const m of byMarket.slice(0, 20)) {
  lines.push(`- ${m.market}: rows=${m.rows} homeAway=${m.coverage.homeAway.pct}% opponent=${m.coverage.opponent.pct}% pitcher=${m.coverage.opposingPitcher.pct}% pitcherHand=${m.coverage.opposingPitcherHand.pct}%`);
}
lines.push("");
lines.push("RULE");
lines.push("----");
lines.push("This report only measures data coverage. Next step is backfill if homeAway/opponent/opposingPitcher/opposingPitcherHand coverage is low.");

fs.mkdirSync("outputs/manual", { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(OUT_TXT, lines.join("\n") + "\n");

console.log(lines.join("\n"));
console.log(`saved: ${OUT_JSON}`);
console.log(`saved: ${OUT_TXT}`);
