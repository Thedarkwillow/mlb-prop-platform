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
const MATCHUPS = readJson("data/savant/pitch-type-matchups.json", {});
const HITTERS = ROLLING.hitters || {};
const PITCH_MATCHUPS = MATCHUPS.matchups || {};

function rollingFormForPlayer(player) {
  return HITTERS[normName(player)] || null;
}

function pitchTypeMatchupForLeg(leg) {
  const playerKey = normName(leg.player);
  if (!playerKey) return null;

  const team = String(leg.team || leg.resolvedTeam || "").toUpperCase();

  const matches = Object.values(PITCH_MATCHUPS).filter(m =>
    normName(m.player) === playerKey &&
    (!team || String(m.team || "").toUpperCase() === team)
  );

  if (!matches.length) return null;

  const exactMarket = matches.find(m =>
    String(m.market || "").toLowerCase() === String(leg.market || leg.stat || "").toLowerCase()
  );

  return exactMarket || matches[0];
}

function rollingFormMeanAdjustment(leg, market) {
  const form = rollingFormForPlayer(leg.player);
  if (!form) return { adjustment: 0, form: null, notes: ["no rolling form"] };

  const score = Number(form.formScore || 0);
  const tier = String(form.formTier || "").toLowerCase();
  const metrics = form.metrics || {};

  let adjustment = 0;
  const notes = [];

  if (["positive", "hot"].includes(tier) || score >= 2) {
    adjustment += 0.025;
    notes.push("positive rolling form");
  }

  if (["negative", "cold"].includes(tier) || score <= -2) {
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

function pitchTypeMeanAdjustment(leg) {
  const matchup = pitchTypeMatchupForLeg(leg);

  if (!matchup || matchup.matched !== true) {
    return {
      adjustment: 0,
      matchup: matchup
        ? {
            matched: false,
            tier: matchup.tier || "unknown",
            score: matchup.score ?? null,
            opponentPitcher: matchup.opponentPitcher || null,
            flags: matchup.flags || []
          }
        : null,
      notes: ["no matched pitch-type matchup"]
    };
  }

  const tier = String(matchup.tier || "").toLowerCase();
  let adjustment = 0;

  if (tier === "strong_boost") adjustment = 0.02;
  else if (tier === "boost") adjustment = 0.01;
  else if (tier === "downgrade") adjustment = -0.01;
  else if (tier === "strong_downgrade") adjustment = -0.02;

  return {
    adjustment,
    matchup: {
      matched: true,
      tier: matchup.tier,
      score: matchup.score,
      opponentPitcher: matchup.opponentPitcher || null,
      opponentPitcherHand: matchup.opponentPitcherHand || null,
      flags: matchup.flags || [],
      pitchTypes: (matchup.pitchTypes || []).slice(0, 3)
    },
    notes: adjustment === 0 ? ["neutral pitch-type matchup"] : [`pitch-type ${tier}`]
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
        rollingAdjustment: 0,
        pitchTypeAdjustment: 0,
        notes: ["invalid mean"]
      }
    };
  }

  const rolling = rollingFormMeanAdjustment(leg, market);
  const pitchType = pitchTypeMeanAdjustment({ ...leg, market });

  const totalAdjustment = Math.max(
    -0.05,
    Math.min(0.05, rolling.adjustment + pitchType.adjustment)
  );

  const adjusted = base * (1 + totalAdjustment);

  return {
    mean: Math.max(0.01, adjusted),
    savantV2: {
      applied: totalAdjustment !== 0,
      adjustment: Number(totalAdjustment.toFixed(4)),
      rollingAdjustment: Number(rolling.adjustment.toFixed(4)),
      pitchTypeAdjustment: Number(pitchType.adjustment.toFixed(4)),
      source: "rolling_form_plus_pitch_type_v2",
      form: rolling.form,
      pitchTypeMatchup: pitchType.matchup,
      notes: [...rolling.notes, ...pitchType.notes]
    }
  };
}

module.exports = {
  applySavantV2Mean,
  rollingFormForPlayer,
  pitchTypeMatchupForLeg
};
