const fs = require("fs");

const BOARD_FILE = process.env.BOARD_FILE || "outputs/priced-board.json";
const OUT_FILE = process.env.OUT_FILE || "outputs/pitcher-projection-upstream-repair.json";

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
  const hasRow = v.player || v.playerName || v.market || v.statType || v.line;
  if (hasRow) out.push(v);
  for (const x of Object.values(v)) {
    if (x && typeof x === "object") flatten(x, out);
  }
  return out;
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function playerOf(x) {
  return String(x.player || x.playerName || x.name || x.fullName || "").trim();
}

function marketOf(x) {
  return norm(x.market || x.statType || x.projectionType || "");
}

function getNum(x, keys) {
  for (const k of keys) {
    const v = x[k];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isPitcherMarket(m) {
  return /pitching|strikeout|earned_runs|walks_allowed|hits_allowed|outs|ks|k$/.test(m);
}

function hasProjection(row) {
  return getNum(row, ["projection", "modelProjection", "proj", "mean"]) !== null;
}

// Conservative upstream-style projection repair.
// It only creates repair recommendations when source component fields already exist.
// It does NOT fake projections from the betting line.
function deriveProjection(row) {
  const m = marketOf(row);

  const bp = getNum(row, [
    "ballparkpalProjection",
    "bppProjection",
    "bpProjection",
    "ballparkProjection"
  ]);

  const fg = getNum(row, [
    "fangraphsProjection",
    "fgProjection",
    "thebatProjection",
    "steamerProjection",
    "zipsProjection"
  ]);

  const sav = getNum(row, [
    "savantProjection",
    "savantMean",
    "rollingProjection",
    "handednessProjection"
  ]);

  const modelInput = [bp, fg, sav].filter(Number.isFinite);

  if (modelInput.length) {
    const weights = [];
    if (bp !== null) weights.push([bp, 0.45]);
    if (fg !== null) weights.push([fg, 0.35]);
    if (sav !== null) weights.push([sav, 0.20]);

    const totalW = weights.reduce((a, [, w]) => a + w, 0);
    const projection = weights.reduce((a, [v, w]) => a + v * w, 0) / totalW;

    return {
      projection: Number(projection.toFixed(3)),
      method: "weighted_source_projection",
      sources: {
        ballparkpalProjection: bp,
        fangraphsProjection: fg,
        savantProjection: sav
      }
    };
  }

  // Market-specific component fallback when source fields are present.
  if (/strikeout|ks|k$/.test(m)) {
    const kRate = getNum(row, ["kRate", "KRate", "kPct", "strikeoutRate"]);
    const battersFaced = getNum(row, ["projectedBattersFaced", "battersFaced", "bfProjection"]);
    if (kRate !== null && battersFaced !== null) {
      const kPct = kRate > 1 ? kRate / 100 : kRate;
      return {
        projection: Number((kPct * battersFaced).toFixed(3)),
        method: "k_rate_x_projected_batters_faced",
        sources: { kRate, battersFaced }
      };
    }
  }

  if (/outs/.test(m)) {
    const innings = getNum(row, ["projectedInnings", "inningsProjection", "ipProjection"]);
    if (innings !== null) {
      return {
        projection: Number((innings * 3).toFixed(3)),
        method: "projected_innings_x_3",
        sources: { projectedInnings: innings }
      };
    }
  }

  return null;
}

const boardRaw = readJson(BOARD_FILE, []);
const rows = flatten(boardRaw);

const missing = [];
const repaired = [];

for (const row of rows) {
  const player = playerOf(row);
  const market = marketOf(row);
  if (!player || !market || !isPitcherMarket(market)) continue;
  if (hasProjection(row)) continue;

  const repair = deriveProjection(row);

  const item = {
    player,
    team: row.team || row.playerTeam || "",
    market: row.market || row.statType || market,
    line: getNum(row, ["line", "propLine", "ppLine"]),
    originalKeys: Object.keys(row).slice(0, 80)
  };

  if (repair) repaired.push({ ...item, ...repair });
  else missing.push({ ...item, reason: "NO_SOURCE_COMPONENTS_AVAILABLE_UPSTREAM" });
}

const report = {
  generatedAt: new Date().toISOString(),
  boardFile: BOARD_FILE,
  pitcherRowsWithoutProjection: missing.length + repaired.length,
  repairableCount: repaired.length,
  stillMissingCount: missing.length,
  repaired,
  missing,
  note: "This script avoids fake line-based projections. Repair happens only when source projection/component fields exist."
};

fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

console.log("=== Upstream Pitcher Projection Repair Audit ===");
console.log("Pitcher rows missing projection:", report.pitcherRowsWithoutProjection);
console.log("Repairable from source components:", repaired.length);
console.log("Still missing source components:", missing.length);
console.log("Saved:", OUT_FILE);

if (missing.length) {
  console.log("");
  console.log("Top still-missing examples:");
  for (const r of missing.slice(0, 15)) {
    console.log(`${r.player} | ${r.market} ${r.line ?? ""} | ${r.reason}`);
  }
}
