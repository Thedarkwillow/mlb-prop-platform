const fs = require("fs");

const OUT = "data/context/lineup-depth.json";

function read(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function keyName(v) {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function n(v, fallback = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function values(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") return Object.values(x);
  return [];
}

const lineups = read("data/context/lineups.json", {});
const handedness = read("data/savant/handedness-splits.json", {});
const board = read("outputs/priced-board.json", []);

const players = values(lineups.players || lineups.lineups || {});
const teams = {};

function handedRows() {
  const out = [];
  for (const v of Object.values(handedness || {})) {
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === "object") out.push(...Object.values(v).filter(x => x && typeof x === "object"));
  }
  return out;
}

const handByName = new Map();
for (const r of handedRows()) {
  const k = keyName(r.player || r.name);
  if (!k) continue;
  const existing = handByName.get(k) || {};
  handByName.set(k, { ...existing, ...r });
}

function boardRowsForTeam(team) {
  return board.filter(r => String(r.team || r.playerTeam || "").toUpperCase() === team);
}

function inferFromBoard() {
  for (const r of board) {
    const team = String(r.team || r.playerTeam || "").toUpperCase();
    const name = r.player || r.playerName || r.name;
    if (!team || !name) continue;

    teams[team] ||= { team, lineupStatus: "inferred_from_board", starters: [] };

    if (!teams[team].starters.some(x => keyName(x.name) === keyName(name))) {
      const split = handByName.get(keyName(name)) || {};
      teams[team].starters.push({
        name,
        id: r.playerId || r.mlbId || null,
        battingHand: r.battingHand || r.hand || split.battingHand || split.bats || null,
        avgVsPitcherHand: n(split.avgVsPitcherHand ?? split.avg ?? split.battingAvg),
        opsVsPitcherHand: n(split.opsVsPitcherHand ?? split.ops),
        pmr: n(split.pmr ?? split.pmrLite),
        pitchTypeRunValues: split.pitchTypeRunValues || split.runValues || null
      });
    }
  }
}

for (const p of players) {
  const team = String(p.team || p.playerTeam || "").toUpperCase();
  if (!team) continue;
  teams[team] ||= { team, lineupStatus: "loaded", starters: [] };

  const split = handByName.get(keyName(p.name || p.player)) || {};
  teams[team].starters.push({
    name: p.name || p.player,
    id: p.id || p.playerId || null,
    battingOrder: p.battingOrder || p.order || null,
    battingHand: p.battingHand || p.hand || p.bats || split.battingHand || split.bats || null,
    avgVsPitcherHand: n(p.avgVsPitcherHand ?? split.avgVsPitcherHand ?? split.avg ?? split.battingAvg),
    opsVsPitcherHand: n(p.opsVsPitcherHand ?? split.opsVsPitcherHand ?? split.ops),
    pmr: n(p.pmr ?? p.pmrLite ?? split.pmr ?? split.pmrLite),
    pitchTypeRunValues: p.pitchTypeRunValues || split.pitchTypeRunValues || split.runValues || null
  });
}

if (!Object.keys(teams).length) inferFromBoard();

for (const team of Object.keys(teams)) {
  const starters = teams[team].starters;
  const counts = { L: 0, R: 0, S: 0, unknown: 0, total: starters.length, known: 0 };

  for (const p of starters) {
    const h = String(p.battingHand || "").toUpperCase();
    if (["L", "R", "S"].includes(h)) {
      counts[h]++;
      counts.known++;
    } else {
      counts.unknown++;
    }
  }

  teams[team].lineupHandCounts = counts;
  teams[team].battingSplitsAvailable = starters.filter(p => p.avgVsPitcherHand != null || p.opsVsPitcherHand != null).length;
  teams[team].pmrAvailable = starters.filter(p => p.pmr != null).length;
}

const out = {
  generatedAt: new Date().toISOString(),
  source: Object.keys(lineups.players || {}).length ? "data/context/lineups.json" : "outputs/priced-board.json inferred",
  teams
};

write(OUT, out);

console.log("LINEUP DEPTH");
console.log("============");
console.log("Teams:", Object.keys(teams).length);
console.log("Wrote", OUT);
console.table(Object.values(teams).slice(0, 12).map(t => ({
  team: t.team,
  status: t.lineupStatus,
  starters: t.starters.length,
  L: t.lineupHandCounts.L,
  R: t.lineupHandCounts.R,
  S: t.lineupHandCounts.S,
  splits: t.battingSplitsAvailable,
  pmr: t.pmrAvailable
})));
