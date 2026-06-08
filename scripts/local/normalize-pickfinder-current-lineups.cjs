const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const IN = "outputs/pickfinder-mlb-lineups.json";
const OUT = "data/context/pickfinder-lineups.json";
const OUT2 = "outputs/pickfinder-lineups-current.json";
const TXT = "outputs/pickfinder-lineups-current.txt";

function slateDate() {
  try {
    return cp.execSync("node scripts/local/board-slate-date.cjs", { encoding: "utf8" }).trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const SLATE_DATE = slateDate();

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

function norm(v) {
  return s(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactDate(d) {
  return s(d).replace(/-/g, "");
}

function dateFromMatchId(id) {
  const m = s(id).match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function getName(o) {
  return s(o.fullName || o.displayName || o.name || o.player_name || o.playerName);
}

function getSpot(o) {
  const v = o.battingSpot ?? o.battingOrder ?? o.batting_order ?? o.order ?? o.lineupOrder ?? o.spot;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getStatus(o) {
  const raw = s(o.lineupStatus || o.status || o.confirmed || o.isStarter || o.starter || o.starting);
  if (/^x$/i.test(raw)) return "confirmed";
  if (/true/i.test(raw)) return "confirmed";
  if (/confirmed|starter|starting/i.test(raw)) return "confirmed";
  return raw || "unknown";
}

function getTeamValue(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    return s(v.abbreviation || v.abbr || v.team || v.name || v.shortName || v.short_name);
  }
  return "";
}

function teamAbbrFromObj(o) {
  return getTeamValue(o.team) ||
    s(o.teamAbbr || o.team_abbr || o.abbreviation || o.shortName || o.short_name || o.teamName);
}

function teamNameFromObj(o) {
  if (o.team && typeof o.team === "object") return s(o.team.name || o.team.fullName || o.team.displayName);
  return s(o.teamName || o.fullTeamName || o.name);
}

function isPlayerLike(o) {
  return !!getName(o) && getSpot(o) !== null;
}

function isTeamLike(o) {
  if (!o || typeof o !== "object") return false;
  if (teamAbbrFromObj(o) && (
    Array.isArray(o.players) ||
    Array.isArray(o.batters) ||
    Array.isArray(o.lineup) ||
    Array.isArray(o.lineups) ||
    Array.isArray(o.battingOrder)
  )) return true;

  if (teamAbbrFromObj(o) && (o.pitcher || o.startingPitcher)) return true;

  return false;
}

function walk(v, cb, ctx = {}, seen = new Set()) {
  if (!v || typeof v !== "object") return;
  if (seen.has(v)) return;
  seen.add(v);

  let next = { ...ctx };

  if (isTeamLike(v)) {
    next.team = teamAbbrFromObj(v) || ctx.team || "";
    next.teamName = teamNameFromObj(v) || ctx.teamName || "";
    if (v.isHome === true) next.side = "home";
    if (v.isHome === false) next.side = "away";
  }

  if (isPlayerLike(v)) cb(v, next);

  if (Array.isArray(v)) {
    for (const x of v) walk(x, cb, next, seen);
  } else {
    for (const x of Object.values(v)) {
      if (x && typeof x === "object") walk(x, cb, next, seen);
    }
  }
}

const raw = readJson(IN, null);
if (!raw) {
  console.error(`Missing or unreadable ${IN}`);
  process.exit(1);
}

const calls = Array.isArray(raw.lineups) ? raw.lineups : Array.isArray(raw) ? raw : [];
const fixtures = Array.isArray(raw.fixtures) ? raw.fixtures : [];

const fixtureById = new Map();
for (const f of fixtures) {
  const id = s(f.fixtureId || f.id || f.matchId);
  if (id) fixtureById.set(id, f);
}

const players = {};
const teams = {};
const games = {};
const rows = [];
const seenRows = new Set();

for (const call of calls) {
  const fixture = call.fixture || fixtureById.get(s(call.fixtureId || call.matchId)) || {};
  const matchId = s(fixture.fixtureId || fixture.id || fixture.matchId || call.fixtureId || call.matchId);
  const matchDate = dateFromMatchId(matchId);
  const away = s(fixture.awayAbbr || fixture.awayTeamAbbr || fixture.away || fixture.awayTeam);
  const home = s(fixture.homeAbbr || fixture.homeTeamAbbr || fixture.home || fixture.homeTeam);
  const game = away && home ? `${away} @ ${home}` : s(fixture.game || fixture.matchup || "");

  const root = call.data || call.json || call.body || call.response || call.result || call;

  walk(root, (o, ctx) => {
    const player = getName(o);
    const battingOrder = getSpot(o);
    const status = getStatus(o);
    const position = s(o.position || o.pos || o.player_position);
    const hand = s(o.hand || o.bats || o.battingHand || o.batting_hand);
    const mlbId = s(o.mlbId || o.mlb_id || o.player_mlb_id || o.player_id);
    const team = s(ctx.team || teamAbbrFromObj(o));
    const teamName = s(ctx.teamName || teamNameFromObj(o));

    if (!player || battingOrder === null || !team) return;

    const key = `${norm(player)}|${team}|${matchId}|${battingOrder}`;
    if (seenRows.has(key)) return;
    seenRows.add(key);

    const row = {
      player,
      norm: norm(player),
      team,
      teamName,
      game,
      matchId,
      date: matchDate,
      status,
      battingOrder,
      position,
      hand,
      mlbId,
      source: "pickfinder",
      capturedAt: raw.generatedAt || call.capturedAt || new Date().toISOString()
    };

    rows.push(row);

    players[row.norm] = row;

    teams[team] ||= {
      team,
      teamName,
      status: "unknown",
      confirmedBatters: 0,
      game,
      matchId,
      players: []
    };

    teams[team].players.push(row);
    if (status === "confirmed") {
      teams[team].confirmedBatters += 1;
      teams[team].status = "confirmed";
    }

    games[matchId] ||= {
      matchId,
      date: matchDate,
      game,
      away,
      home,
      teams: {}
    };

    games[matchId].teams[team] ||= [];
    games[matchId].teams[team].push(row);
  });
}

for (const t of Object.values(teams)) {
  t.players.sort((a, b) => a.battingOrder - b.battingOrder);
}
for (const g of Object.values(games)) {
  for (const [team, list] of Object.entries(g.teams)) {
    g.teams[team] = list.sort((a, b) => a.battingOrder - b.battingOrder);
  }
}

const byDate = {};
const byTeam = {};
const byStatus = {};
for (const r of rows) {
  byDate[r.date || "UNKNOWN_DATE"] = (byDate[r.date || "UNKNOWN_DATE"] || 0) + 1;
  byTeam[r.team || "UNKNOWN"] = (byTeam[r.team || "UNKNOWN"] || 0) + 1;
  byStatus[r.status || "UNKNOWN"] = (byStatus[r.status || "UNKNOWN"] || 0) + 1;
}

const slateCompact = compactDate(SLATE_DATE);
const currentRows = rows.filter(r => {
  const d = compactDate(r.date);
  // Include next UTC day too because late MLB slate games can be encoded as next UTC date.
  return d === slateCompact || d === String(Number(slateCompact) + 1);
});

const out = {
  generatedAt: new Date().toISOString(),
  slateDate: SLATE_DATE,
  source: IN,
  recordType: "pickfinder_current_lineups_v1",
  inputGeneratedAt: raw.generatedAt || null,
  lineupCalls: calls.length,
  totalRows: rows.length,
  currentRows: currentRows.length,
  byDate,
  byTeam,
  byStatus,
  players,
  teams,
  games,
  rows
};

writeJson(OUT, out);
writeJson(OUT2, out);

const lines = [];
lines.push("PICKFINDER CURRENT LINEUPS");
lines.push("==========================");
lines.push(`generatedAt=${out.generatedAt}`);
lines.push(`slateDate=${out.slateDate}`);
lines.push(`source=${IN}`);
lines.push(`inputGeneratedAt=${out.inputGeneratedAt || "?"}`);
lines.push(`lineupCalls=${out.lineupCalls}`);
lines.push(`totalRows=${out.totalRows}`);
lines.push(`currentRows=${out.currentRows}`);
lines.push("");
lines.push("BY DATE");
lines.push("-------");
for (const [k, v] of Object.entries(byDate).sort()) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("BY STATUS");
lines.push("---------");
for (const [k, v] of Object.entries(byStatus).sort((a,b)=>b[1]-a[1])) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("BY TEAM");
lines.push("-------");
for (const [k, v] of Object.entries(byTeam).sort((a,b)=>b[1]-a[1])) lines.push(`${k}: ${v}`);
lines.push("");
lines.push("SAMPLE CURRENT ROWS");
lines.push("-------------------");
for (const r of currentRows.slice(0, 80)) {
  lines.push(`${r.player} | ${r.team} | ${r.game} | spot=${r.battingOrder} | pos=${r.position || "?"} | status=${r.status} | date=${r.date} | match=${r.matchId}`);
}
writeText(TXT, lines.join("\n") + "\n");

console.log({
  slateDate: SLATE_DATE,
  lineupCalls: out.lineupCalls,
  totalRows: out.totalRows,
  currentRows: out.currentRows,
  byDate,
  byStatus,
  out: OUT
});
