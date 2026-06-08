const fs = require("fs");
const path = require("path");

const BOARD = "outputs/priced-board.json";
const PF = "data/context/pickfinder-lineups.json";
const OUT = "outputs/priced-board.json";
const REPORT = "outputs/pickfinder-board-lineup-source-report.txt";
const REPORT_JSON = "outputs/pickfinder-board-lineup-source-report.json";

const TEAM_ALIAS = {
  "NY-A": "NYY", NYA: "NYY",
  ANA: "LAA",
  LA: "LAD",
  AZ: "ARI",
  WAS: "WSH",
  OAK: "ATH",
  "CHI-N": "CHC", CHN: "CHC",
  "CHI-A": "CWS", CHA: "CWS",
  KAN: "KC",
  SL: "STL"
};

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function text(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

function s(v) {
  return String(v ?? "").trim();
}

function normName(v) {
  return s(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function team(v) {
  const x = s(v).toUpperCase();
  return TEAM_ALIAS[x] || x;
}

function playerName(r) {
  return s(r.player || r.playerName || r.name || r.fullName || r.displayName);
}

function rowTeam(r) {
  return team(r.team || r.teamAbbr || r.playerTeam || r.player_team || "");
}

function isConfirmed(status) {
  return /^(confirmed|c|x|true|starter|starting)$/i.test(s(status));
}

function walkMut(v, cb) {
  if (!v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) walkMut(x, cb);
    return;
  }
  cb(v);
  for (const x of Object.values(v)) {
    if (x && typeof x === "object") walkMut(x, cb);
  }
}

const board = read(BOARD, null);
const pf = read(PF, null);
if (!board) {
  console.error(`missing ${BOARD}`);
  process.exit(1);
}
if (!pf) {
  console.error(`missing ${PF}`);
  process.exit(1);
}

const pfRows = Array.isArray(pf.rows) ? pf.rows : [];
const pfIndex = new Map();

for (const r of pfRows) {
  if (!isConfirmed(r.status)) continue;
  const key = `${normName(r.player)}|${team(r.team)}`;
  if (!normName(r.player) || !team(r.team)) continue;
  pfIndex.set(key, {
    player: r.player,
    team: team(r.team),
    status: "CONFIRMED",
    source: "PICKFINDER",
    battingOrder: r.battingOrder,
    position: r.position,
    game: r.game,
    matchId: r.matchId,
    capturedAt: r.capturedAt || pf.generatedAt
  });
}

let boardRows = 0;
let playerRows = 0;
let matched = 0;
let alreadyConfirmed = 0;
let unmatched = 0;
const byMarket = {};
const sample = [];
const missingSample = [];

walkMut(board, r => {
  if (!r || typeof r !== "object") return;
  if (!(r.player || r.playerName || r.market || r.statType || r.line)) return;
  boardRows++;

  const p = playerName(r);
  const t = rowTeam(r);
  if (!p) return;
  playerRows++;

  const key = `${normName(p)}|${t}`;
  const hit = pfIndex.get(key);

  if (!hit) {
    unmatched++;
    if (missingSample.length < 60) {
      missingSample.push({
        player: p,
        team: t,
        market: r.market || r.statType,
        side: r.side,
        line: r.line
      });
    }
    return;
  }

  const beforeStatus = s(r.lineupStatus || r.confirmedLineupStatus || "");
  if (/confirmed/i.test(beforeStatus)) alreadyConfirmed++;

  r.lineupStatus = "CONFIRMED";
  r.confirmedLineupStatus = "CONFIRMED";
  r.lineupSource = "PICKFINDER";
  r.confirmedLineupSource = "PICKFINDER";
  r.pickfinderLineupStatus = hit.status;
  r.pickfinderBattingOrder = hit.battingOrder;
  r.pickfinderPosition = hit.position;
  r.pickfinderMatchId = hit.matchId;
  r.pickfinderLineupCapturedAt = hit.capturedAt;

  matched++;
  const m = s(r.market || r.statType || "UNKNOWN");
  byMarket[m] = (byMarket[m] || 0) + 1;

  if (sample.length < 80) {
    sample.push({
      player: p,
      team: t,
      market: r.market || r.statType,
      side: r.side,
      line: r.line,
      lineupStatus: r.lineupStatus,
      lineupSource: r.lineupSource,
      battingOrder: hit.battingOrder,
      position: hit.position
    });
  }
});

write(OUT, board);

const report = {
  generatedAt: new Date().toISOString(),
  sourceBoard: BOARD,
  sourcePickFinder: PF,
  pickfinderPlayers: pfIndex.size,
  boardRows,
  playerRows,
  matched,
  alreadyConfirmed,
  unmatched,
  byMarket: Object.fromEntries(Object.entries(byMarket).sort((a,b)=>b[1]-a[1])),
  sample,
  missingSample
};

write(REPORT_JSON, report);

const lines = [];
lines.push("PICKFINDER BOARD LINEUP SOURCE REPORT");
lines.push("=====================================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`pickfinderPlayers=${report.pickfinderPlayers}`);
lines.push(`boardRows=${report.boardRows}`);
lines.push(`playerRows=${report.playerRows}`);
lines.push(`matched=${report.matched}`);
lines.push(`alreadyConfirmed=${report.alreadyConfirmed}`);
lines.push(`unmatched=${report.unmatched}`);
lines.push("");
lines.push("MATCHED BY MARKET");
lines.push("-----------------");
for (const [k,v] of Object.entries(report.byMarket)) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("MATCHED SAMPLE");
lines.push("--------------");
for (const r of sample) {
  lines.push(`${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line} | spot=${r.battingOrder} | pos=${r.position} | source=${r.lineupSource}`);
}
lines.push("");
lines.push("MISSING SAMPLE");
lines.push("--------------");
for (const r of missingSample) {
  lines.push(`${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line}`);
}

text(REPORT, lines.join("\n") + "\n");

console.log({
  pickfinderPlayers: report.pickfinderPlayers,
  boardRows,
  playerRows,
  matched,
  alreadyConfirmed,
  unmatched,
  report: REPORT
});
