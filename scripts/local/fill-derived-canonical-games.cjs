const fs = require("fs");

const BOARD = "outputs/priced-board.json";
const FILES = [
  "outputs/goblin-recommended-card.json",
  "outputs/manual/auto-reverse-hitter-signal.json"
];

const OUT = "outputs/derived-canonical-game-fill-report.json";
const TXT = "outputs/derived-canonical-game-fill-report.txt";

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
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

function teamOf(row) {
  return s(row.team || row.teamAbbr || row.teamCode);
}

function playerOf(row) {
  return s(row.player || row.playerName || row.name || row.athleteName);
}

function gameOf(row) {
  return s(row.game || row.gameInfo || row.matchup || row.eventName);
}

function buildGameIndex(board) {
  const byPlayerTeam = new Map();
  const byPlayer = new Map();

  function visit(v) {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (typeof v !== "object") return;

    const player = playerOf(v);
    const team = teamOf(v);
    const game = gameOf(v);

    if (player && game) {
      const pk = norm(player);
      if (!byPlayer.has(pk)) byPlayer.set(pk, new Set());
      byPlayer.get(pk).add(game);

      if (team) {
        const tk = `${pk}|${norm(team)}`;
        if (!byPlayerTeam.has(tk)) byPlayerTeam.set(tk, new Set());
        byPlayerTeam.get(tk).add(game);
      }
    }

    for (const val of Object.values(v)) {
      if (val && typeof val === "object") visit(val);
    }
  }

  visit(board);

  function collapse(map) {
    const out = new Map();
    for (const [k, set] of map.entries()) {
      const vals = [...set].filter(Boolean);
      if (vals.length === 1) out.set(k, vals[0]);
    }
    return out;
  }

  return {
    byPlayerTeam: collapse(byPlayerTeam),
    byPlayer: collapse(byPlayer)
  };
}

function isPropLike(v) {
  return v && typeof v === "object" &&
    (v.player || v.playerName || v.name || v.athleteName) &&
    (v.market || v.statType || v.projectionType || v.stat || v.side || v.pick || v.direction || v.line !== undefined);
}

function fillGames(v, source, index, stats, path = "") {
  if (!v) return;
  if (Array.isArray(v)) {
    v.forEach((x, i) => fillGames(x, source, index, stats, `${path}[${i}]`));
    return;
  }
  if (typeof v !== "object") return;

  if (isPropLike(v)) {
    stats.rows++;

    const currentGame = gameOf(v);
    const player = playerOf(v);
    const team = teamOf(v);

    if (!currentGame && player) {
      const keyTeam = `${norm(player)}|${norm(team)}`;
      const keyPlayer = norm(player);
      const found = index.byPlayerTeam.get(keyTeam) || index.byPlayer.get(keyPlayer) || "";

      if (found) {
        v.game = found;
        stats.filled++;
        stats.examples.push({ source, path, player, team, game: found });

        if (v.canonical && typeof v.canonical === "object") {
          v.canonical.game = found;
          const rc = Array.isArray(v.canonical.reasonCodes) ? v.canonical.reasonCodes : [];
          if (!rc.includes("game_filled_from_priced_board")) rc.push("game_filled_from_priced_board");
          v.canonical.reasonCodes = rc;
        }
      } else {
        stats.unfilled++;
        stats.unfilledExamples.push({ source, path, player, team });
      }
    }
  }

  for (const [key, val] of Object.entries(v)) {
    if (key === "canonical") continue;
    if (val && typeof val === "object") fillGames(val, source, index, stats, path ? `${path}.${key}` : key);
  }
}

const board = readJson(BOARD, []);
const index = buildGameIndex(board);

const report = {
  generatedAt: new Date().toISOString(),
  board: BOARD,
  files: []
};

for (const file of FILES) {
  const data = readJson(file, null);
  const stats = {
    file,
    exists: !!data,
    rows: 0,
    filled: 0,
    unfilled: 0,
    examples: [],
    unfilledExamples: []
  };

  if (data) {
    fillGames(data, file, index, stats);
    stats.examples = stats.examples.slice(0, 20);
    stats.unfilledExamples = stats.unfilledExamples.slice(0, 20);
    writeJson(file, data);
  }

  report.files.push(stats);
}

writeJson(OUT, report);

const lines = [];
lines.push("DERIVED CANONICAL GAME FILL REPORT");
lines.push("===================================");
lines.push(`generatedAt=${report.generatedAt}`);
for (const f of report.files) {
  lines.push(`${f.file}: exists=${f.exists} rows=${f.rows} filled=${f.filled} unfilled=${f.unfilled}`);
}
lines.push("");
lines.push("EXAMPLES");
lines.push("--------");
for (const f of report.files) {
  for (const e of f.examples.slice(0, 10)) {
    lines.push(`${e.player} | ${e.team} | ${e.game} | ${e.path}`);
  }
}
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(report);
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
