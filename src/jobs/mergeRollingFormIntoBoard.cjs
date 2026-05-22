const fs = require("fs");

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const boardPath = "outputs/priced-board.json";
const formPath = "data/context/rolling-form.json";

const board = readJson(boardPath, []);
const form = readJson(formPath, []);

const byPlayer = new Map();
for (const r of form) byPlayer.set(norm(r.player), r);

let matched = 0;

const out = board.map(row => {
  const player = row.player || row.playerName || row.name;
  const f = byPlayer.get(norm(player));

  if (!f) {
    return {
      ...row,
      rollingFormReady: false,
      rollingFormTrend: "UNKNOWN"
    };
  }

  matched++;

  return {
    ...row,
    rollingFormReady: true,
    rollingFormTrend: f.trend,
    rolling7Sample: f.rolling7?.sample ?? 0,
    rolling7HitRate: f.rolling7?.hitRate ?? null,
    rolling15Sample: f.rolling15?.sample ?? 0,
    rolling15HitRate: f.rolling15?.hitRate ?? null,
    rolling30Sample: f.rolling30?.sample ?? 0,
    rolling30HitRate: f.rolling30?.hitRate ?? null
  };
});

fs.writeFileSync(boardPath, JSON.stringify(out, null, 2));

console.log("ROLLING FORM MERGE REPORT");
console.log("=========================");
console.log({
  boardRows: board.length,
  formPlayers: form.length,
  matchedRows: matched,
  matchRate: board.length ? Number((matched / board.length).toFixed(4)) : 0
});
