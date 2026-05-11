const fs = require("fs");
const path = require("path");

const OUT = "data/savant/rolling-form.json";

const INPUTS = [
  "data/savant-latest.json",
  "data/savant/latest.json",
  "data/savant/savant-latest.json",
  "outputs/savant-latest.json",
  "outputs/priced-board.json",
  "outputs/merged-board.json"
];

function read(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function num(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function playerName(r) {
  return r.player || r.name || r.playerName || r.batter || r.pitcher || null;
}

function playerType(r) {
  const raw = String(r.playerType || r.type || r.role || "").toLowerCase();
  if (raw.includes("pitch")) return "pitcher";
  if (raw.includes("bat") || raw.includes("hit")) return "batter";

  const market = String(r.market || r.stat || "").toLowerCase();
  if (
    market.includes("strikeout") ||
    market.includes("pitching") ||
    market.includes("outs") ||
    market.includes("earned_runs_allowed") ||
    market.includes("hits_allowed")
  ) return "pitcher";

  return "batter";
}

function flatten(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap(flatten);
  if (Array.isArray(x.rows)) return x.rows.flatMap(flatten);
  if (Array.isArray(x.data)) return x.data.flatMap(flatten);
  if (Array.isArray(x.players)) return x.players.flatMap(flatten);
  return [x];
}

function usableSavantRow(r) {
  const name = playerName(r);
  if (!name) return false;

  return (
    r.recordType === "savant_player" ||
    r.savant ||
    r.xwoba != null ||
    r.xba != null ||
    r.xslg != null ||
    r.hardHitRate != null ||
    r.barrelRate != null ||
    r.kRate != null ||
    r.whiffRate != null
  );
}

function unwrap(r) {
  return r.savant ? { ...r, ...r.savant } : r;
}

function formRecord(rows, type) {
  const latest = rows[0] || {};
  const samples = rows.slice(0, 30);

  const avg = (fieldNames, fallback = null) => {
    const vals = samples
      .map(r => num(...fieldNames.map(f => r[f])))
      .filter(v => v != null);
    if (!vals.length) return fallback;
    return vals.reduce((s, x) => s + x, 0) / vals.length;
  };

  const xwoba = avg(["xwoba", "xwOBA"]);
  const xslg = avg(["xslg", "xSLG"]);
  const xba = avg(["xba", "xBA"]);
  const hardHitRate = avg(["hardHitRate", "hard_hit_rate", "hardHitPct"]);
  const barrelRate = avg(["barrelRate", "barrel_rate", "barrelPct"]);
  const kRate = avg(["kRate", "k_rate", "strikeoutRate"]);
  const bbRate = avg(["bbRate", "bb_rate", "walkRate"]);
  const whiffRate = avg(["whiffRate", "whiff_rate", "whiffPct"]);
  const avgExitVelocity = avg(["avgExitVelocity", "avg_exit_velocity", "ev"]);
  const avgLaunchAngle = avg(["avgLaunchAngle", "avg_launch_angle", "launchAngle"]);

  let formScore = 0;
  const flags = [];

  if (type === "batter") {
    if (xwoba != null && xwoba >= 0.370) { formScore += 2; flags.push("HOT_XWOBA"); }
    if (xwoba != null && xwoba <= 0.285) { formScore -= 2; flags.push("COLD_XWOBA"); }

    if (xslg != null && xslg >= 0.500) { formScore += 1; flags.push("POWER_FORM"); }
    if (xslg != null && xslg <= 0.330) { formScore -= 1; flags.push("LOW_POWER_FORM"); }

    if (hardHitRate != null && hardHitRate >= 45) { formScore += 1; flags.push("HARD_HIT_FORM"); }
    if (barrelRate != null && barrelRate >= 10) { formScore += 1; flags.push("BARREL_FORM"); }
    if (kRate != null && kRate >= 28) { formScore -= 1; flags.push("K_RISK"); }
  }

  if (type === "pitcher") {
    if (kRate != null && kRate >= 28) { formScore += 2; flags.push("K_FORM"); }
    if (kRate != null && kRate <= 18) { formScore -= 2; flags.push("LOW_K_FORM"); }

    if (whiffRate != null && whiffRate >= 30) { formScore += 1; flags.push("WHIFF_FORM"); }
    if (hardHitRate != null && hardHitRate >= 45) { formScore -= 1; flags.push("HARD_CONTACT_ALLOWED"); }
  }

  const formTier =
    formScore >= 3 ? "hot" :
    formScore >= 1 ? "positive" :
    formScore <= -3 ? "cold" :
    formScore <= -1 ? "negative" :
    "neutral";

  return {
    player: playerName(latest),
    playerKey: norm(playerName(latest)),
    playerType: type,
    sampleRows: samples.length,
    formScore,
    formTier,
    flags,
    metrics: {
      xwoba: xwoba == null ? null : Number(xwoba.toFixed(4)),
      xslg: xslg == null ? null : Number(xslg.toFixed(4)),
      xba: xba == null ? null : Number(xba.toFixed(4)),
      hardHitRate: hardHitRate == null ? null : Number(hardHitRate.toFixed(4)),
      barrelRate: barrelRate == null ? null : Number(barrelRate.toFixed(4)),
      kRate: kRate == null ? null : Number(kRate.toFixed(4)),
      bbRate: bbRate == null ? null : Number(bbRate.toFixed(4)),
      whiffRate: whiffRate == null ? null : Number(whiffRate.toFixed(4)),
      avgExitVelocity: avgExitVelocity == null ? null : Number(avgExitVelocity.toFixed(4)),
      avgLaunchAngle: avgLaunchAngle == null ? null : Number(avgLaunchAngle.toFixed(4))
    }
  };
}

const rows = [];

for (const file of INPUTS) {
  const data = read(file, null);
  if (!data) continue;

  for (const raw of flatten(data)) {
    const r = unwrap(raw);
    if (!usableSavantRow(r)) continue;

    rows.push({
      ...r,
      _sourceFile: file,
      _player: playerName(r),
      _key: norm(playerName(r)),
      _type: playerType(r)
    });
  }
}

const grouped = new Map();

for (const r of rows) {
  const key = `${r._type}:${r._key}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(r);
}

const hitters = {};
const pitchers = {};

for (const [key, group] of grouped.entries()) {
  const type = group[0]._type;
  const rec = formRecord(group, type);

  if (type === "pitcher") pitchers[rec.playerKey] = rec;
  else hitters[rec.playerKey] = rec;
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFiles: INPUTS.filter(fs.existsSync),
  usableRows: rows.length,
  hitterCount: Object.keys(hitters).length,
  pitcherCount: Object.keys(pitchers).length,
  rules: {
    note: "Local-only Savant rolling form cache. No paid API usage. Uses available local Savant/board data.",
    initialWeighting: "Conservative; probability engine should cap form adjustment to +/- 0.02 to start."
  },
  hitters,
  pitchers
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

console.log("SAVANT ROLLING FORM CACHE");
console.log("=========================");
console.log(`Usable rows: ${rows.length}`);
console.log(`Hitters: ${out.hitterCount}`);
console.log(`Pitchers: ${out.pitcherCount}`);
console.log(`Wrote ${OUT}`);

console.log("");
console.log("Top hitter form examples:");
console.table(
  Object.values(hitters)
    .sort((a, b) => b.formScore - a.formScore)
    .slice(0, 12)
    .map(x => ({
      player: x.player,
      tier: x.formTier,
      score: x.formScore,
      xwoba: x.metrics.xwoba,
      hardHit: x.metrics.hardHitRate,
      barrel: x.metrics.barrelRate,
      flags: x.flags.join(",")
    }))
);

console.log("");
console.log("Top pitcher form examples:");
console.table(
  Object.values(pitchers)
    .sort((a, b) => b.formScore - a.formScore)
    .slice(0, 12)
    .map(x => ({
      player: x.player,
      tier: x.formTier,
      score: x.formScore,
      kRate: x.metrics.kRate,
      whiff: x.metrics.whiffRate,
      hardHit: x.metrics.hardHitRate,
      flags: x.flags.join(",")
    }))
);
