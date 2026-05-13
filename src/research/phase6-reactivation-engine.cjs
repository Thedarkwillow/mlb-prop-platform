const fs = require("fs");

function readJson(p, fallback = {}) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function writeJson(p, data) {
  fs.mkdirSync(require("path").dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

const phase5 = readJson("data/learning/phase5-market-trust.json", { rows: {} });
const phase6 = readJson("data/learning/phase6-calibration-shrinkage.json", { rows: {} });
const regime = readJson("data/learning/phase6-regime-detection.json", { rows: {} });

const keys = new Set([
  ...Object.keys(phase5.rows || {}),
  ...Object.keys(phase6.rows || {}),
  ...Object.keys(regime.rows || {})
]);

const rows = {};
for (const key of keys) {
  const p5 = phase5.rows?.[key] || {};
  const p6 = phase6.rows?.[key] || {};
  const rg = regime.rows?.[key] || {};
  const sample = Number(p6.sample ?? p5.sample ?? 0);
  const hitRate = Number(p6.hitRate ?? p5.hitRate ?? NaN);
  const d7 = Number(rg.d7 ?? NaN);
  const d14 = Number(rg.d14 ?? NaN);
  const currentAction = p5.action || p6.trust || rg.action || "UNKNOWN";

  let reactivation = "NO_ACTION";
  let allowed = false;
  let reason = "insufficient evidence";

  if (sample >= 100 && hitRate >= 0.54 && (Number.isNaN(d7) || d7 >= 0.52)) {
    reactivation = "REACTIVATE_FULL";
    allowed = true;
    reason = "large sample and acceptable recent hit rate";
  } else if (sample >= 50 && hitRate >= 0.50 && (Number.isNaN(d7) || d7 >= 0.55)) {
    reactivation = "REACTIVATE_WATCH";
    allowed = true;
    reason = "watch reactivation only";
  } else if (sample >= 75 && hitRate < 0.45) {
    reactivation = "KEEP_SUPPRESSED";
    reason = "large sample remains weak";
  } else if (!Number.isNaN(d7) && d7 < 0.40) {
    reactivation = "RECENT_SUPPRESS";
    reason = "recent regime is poor";
  }

  rows[key] = {
    key,
    sample,
    hitRate: Number.isNaN(hitRate) ? null : Number(hitRate.toFixed(4)),
    d7: Number.isNaN(d7) ? null : Number(d7.toFixed(4)),
    d14: Number.isNaN(d14) ? null : Number(d14.toFixed(4)),
    currentAction,
    reactivation,
    allowed,
    reason
  };
}

const out = {
  createdAt: new Date().toISOString(),
  rows,
  reactivated: Object.values(rows).filter(r => r.allowed),
  suppressed: Object.values(rows).filter(r => !r.allowed && /SUPPRESS|BAD|TIGHTEN/.test(String(r.currentAction)))
};

writeJson("data/learning/phase6-reactivation.json", out);

console.log("PHASE 6 REACTIVATION BUILT");
console.table(Object.values(rows).slice(0, 25).map(r => ({
  key: r.key,
  sample: r.sample,
  hitRate: r.hitRate,
  d7: r.d7,
  reactivation: r.reactivation
})));
