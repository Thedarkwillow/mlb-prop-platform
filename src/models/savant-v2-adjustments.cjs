const fs = require("fs");

function readJson(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normName(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

const ROLLING = readJson("data/savant/rolling-form.json", {});
const HITTERS = ROLLING.hitters || {};

function rollingFormForPlayer(player) {
  return HITTERS[normName(player)] || null;
}

function rollingFormMeanAdjustment(leg, market) {
  const form = rollingFormForPlayer(leg.player);
  if (!form) return { adjustment: 0, form: null, notes: ["no rolling form"] };

  const score = Number(form.formScore || 0);
  const tier = String(form.formTier || "").toLowerCase();
  const metrics = form.metrics || {};

  let adjustment = 0;
  const notes = [];

  if (tier === "positive" || score >= 2) {
    adjustment += 0.025;
    notes.push("positive rolling form");
  }

  if (tier === "negative" || score <= -2) {
    adjustment -= 0.025;
    notes.push("negative rolling form");
  }

  if (Number(metrics.xwoba) >= 0.380) {
    adjustment += 0.015;
    notes.push("strong xwoba form");
  }

  if (Number(metrics.xwoba) <= 0.285 && Number(metrics.xwoba) > 0) {
    adjustment -= 0.015;
    notes.push("weak xwoba form");
  }

  if (Number(metrics.hardHitRate) >= 48) {
    adjustment += 0.01;
    notes.push("hard-hit form");
  }

  if (Number(metrics.kRate) >= 30 && ["hits", "bases", "singles", "hrr"].includes(market)) {
    adjustment -= 0.01;
    notes.push("high k-rate form");
  }

  // Conservative first version: cap to +/- 4%.
  adjustment = Math.max(-0.04, Math.min(0.04, adjustment));

  return {
    adjustment,
    form: {
      player: form.player,
      formScore: form.formScore,
      formTier: form.formTier,
      metrics
    },
    notes
  };
}

function applySavantV2Mean(mean, leg, market) {
  const base = Number(mean);
  if (!Number.isFinite(base)) {
    return {
      mean,
      savantV2: {
        applied: false,
        adjustment: 0,
        notes: ["invalid mean"]
      }
    };
  }

  const rolling = rollingFormMeanAdjustment(leg, market);
  const adjusted = base * (1 + rolling.adjustment);

  return {
    mean: Math.max(0.01, adjusted),
    savantV2: {
      applied: rolling.adjustment !== 0,
      adjustment: Number(rolling.adjustment.toFixed(4)),
      source: "rolling_form_v1",
      form: rolling.form,
      notes: rolling.notes
    }
  };
}

module.exports = {
  applySavantV2Mean,
  rollingFormForPlayer
};
