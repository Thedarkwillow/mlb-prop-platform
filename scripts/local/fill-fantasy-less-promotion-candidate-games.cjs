const fs = require("fs");
const path = require("path");

function argDate() {
  const eq = process.argv.find(x => x.startsWith("--date="));
  if (eq) return eq.split("=")[1];
  const plain = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return plain || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const FILE = "outputs/fantasy-less-promotion-candidates.json";
const TXT = "outputs/fantasy-less-promotion-candidates.txt";
const HIST_OUT = `outputs/history/${DATE}-fantasy-less-promotion-candidates.json`;
const HIST_TXT = `outputs/history/${DATE}-fantasy-less-promotion-candidates.txt`;

const SOURCES = [
  `outputs/history/${DATE}-full-board-graded.json`,
  `outputs/fantasy-less-history-graded-${DATE}-to-${DATE}.json`,
  `outputs/history/${DATE}-fantasy-less-watchlist.json`,
  "outputs/priced-board.json"
];

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
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function cleanGame(v) {
  const x = s(v);
  if (!x) return "";
  if (x === "UNKNOWN_GAME") return "";
  if (/^null\s*@\s*null$/i.test(x)) return "";
  if (/undefined/i.test(x)) return "";
  if (!x.includes("@")) return "";
  return x;
}

function player(r) {
  return s(r?.player || r?.playerName || r?.name || r?.athleteName);
}

function team(r) {
  return s(r?.team || r?.teamAbbr || r?.abbr || r?.playerTeam);
}

function game(r) {
  return cleanGame(r?.game || r?.gameText || r?.matchup || r?.event);
}

function line(r) {
  return n(r?.line ?? r?.statValue ?? r?.value ?? r?.projectionLine);
}

function market(r) {
  return s(r?.market || r?.statType || r?.projectionType || r?.stat)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function side(r) {
  return s(r?.side || r?.pick || r?.direction || r?.selection).toUpperCase();
}

function flat(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flat(x, out);
    return out;
  }
  if (typeof v !== "object") return out;

  if (
    player(v) ||
    team(v) ||
    market(v) ||
    game(v) ||
    v.result != null ||
    v.actual != null ||
    v.actualValue != null
  ) {
    out.push(v);
  }

  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flat(x, out);
  }
  return out;
}

function addToMap(map, key, value) {
  if (!key || !value) return;
  if (!map.has(key)) map.set(key, new Map());
  map.get(key).set(value, (map.get(key).get(value) || 0) + 1);
}

function bestFromCountMap(m) {
  if (!m || !m.size) return "";
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return rows[0]?.[0] || "";
}

function buildIndexes() {
  const byPlayer = new Map();
  const byPlayerTeam = new Map();
  const byPlayerMarketLine = new Map();

  const counts = [];

  for (const file of SOURCES) {
    const data = readJson(file);
    const rows = flat(data);
    let used = 0;

    for (const r of rows) {
      const p = norm(player(r));
      const t = norm(team(r));
      const g = game(r);
      const m = market(r);
      const l = line(r);

      if (!p || !g) continue;

      addToMap(byPlayer, p, g);
      used++;

      if (t) addToMap(byPlayerTeam, `${p}|${t}`, g);
      if (m && l !== null) addToMap(byPlayerMarketLine, `${p}|${m}|${l}`, g);
    }

    counts.push({ file, rows: rows.length, used });
  }

  return { byPlayer, byPlayerTeam, byPlayerMarketLine, counts };
}

function chooseGame(row, idx) {
  const p = norm(player(row));
  const t = norm(team(row));
  const m = market(row);
  const l = line(row);

  if (!p) return { game: "", method: "missing_player" };

  if (p && m && l !== null) {
    const g = bestFromCountMap(idx.byPlayerMarketLine.get(`${p}|${m}|${l}`));
    if (g) return { game: g, method: "player_market_line" };
  }

  if (p && t) {
    const g = bestFromCountMap(idx.byPlayerTeam.get(`${p}|${t}`));
    if (g) return { game: g, method: "player_team" };
  }

  const g = bestFromCountMap(idx.byPlayer.get(p));
  if (g) return { game: g, method: "player_only" };

  return { game: "", method: "no_match" };
}

const data = readJson(FILE);
if (!data || typeof data !== "object") {
  console.error(`Missing or invalid ${FILE}`);
  process.exit(1);
}

const idx = buildIndexes();

const eligibleRows = Array.isArray(data.eligibleRows)
  ? data.eligibleRows
  : Array.isArray(data.eligible)
    ? data.eligible
    : [];

let beforeUnknown = 0;
let filled = 0;
let stillUnknown = 0;
const examples = [];
const still = [];

for (const row of eligibleRows) {
  if (game(row)) continue;

  beforeUnknown++;
  const found = chooseGame(row, idx);

  if (found.game) {
    row.game = found.game;
    row.gameFillMethod = found.method;
    filled++;
    if (examples.length < 25) {
      examples.push({
        player: player(row),
        team: team(row),
        market: market(row),
        side: side(row),
        line: line(row),
        game: found.game,
        method: found.method
      });
    }
  } else {
    row.game = "UNKNOWN_GAME";
    row.gameFillMethod = found.method;
    stillUnknown++;
    if (still.length < 25) {
      still.push({
        player: player(row),
        team: team(row),
        market: market(row),
        side: side(row),
        line: line(row),
        reason: found.method
      });
    }
  }
}

data.eligibleRows = eligibleRows;
data.eligible = Array.isArray(data.eligible) ? data.eligible : eligibleRows.length;
data.eligibleCount = eligibleRows.length;
data.gameFill = {
  generatedAt: new Date().toISOString(),
  date: DATE,
  beforeUnknown,
  filled,
  stillUnknown,
  sourceCounts: idx.counts,
  examples,
  still
};

const lines = [];
lines.push("FANTASY LESS PROMOTION GAME FILL");
lines.push("================================");
lines.push(`generatedAt=${data.gameFill.generatedAt}`);
lines.push(`date=${DATE}`);
lines.push(`eligibleRows=${eligibleRows.length}`);
lines.push(`beforeUnknown=${beforeUnknown}`);
lines.push(`filled=${filled}`);
lines.push(`stillUnknown=${stillUnknown}`);
lines.push("");
lines.push("SOURCES");
lines.push("-------");
for (const c of idx.counts) {
  lines.push(`${c.file}: rows=${c.rows} used=${c.used}`);
}
lines.push("");
lines.push("FILLED SAMPLE");
lines.push("-------------");
for (const e of examples) {
  lines.push(`${e.player} | ${e.team || "?"} | ${e.market} ${e.side} ${e.line} | ${e.game} | ${e.method}`);
}
lines.push("");
lines.push("STILL UNKNOWN SAMPLE");
lines.push("--------------------");
for (const e of still) {
  lines.push(`${e.player} | ${e.team || "?"} | ${e.market} ${e.side} ${e.line} | ${e.reason}`);
}

writeJson(FILE, data);
writeJson(HIST_OUT, data);
writeText(TXT, lines.join("\n") + "\n");
writeText(HIST_TXT, lines.join("\n") + "\n");

console.log({
  date: DATE,
  eligibleRows: eligibleRows.length,
  beforeUnknown,
  filled,
  stillUnknown,
  sources: idx.counts
});
console.log(`saved: ${FILE}`);
console.log(`saved: ${TXT}`);
