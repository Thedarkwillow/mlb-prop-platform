const fs = require("fs");

const BOARD_FILE = process.env.BOARD_FILE || "outputs/priced-board.json";
const OUT_FILE = process.env.OUT_FILE || "outputs/pitcher-projection-upstream-repair.json";
const FORM_FILE = "data/context/player-game-log-form.json";

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return fallback; }
}

function flatten(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    for (const x of v) flatten(x, out);
    return out;
  }
  if (typeof v !== "object") return out;
  if (v.player || v.playerName || v.market || v.statType || v.line) out.push(v);
  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flatten(x, out);
  }
  return out;
}

function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normMarket(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const formRows = readJson(FORM_FILE, []);
const formByPlayer = new Map();

if (Array.isArray(formRows)) {
  for (const f of formRows) {
    const k = normName(f.key || f.player);
    if (k) formByPlayer.set(k, f);
  }
}

function playerOf(row) {
  return String(row.player || row.playerName || row.name || "").trim();
}

function marketOf(row) {
  return normMarket(row.market || row.statType || row.projectionType || "");
}

function getNum(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasProjection(row) {
  return getNum(row, [
    "projection",
    "modelProjection",
    "proj",
    "mean",
    "rawProjection",
    "contextAdjustedProjection"
  ]) !== null;
}

function hasPitcherForm(row) {
  const f = formByPlayer.get(normName(playerOf(row)));
  if (!f) return false;
  const p = f.pitcher || {};
  return (
    Number(p.season?.games || 0) > 0 ||
    Number(p.last5?.games || 0) > 0 ||
    Number(p.last10?.games || 0) > 0 ||
    Number(p.last15?.games || 0) > 0
  );
}

function isPitcherMarket(market, row) {
  const player = playerOf(row);
  if (!player || player.includes("+")) return false;

  const m = normMarket(market);
  const sourceType = String(row.sourceType || row.playerType || "").toLowerCase();
  const statText = String(row.stat || row.market || row.projectionType || "").toLowerCase();

  if (/hitter/.test(sourceType) || /hitter/.test(statText)) return false;

  if (m === "strikeouts") {
    return (
      /pitcher/.test(sourceType) ||
      /pitcher/.test(statText) ||
      row.pitcherLast5StrikeoutsPerGame != null ||
      row.pitcherSeasonStrikeoutsPerGame != null ||
      hasPitcherForm(row)
    );
  }

  return /pitching_outs|pitcher_strikeouts|hits_allowed|earned_runs_allowed|walks_allowed|runs_allowed/.test(m);
}

const board = readJson(BOARD_FILE, []);
const rows = flatten(board);

const missing = [];

for (const row of rows) {
  const player = playerOf(row);
  const market = marketOf(row);
  if (!player || !market) continue;
  if (!isPitcherMarket(market, row)) continue;
  if (hasProjection(row)) continue;

  missing.push({
    player,
    team: row.team || row.playerTeam || "",
    market: row.market || row.statType || market,
    line: getNum(row, ["line", "propLine", "ppLine"]),
    pricingStatus: row.pricingStatus || "",
    unpricedReason: row.unpricedReason || "",
    reason: "NO_SOURCE_COMPONENTS_AVAILABLE_UPSTREAM"
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  boardFile: BOARD_FILE,
  formFile: FORM_FILE,
  pitcherRowsWithoutProjection: missing.length,
  repairableCount: 0,
  stillMissingCount: missing.length,
  repaired: [],
  missing,
  note: "Audit excludes hitter strikeouts and combo props. Current pricing engine now reads player-game-log-form directly."
};

fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

console.log("=== Upstream Pitcher Projection Repair Audit ===");
console.log("Pitcher rows missing projection:", report.pitcherRowsWithoutProjection);
console.log("Repairable from source components:", report.repairableCount);
console.log("Still missing source components:", report.stillMissingCount);
console.log("Saved:", OUT_FILE);

if (missing.length) {
  console.log("Top still-missing examples:");
  for (const r of missing.slice(0, 20)) {
    console.log(`${r.player} | ${r.market} ${r.line ?? ""} | ${r.reason}`);
  }
}
