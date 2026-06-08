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

function uniqGame(set) {
  if (!set || set.size !== 1) return "";
  return Array.from(set)[0] || "";
}

function flatten(v, out = [], path = "") {
  if (!v) return out;

  if (Array.isArray(v)) {
    v.forEach((x, i) => flatten(x, out, `${path}[${i}]`));
    return out;
  }

  if (typeof v !== "object") return out;

  const hasPlayer = !!(v.player || v.playerName || v.athleteName);
  const hasMarket = !!(v.market || v.statType || v.projectionType || v.stat);
  const hasLine = v.line !== undefined || v.statValue !== undefined || v.value !== undefined;

  if (hasPlayer && (hasMarket || hasLine)) {
    out.push({ row: v, path });
  }

  for (const [k, val] of Object.entries(v)) {
    if (["canonical", "original"].includes(k)) continue;
    if (val && typeof val === "object") {
      flatten(val, out, path ? `${path}.${k}` : k);
    }
  }

  return out;
}

function buildGameIndex(board) {
  const byPlayerTeam = new Map();
  const byPlayer = new Map();
  const byTeam = new Map();

  for (const { row } of flatten(board)) {
    const player = s(row.player || row.playerName || row.name || row.athleteName);
    const team = s(row.team || row.teamAbbrev || row.teamCode);
    const game = s(row.game || row.matchup || row.gameLabel || row.eventName);

    if (!player || !game || game === "UNKNOWN_GAME") continue;

    const pk = norm(player);
    if (!byPlayer.has(pk)) byPlayer.set(pk, new Set());
    byPlayer.get(pk).add(game);

    if (team) {
      const tk = `${pk}|${norm(team)}`;
      if (!byPlayerTeam.has(tk)) byPlayerTeam.set(tk, new Set());
      byPlayerTeam.get(tk).add(game);

      const teamKey = norm(team);
      if (!byTeam.has(teamKey)) byTeam.set(teamKey, new Set());
      byTeam.get(teamKey).add(game);
    }
  }

  function collapse(map) {
    const out = new Map();
    for (const [k, set] of map.entries()) {
      const g = uniqGame(set);
      if (g) out.set(k, g);
    }
    return out;
  }

  return {
    byPlayerTeam: collapse(byPlayerTeam),
    byPlayer: collapse(byPlayer),
    byTeam: collapse(byTeam)
  };
}

function applyGameFill(data, source, index) {
  const stats = {
    file: source,
    exists: true,
    rows: 0,
    filled: 0,
    filledUnknown: 0,
    unfilled: 0,
    examples: [],
    unfilledExamples: []
  };

  for (const { row, path } of flatten(data)) {
    stats.rows++;

    const player = s(row.player || row.playerName || row.name || row.athleteName);
    const team = s(row.team || row.teamAbbrev || row.teamCode);
    const currentGame = s(row.game || row.matchup || row.gameLabel || row.eventName);

    if (currentGame && currentGame !== "UNKNOWN_GAME") continue;

    const keyPlayer = norm(player);
    const keyTeam = `${keyPlayer}|${norm(team)}`;

    const found =
      index.byPlayerTeam.get(keyTeam) ||
      index.byPlayer.get(keyPlayer) ||
      index.byTeam.get(norm(team)) ||
      "";

    const targetGame = found || "UNKNOWN_GAME";

    row.game = targetGame;
    if (row.canonical && typeof row.canonical === "object") {
      row.canonical.game = targetGame;
    }

    if (found) {
      stats.filled++;
      if (stats.examples.length < 20) {
        stats.examples.push({ player, team, game: found, path });
      }
    } else {
      stats.filledUnknown++;
      stats.unfilled++;
      if (row.canonical && typeof row.canonical === "object") {
        row.canonical.riskStatus = "MISSING_GAME_CONTEXT_REVIEW";
        const rc = Array.isArray(row.canonical.reasonCodes) ? row.canonical.reasonCodes : [];
        for (const code of ["game_unknown_after_priced_board_lookup", "risk:MISSING_GAME_CONTEXT_REVIEW"]) {
          if (!rc.includes(code)) rc.push(code);
        }
        row.canonical.reasonCodes = rc;
      }
      if (stats.unfilledExamples.length < 20) {
        stats.unfilledExamples.push({ player, team, game: targetGame, path });
      }
    }
  }

  return stats;
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
  if (!data) {
    report.files.push({ file, exists: false, rows: 0, filled: 0, filledUnknown: 0, unfilled: 0 });
    continue;
  }

  const stats = applyGameFill(data, file, index);
  writeJson(file, data);
  report.files.push(stats);
}

writeJson(OUT, report);

const lines = [];
lines.push("DERIVED CANONICAL GAME FILL REPORT");
lines.push("===================================");
lines.push(`generatedAt=${report.generatedAt}`);
for (const f of report.files) {
  lines.push(`${f.file}: exists=${f.exists} rows=${f.rows} filled=${f.filled} filledUnknown=${f.filledUnknown || 0} unfilled=${f.unfilled}`);
}
lines.push("EXAMPLES");
lines.push("--------");
for (const f of report.files) {
  for (const ex of f.examples || []) {
    lines.push(`${ex.player} | ${ex.team} | ${ex.game} | ${ex.path}`);
  }
}
lines.push("UNKNOWN GAME FALLBACKS");
lines.push("----------------------");
for (const f of report.files) {
  for (const ex of f.unfilledExamples || []) {
    lines.push(`${ex.player} | ${ex.team} | ${ex.game} | ${ex.path}`);
  }
}
fs.writeFileSync(TXT, lines.join("\n") + "\n");

console.log(report);
console.log(`saved: ${OUT}`);
console.log(`saved: ${TXT}`);
