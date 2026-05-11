const fs = require("fs");

const OUT = "data/context/game-odds-context.json";

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

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function avg(xs) {
  const ys = xs.map(Number).filter(Number.isFinite);
  return ys.length ? Number((ys.reduce((a,b)=>a+b,0) / ys.length).toFixed(3)) : null;
}

function collectRows(x) {
  if (Array.isArray(x)) return x;
  if (!x || typeof x !== "object") return [];
  let out = [];
  for (const v of Object.values(x)) {
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === "object") out.push(v);
  }
  return out;
}

const candidates = [
  "outputs/odds-api-props.json",
  "outputs/odds-snapshot.json",
  "outputs/oddsapi-dk-mlb-props.json",
  "outputs/converted-oddsapi-props.json",
  "outputs/priced-board.json"
];

const rows = [];
for (const p of candidates) {
  const x = read(p);
  if (!x) continue;
  for (const r of collectRows(x)) rows.push({ ...r, _source: p });
}

const games = {};
const teams = {};

for (const r of rows) {
  const away = String(r.awayTeam || r.away || "").toUpperCase();
  const home = String(r.homeTeam || r.home || "").toUpperCase();
  const game = r.game || r.gameKey || (away && home ? `${away}@${home}` : null);
  const team = String(r.team || r.playerTeam || "").toUpperCase();

  const moneyline = n(r.moneyline ?? r.ml ?? r.consensusMoneyline);
  const total = n(r.total ?? r.gameTotal ?? r.consensusTotal ?? r.overUnder);

  if (game) {
    games[game] ||= { game, moneylines: [], totals: [], sources: new Set() };
    if (moneyline != null) games[game].moneylines.push(moneyline);
    if (total != null) games[game].totals.push(total);
    games[game].sources.add(r._source);
  }

  if (team) {
    teams[team] ||= { team, moneylines: [], totals: [], sources: new Set() };
    if (moneyline != null) teams[team].moneylines.push(moneyline);
    if (total != null) teams[team].totals.push(total);
    teams[team].sources.add(r._source);
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  sources: candidates,
  games: Object.fromEntries(Object.entries(games).map(([k,v]) => [k, {
    game: k,
    moneyline: avg(v.moneylines),
    total: avg(v.totals),
    sourceCount: v.sources.size,
    sources: [...v.sources]
  }])),
  teams: Object.fromEntries(Object.entries(teams).map(([k,v]) => [k, {
    team: k,
    moneyline: avg(v.moneylines),
    total: avg(v.totals),
    sourceCount: v.sources.size,
    sources: [...v.sources]
  }]))
};

write(OUT, out);
console.log("GAME ODDS CONTEXT");
console.log("=================");
console.log("Games:", Object.keys(out.games).length);
console.log("Teams:", Object.keys(out.teams).length);
console.log("Wrote", OUT);
console.table(Object.values(out.teams).slice(0, 12));
