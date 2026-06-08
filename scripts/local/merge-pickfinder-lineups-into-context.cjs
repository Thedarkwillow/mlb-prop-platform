const fs = require("fs");
const path = require("path");

const PF = "data/context/pickfinder-lineups.json";
const CTX = "data/context/lineups.json";
const OUT = "data/context/lineups.json";
const REPORT = "outputs/pickfinder-lineup-merge-report.txt";
const REPORT_JSON = "outputs/pickfinder-lineup-merge-report.json";

const TEAM_ALIAS = {
  "NY-A": "NYY",
  "NYA": "NYY",
  "ANA": "LAA",
  "LA": "LAD",
  "AZ": "ARI",
  "WAS": "WSH",
  "OAK": "ATH",
  "CHI-N": "CHC",
  "CHN": "CHC",
  "CHI-A": "CWS",
  "CHA": "CWS",
  "KAN": "KC",
  "SL": "STL"
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
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

function isConfirmed(status) {
  return /^(confirmed|c|x|true|starter|starting)$/i.test(s(status));
}

const pf = readJson(PF, null);
const ctx = readJson(CTX, null);

if (!pf) {
  console.error(`Missing ${PF}`);
  process.exit(1);
}
if (!ctx) {
  console.error(`Missing ${CTX}`);
  process.exit(1);
}

ctx.players ||= {};
ctx.teams ||= {};
ctx.games ||= {};

const rows = Array.isArray(pf.rows) ? pf.rows : [];
const currentRows = rows.filter(r => isConfirmed(r.status));

let addedPlayers = 0;
let upgradedPlayers = 0;
let teamCreated = 0;
let teamUpdated = 0;

const byTeam = {};
const upgradedSample = [];
const addedSample = [];

for (const r of currentRows) {
  const player = s(r.player);
  const n = normName(player);
  const t = team(r.team);
  if (!player || !n || !t) continue;

  const entry = {
    player,
    team: t,
    status: "confirmed",
    battingOrder: Number(r.battingOrder),
    position: s(r.position),
    game: s(r.game),
    matchId: s(r.matchId),
    gamePk: r.gamePk ?? null,
    side: r.side || null,
    source: "pickfinder",
    lineupSource: "PICKFINDER",
    pickfinderStatus: r.status,
    pickfinderMatchId: r.matchId,
    pickfinderCapturedAt: r.capturedAt || pf.generatedAt,
    updatedAt: new Date().toISOString()
  };

  const existing = ctx.players[n];
  if (existing) {
    ctx.players[n] = {
      ...existing,
      ...entry,
      source: existing.source && existing.source !== "pickfinder"
        ? `${existing.source}+pickfinder`
        : "pickfinder",
      lineupSource: "PICKFINDER",
      status: "confirmed"
    };
    upgradedPlayers++;
    if (upgradedSample.length < 40) upgradedSample.push(ctx.players[n]);
  } else {
    ctx.players[n] = entry;
    addedPlayers++;
    if (addedSample.length < 40) addedSample.push(entry);
  }

  ctx.teams[t] ||= {
    team: t,
    status: "unknown",
    confirmedBatters: 0,
    game: s(r.game),
    source: "pickfinder"
  };

  if (!ctx.teams[t].team) ctx.teams[t].team = t;
  ctx.teams[t].status = "confirmed";
  ctx.teams[t].source = ctx.teams[t].source && ctx.teams[t].source !== "pickfinder"
    ? `${ctx.teams[t].source}+pickfinder`
    : "pickfinder";
  ctx.teams[t].lineupSource = "PICKFINDER";
  ctx.teams[t].game = ctx.teams[t].game || s(r.game);
  ctx.teams[t].pickfinderMatchId = r.matchId;
  ctx.teams[t].pickfinderCapturedAt = r.capturedAt || pf.generatedAt;

  byTeam[t] ||= new Set();
  byTeam[t].add(n);
}

for (const [t, set] of Object.entries(byTeam)) {
  if (!ctx.teams[t]._wasExisting) teamCreated++;
  ctx.teams[t].confirmedBatters = Math.max(Number(ctx.teams[t].confirmedBatters || 0), set.size);
  teamUpdated++;
}

delete ctx._pickfinderMerge;
ctx._pickfinderMerge = {
  generatedAt: new Date().toISOString(),
  source: PF,
  pickfinderGeneratedAt: pf.generatedAt,
  pickfinderInputGeneratedAt: pf.inputGeneratedAt,
  pickfinderRows: rows.length,
  pickfinderConfirmedRows: currentRows.length,
  addedPlayers,
  upgradedPlayers,
  teamUpdated
};

writeJson(OUT, ctx);

const report = {
  ...ctx._pickfinderMerge,
  byTeam: Object.fromEntries(Object.entries(byTeam).map(([k,v]) => [k, v.size])),
  upgradedSample,
  addedSample
};

writeJson(REPORT_JSON, report);

const lines = [];
lines.push("PICKFINDER LINEUP MERGE REPORT");
lines.push("==============================");
lines.push(`generatedAt=${report.generatedAt}`);
lines.push(`source=${PF}`);
lines.push(`pickfinderRows=${report.pickfinderRows}`);
lines.push(`pickfinderConfirmedRows=${report.pickfinderConfirmedRows}`);
lines.push(`addedPlayers=${report.addedPlayers}`);
lines.push(`upgradedPlayers=${report.upgradedPlayers}`);
lines.push(`teamUpdated=${report.teamUpdated}`);
lines.push("");
lines.push("BY TEAM");
lines.push("-------");
for (const [k,v] of Object.entries(report.byTeam).sort((a,b)=>b[1]-a[1])) {
  lines.push(`${k}: ${v}`);
}
lines.push("");
lines.push("UPGRADED SAMPLE");
lines.push("---------------");
for (const r of upgradedSample) {
  lines.push(`${r.player} | ${r.team} | ${r.game} | spot=${r.battingOrder} | pos=${r.position} | source=${r.lineupSource}`);
}
lines.push("");
lines.push("ADDED SAMPLE");
lines.push("------------");
for (const r of addedSample) {
  lines.push(`${r.player} | ${r.team} | ${r.game} | spot=${r.battingOrder} | pos=${r.position} | source=${r.lineupSource}`);
}

writeText(REPORT, lines.join("\n") + "\n");

console.log({
  pickfinderRows: rows.length,
  pickfinderConfirmedRows: currentRows.length,
  addedPlayers,
  upgradedPlayers,
  teamUpdated,
  report: REPORT
});
