import fs from "fs";

function readJson(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function n(v, fallback = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function keyName(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function market(row) {
  return String(row.market || row.stat || row.projectionType || "").toLowerCase();
}

function side(row) {
  const s = String(row.recommendedSide || row.side || row.pick || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "";
}

function player(row) {
  return keyName(row.player || row.playerName || row.name);
}

function pitcher(row) {
  return keyName(row.pitcher || row.opposingPitcher || row.probablePitcher);
}

function team(row) {
  return String(row.team || row.playerTeam || "").toUpperCase();
}

function opp(row) {
  return String(row.opponent || row.opp || row.opposingTeam || "").toUpperCase();
}

const catcherData = readJson("data/context/catcher-framing.json", {});
const umpireData = readJson("data/context/today-umpires.json", {});
const bullpenData = readJson("data/context/pitching-staffs.json", {});
const lineupData = readJson("data/context/lineup-handedness-profile.json", {});
const gameContext = readJson("data/context/game-model-context.json", {});
const handedness = readJson("data/savant/handedness-splits.json", {});
const rollingForm = readJson("data/savant/rolling-form.json", {});
const pitchMatchups = readJson("data/savant/pitch-type-matchups.json", {});
const volatility = readJson("data/learning/market-volatility.json", {});
const weakEnv = readJson("data/learning/weak-environment-downgrades.json", {});
const roiIntel = readJson("data/learning/roi-intelligence.json", {});
const autoMarkets = readJson("data/learning/auto-market-adjustments.json", {});

function findByName(obj, nameKey) {
  if (!obj || !nameKey) return null;
  if (obj[nameKey]) return obj[nameKey];

  if (Array.isArray(obj)) {
    return obj.find(x => keyName(x.player || x.name || x.catcher || x.pitcher) === nameKey) || null;
  }

  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      const found = v.find(x => keyName(x.player || x.name || x.catcher || x.pitcher) === nameKey);
      if (found) return found;
    }
  }

  return null;
}

function add(adj, amount, reason) {
  if (!Number.isFinite(amount) || amount === 0) return;
  adj.delta += amount;
  adj.reasons.push(reason);
}

export function applyPhase5ContextAdjustments(row) {
  const m = market(row);
  const s = side(row);
  const p = player(row);
  const pit = pitcher(row);
  const t = team(row);
  const o = opp(row);

  let prob = n(row.recommendedProb ?? row.probability ?? row.prob, null);
  if (prob == null) return row;

  const adj = {
    delta: 0,
    reasons: [],
    modules: {}
  };

  // 1. Catcher framing: mostly K / walk / pitcher-side props.
  const catcher =
    findByName(catcherData, keyName(row.catcher || row.opposingCatcher)) ||
    findByName(catcherData, keyName(row.homeCatcher)) ||
    findByName(catcherData, keyName(row.awayCatcher));

  if (catcher) {
    const framing = n(catcher.framingRuns ?? catcher.strikeRateAdded ?? catcher.catcherFraming ?? catcher.score, 0);
    const framingAdj = clamp(framing / 100, -0.025, 0.025);

    if (m.includes("strikeout")) {
      add(adj, s === "MORE" ? framingAdj : -framingAdj, `catcher_framing_k_${framingAdj.toFixed(3)}`);
    }

    if (m.includes("walk")) {
      add(adj, s === "LESS" ? framingAdj * 0.7 : -framingAdj * 0.7, `catcher_framing_walk_${framingAdj.toFixed(3)}`);
    }

    adj.modules.catcherFraming = catcher;
  }

  // 2. Umpire: K/walk/run environment modifier.
  const ump =
    findByName(umpireData, keyName(row.umpire || row.homePlateUmpire)) ||
    umpireData[row.gameId] ||
    umpireData[row.gamePk];

  if (ump) {
    const kBoost = clamp(n(ump.kBoost ?? ump.strikeoutBoost ?? ump.calledStrikeBoost ?? ump.zoneBoost, 0), -0.03, 0.03);
    const walkBoost = clamp(n(ump.walkBoost ?? ump.bbBoost ?? ump.walkRateBoost, 0), -0.03, 0.03);
    const hitterBoost = clamp(n(ump.hitterBoost ?? ump.runBoost ?? ump.offenseBoost, 0), -0.03, 0.03);

    if (m.includes("strikeout")) add(adj, s === "MORE" ? kBoost : -kBoost, `umpire_k_env_${kBoost.toFixed(3)}`);
    if (m.includes("walk")) add(adj, s === "MORE" ? walkBoost : -walkBoost, `umpire_walk_env_${walkBoost.toFixed(3)}`);
    if (["hits", "bases", "hrr", "runs", "rbi", "home_runs"].some(x => m.includes(x))) {
      add(adj, s === "MORE" ? hitterBoost : -hitterBoost, `umpire_hitter_env_${hitterBoost.toFixed(3)}`);
    }

    adj.modules.umpire = ump;
  }

  // 3. Bullpen / pitching staff risk.
  const staff = bullpenData[o] || bullpenData[t] || bullpenData[row.gameId] || bullpenData[row.gamePk];
  if (staff) {
    const fatigue = clamp(n(staff.fatigueScore ?? staff.bullpenFatigue ?? staff.recentUsageScore, 0), 0, 1);
    const collapse = clamp(n(staff.collapseRisk ?? staff.bullpenCollapseRisk ?? staff.lateGameRisk, 0), 0, 1);
    const leash = clamp(n(staff.starterLeashRisk ?? staff.shortLeashRisk, 0), 0, 1);

    const hitterLateBoost = clamp((fatigue * 0.015) + (collapse * 0.02) + (leash * 0.01), 0, 0.04);

    if (["hits", "bases", "hrr", "runs", "rbi", "home_runs"].some(x => m.includes(x))) {
      add(adj, s === "MORE" ? hitterLateBoost : -hitterLateBoost, `bullpen_risk_${hitterLateBoost.toFixed(3)}`);
    }

    adj.modules.bullpen = staff;
  }

  // 4. Lineup-handedness pressure.
  const lineup = lineupData[t] || lineupData[o] || lineupData[row.gameId] || lineupData[row.gamePk];
  if (lineup) {
    const pressure = clamp(n(lineup.handednessPressureScore ?? lineup.lineupPressure ?? lineup.balanceScore, 0), -1, 1);
    const lineupAdj = clamp(pressure * 0.025, -0.025, 0.025);

    if (["hits", "bases", "hrr", "runs", "rbi", "home_runs"].some(x => m.includes(x))) {
      add(adj, s === "MORE" ? lineupAdj : -lineupAdj, `lineup_handedness_${lineupAdj.toFixed(3)}`);
    }

    if (m.includes("strikeout")) {
      add(adj, s === "LESS" ? lineupAdj * 0.6 : -lineupAdj * 0.6, `lineup_contact_pressure_${lineupAdj.toFixed(3)}`);
    }

    adj.modules.lineupHandedness = lineup;
  }

  // 5. Contact quality / rolling form.
  const form = findByName(rollingForm, p);
  if (form) {
    const score = clamp(n(form.score ?? form.formScore, 0), -5, 5);
    const cqAdj = clamp(score * 0.006, -0.03, 0.03);

    if (["hits", "bases", "hrr", "home_runs", "runs", "rbi"].some(x => m.includes(x))) {
      add(adj, s === "MORE" ? cqAdj : -cqAdj, `contact_quality_form_${cqAdj.toFixed(3)}`);
    }

    adj.modules.contactQuality = form;
  }

  // 6. Pitch-type matchup.
  const matchup = findByName(pitchMatchups, p) || findByName(pitchMatchups, pit);
  if (matchup) {
    const score = clamp(n(matchup.matchupScore ?? matchup.edgeScore ?? matchup.pitchTypeEdge, 0), -1, 1);
    const pitchAdj = clamp(score * 0.025, -0.025, 0.025);

    if (["hits", "bases", "hrr", "home_runs", "strikeouts"].some(x => m.includes(x))) {
      add(adj, s === "MORE" ? pitchAdj : -pitchAdj, `pitch_type_matchup_${pitchAdj.toFixed(3)}`);
    }

    adj.modules.pitchTypeMatchup = matchup;
  }

  // 7. Regime / weak environment / volatility.
  const volKey = `${m}_${s}`;
  const vol =
    volatility.byMarketDirection?.[volKey] ||
    volatility.byMarket?.[m] ||
    volatility[volKey] ||
    volatility[m];

  if (vol) {
    const vScore = clamp(n(vol.volatilityScore ?? vol.riskScore, 0), 0, 1);
    const vPenalty = clamp(vScore * 0.04, 0, 0.04);
    add(adj, -vPenalty, `volatility_regime_${vPenalty.toFixed(3)}`);
    adj.modules.volatility = vol;
  }

  const weak =
    weakEnv[volKey] ||
    weakEnv[m] ||
    autoMarkets[volKey] ||
    autoMarkets[m];

  if (weak) {
    const suppress = Boolean(weak.suppressed || weak.suppress || weak.action === "suppress");
    const penalty = suppress ? 0.08 : clamp(n(weak.penalty ?? weak.adjustment ?? 0, 0), -0.06, 0.02);
    add(adj, penalty < 0 ? penalty : -Math.abs(penalty), `weak_environment_${penalty.toFixed(3)}`);
    adj.modules.weakEnvironment = weak;
  }

  // 8. Feature attribution placeholder using ROI intelligence.
  const roi =
    roiIntel.byMarketDirection?.[volKey] ||
    roiIntel.byMarket?.[m] ||
    roiIntel[volKey] ||
    roiIntel[m];

  if (roi) {
    const hitRate = n(roi.hitRate, null);
    if (hitRate != null) {
      const roiAdj = clamp((hitRate - 0.53) * 0.08, -0.025, 0.025);
      add(adj, roiAdj, `feature_roi_weight_${roiAdj.toFixed(3)}`);
    }
    adj.modules.featureAttribution = roi;
  }

  const totalDelta = clamp(adj.delta, -0.12, 0.08);
  const adjustedProb = clamp(prob + totalDelta, 0.01, 0.99);
  const expectedValue = Number(((adjustedProb - 0.5) * 2).toFixed(3));

  let confidenceBucket =
    adjustedProb >= 0.66 ? "elite" :
    adjustedProb >= 0.60 ? "strong" :
    adjustedProb >= 0.55 ? "playable" :
    "lean";

  if (totalDelta <= -0.08) confidenceBucket = "suppressed";

  return {
    ...row,
    prePhase5ContextProb: prob,
    recommendedProb: Number(adjustedProb.toFixed(4)),
    prob: Number(adjustedProb.toFixed(4)),
    probability: Number(adjustedProb.toFixed(4)),
    expectedValue,
    confidenceBucket,
    phase5Context: {
      applied: adj.reasons.length > 0,
      rawDelta: Number(adj.delta.toFixed(4)),
      boundedDelta: Number(totalDelta.toFixed(4)),
      reasons: adj.reasons,
      modulesUsed: Object.keys(adj.modules)
    }
  };
}
