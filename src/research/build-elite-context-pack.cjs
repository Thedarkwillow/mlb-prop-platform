const fs = require("fs");

const OUT = "data/context/elite-context-pack.json";

function read(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function n(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
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
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function values(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") return Object.values(x);
  return [];
}

const board = read("outputs/priced-board.json", []);
const depth = read("data/context/context-depth-pack.json", {});
const rollingForm = read("data/savant/rolling-form.json", {});
const pitchMatchups = read("data/savant/pitch-type-matchups.json", {});
const velo = read("data/savant/pitcher-velocity-trends.json", {});
const weakEnv = read("data/learning/weak-environment-downgrades.json", {});
const bullpenDepth = read("data/context/bullpen-depth.json", {});
const gameOdds = read("data/context/game-odds-context.json", {});
const ballpark = read("data/ballpark-latest.json", []);
const phase5Polish = read("data/context/phase5-polish-pack.json", {});

function formMap() {
  const m = new Map();
  for (const r of values(rollingForm.players || rollingForm.hitters || rollingForm.pitchers || rollingForm)) {
    const k = keyName(r.player || r.name);
    if (k) m.set(k, r);
  }
  return m;
}

function matchupMap() {
  const m = new Map();
  for (const r of values(pitchMatchups.matchups || pitchMatchups.rows || pitchMatchups)) {
    const k = keyName(r.player || r.hitter || r.name);
    if (k) m.set(k, r);
  }
  return m;
}

function veloMap() {
  const m = new Map();
  for (const r of values(velo.pitchers || velo.rows || velo)) {
    const k = keyName(r.player || r.pitcher || r.name);
    if (k) m.set(k, r);
  }
  return m;
}

const forms = formMap();
const matchups = matchupMap();
const velos = veloMap();

function market(row) {
  return String(row.market || row.stat || row.projectionType || "").toLowerCase();
}

function side(row) {
  const s = String(row.recommendedSide || row.side || row.pick || "").toUpperCase();
  if (s.includes("MORE") || s.includes("OVER")) return "MORE";
  if (s.includes("LESS") || s.includes("UNDER")) return "LESS";
  return "";
}

function team(row) {
  return String(row.team || row.playerTeam || "").toUpperCase();
}

function gameKey(row) {
  return String(row.game || row.gameKey || "");
}

function findTeamDepth(t) {
  return depth.teams?.[t] || null;
}

function findOpp(row) {
  const t = team(row);
  const td = findTeamDepth(t);
  return String(td?.opponent || row.opponent || row.opp || "").toUpperCase();
}

function scoreBatter(row) {
  const name = keyName(row.player || row.playerName || row.name);
  const polish = phase5Polish.byPlayer?.[name] || {};
  const f = forms.get(name) || polish.batter || {};
  const m = matchups.get(name) || polish.pitchTypes || {};
  const reasons = [];

  let score = 0;

  const formScore = n(f.score ?? f.formScore, 0);
  if (formScore) {
    score += clamp(formScore / 5, -1, 1) * 0.35;
    reasons.push(`rolling_form_${formScore}`);
  }

  const xwoba = n(f.xwoba ?? f.metrics?.xwoba);
  if (xwoba != null) {
    score += clamp((xwoba - 0.320) / 0.100, -1, 1) * 0.25;
    reasons.push(`xwoba_${xwoba}`);
  }

  const hardHit = n(f.hardHit ?? f.hardHitRate ?? f.metrics?.hardHit);
  if (hardHit != null) {
    score += clamp((hardHit - 40) / 20, -1, 1) * 0.15;
    reasons.push(`hard_hit_${hardHit}`);
  }

  const barrel = n(f.barrel ?? f.barrelRate ?? f.metrics?.barrel);
  if (barrel != null) {
    score += clamp((barrel - 8) / 8, -1, 1) * 0.15;
    reasons.push(`barrel_${barrel}`);
  }

  const whiff = n(f.whiffRate ?? f.whiff);
  if (whiff != null) {
    score -= clamp((whiff - 25) / 15, -1, 1) * 0.10;
    reasons.push(`whiff_risk_${whiff}`);
  }

  const pitchEdge = n(m.matchupScore ?? m.edgeScore ?? m.pitchTypeEdge);
  const polishPitchValues = m.pitchTypeRunValues || {};
  const polishPitchAvg = Object.values(polishPitchValues).map(Number).filter(Number.isFinite);
  if (polishPitchAvg.length) {
    const avgPitchValue = polishPitchAvg.reduce((a,b)=>a+b,0) / polishPitchAvg.length;
    score += clamp(avgPitchValue, -1, 1) * 0.15;
    reasons.push(`pitch_run_value_${avgPitchValue.toFixed(3)}`);
  }
  if (pitchEdge != null) {
    score += clamp(pitchEdge, -1, 1) * 0.25;
    reasons.push(`pitch_type_edge_${pitchEdge}`);
  }

  const delta = clamp(score * 0.035, -0.035, 0.035);

  return {
    score: Number(score.toFixed(4)),
    delta: Number(delta.toFixed(4)),
    reasons
  };
}

function scorePitcher(row) {
  const t = team(row);
  const opp = findOpp(row);
  const oppDepth = findTeamDepth(opp);
  const ownDepth = findTeamDepth(t);

  const pitcher =
    ownDepth?.startingPitcher ||
    oppDepth?.startingPitcher ||
    null;

  const name = keyName(row.pitcher || row.opposingPitcher || pitcher?.name);
  const v = velos.get(name) || {};
  const reasons = [];

  let score = 0;

  const fip = n(pitcher?.fip);
  const xfip = n(pitcher?.xfip);
  const pmr = n(pitcher?.pmr);

  if (fip != null) {
    score += clamp((4.20 - fip) / 1.5, -1, 1) * 0.25;
    reasons.push(`fip_${fip}`);
  }

  if (xfip != null) {
    score += clamp((4.20 - xfip) / 1.5, -1, 1) * 0.20;
    reasons.push(`xfip_lite_${xfip}`);
  }

  if (pmr != null) {
    score += clamp(pmr / 4, -1, 1) * 0.20;
    reasons.push(`pmr_${pmr}`);
  }

  const veloDelta = n(v.velocityDelta ?? v.fastballVeloDelta ?? pitcher?.arsenal?.velocityDelta);
  if (veloDelta != null) {
    score += clamp(veloDelta / 2, -1, 1) * 0.15;
    reasons.push(`velo_delta_${veloDelta}`);
  }

  const pitchMixCount = Object.keys(pitcher?.pitchMix || pitcher?.arsenal?.pitchTypes || {}).length;
  if (pitchMixCount) {
    score += clamp((pitchMixCount - 3) / 3, -1, 1) * 0.10;
    reasons.push(`arsenal_depth_${pitchMixCount}`);
  }

  const fatigue = n(pitcher?.fatigueScore ?? pitcher?.recentPitchStress);
  if (fatigue != null) {
    score -= clamp(fatigue, 0, 1) * 0.15;
    reasons.push(`pitcher_fatigue_${fatigue}`);
  }

  const delta = clamp(score * 0.035, -0.035, 0.035);

  return {
    pitcher: pitcher?.name || null,
    score: Number(score.toFixed(4)),
    delta: Number(delta.toFixed(4)),
    reasons
  };
}

function scoreEnvironment(row) {
  const t = team(row);
  const td = findTeamDepth(t);
  const opp = findOpp(row);
  const od = findTeamDepth(opp);
  const bp = row.ballpark || phase5Polish.weatherByGame?.[gameKey(row)] || {};
  const g = gameOdds.teams?.[t] || {};
  const pen = od?.bullpen || bullpenDepth.teams?.[opp] || {};
  const reasons = [];

  let score = 0;

  const total = n(td?.teamContext?.total ?? g.total);
  if (total != null) {
    score += clamp((total - 8.0) / 2.5, -1, 1) * 0.30;
    reasons.push(`game_total_${total}`);
  }

  const rpg = n(td?.teamContext?.runsPerGame);
  if (rpg != null) {
    score += clamp((rpg - 4.4) / 1.2, -1, 1) * 0.20;
    reasons.push(`team_rpg_${rpg}`);
  }

  const last3 = n(td?.teamContext?.last3RunsPerGame);
  if (last3 != null) {
    score += clamp((last3 - 4.4) / 1.8, -1, 1) * 0.15;
    reasons.push(`last3_rpg_${last3}`);
  }

  const park = n(bp.runFactor ?? bp.parkFactor ?? bp.runEnvironment);
  if (park != null) {
    score += clamp((park - 1) / 0.15, -1, 1) * 0.15;
    reasons.push(`park_factor_${park}`);
  }

  const bullpenRisk = n(pen.riskScore ?? pen.bullpenRisk);
  if (bullpenRisk != null) {
    score += clamp(bullpenRisk, 0, 1) * 0.20;
    reasons.push(`opp_bullpen_risk_${bullpenRisk}`);
  }

  const weatherRisk = bp.weather || bp.weatherSummary || bp.temperature || bp.temp ? 1 : 0;
  if (weatherRisk) reasons.push("weather_present_ballpark_source");

  const delta = clamp(score * 0.030, -0.030, 0.030);

  return {
    score: Number(score.toFixed(4)),
    delta: Number(delta.toFixed(4)),
    reasons
  };
}

function sideAdjustedDelta(row, rawDelta) {
  const s = side(row);
  if (s === "LESS") return -rawDelta;
  return rawDelta;
}

const rows = board
  .filter(r => r && r.recordType === "merged_prop")
  .map(r => {
    const batter = scoreBatter(r);
    const pitcher = scorePitcher(r);
    const environment = scoreEnvironment(r);

    const raw =
      batter.delta +
      pitcher.delta +
      environment.delta;

    const totalDelta = clamp(sideAdjustedDelta(r, raw), -0.075, 0.075);

    return {
      player: r.player || r.playerName || r.name,
      team: team(r),
      game: gameKey(r),
      market: market(r),
      side: side(r),
      batter,
      pitcher,
      environment,
      totalDelta: Number(totalDelta.toFixed(4)),
      reasons: [
        ...batter.reasons.map(x => `batter:${x}`),
        ...pitcher.reasons.map(x => `pitcher:${x}`),
        ...environment.reasons.map(x => `environment:${x}`)
      ]
    };
  });

const byKey = {};
for (const r of rows) {
  const k = `${keyName(r.player)}|${r.team}|${r.market}|${r.side}`;
  byKey[k] = r;
}

const out = {
  generatedAt: new Date().toISOString(),
  recordType: "elite_context_pack_v1",
  bounds: {
    batter: 0.035,
    pitcher: 0.035,
    environment: 0.030,
    total: 0.075
  },
  rows: rows.length,
  byKey,
  rowsSample: rows.slice(0, 25)
};

write(OUT, out);

console.log("ELITE CONTEXT PACK V1");
console.log("=====================");
console.log("Rows:", rows.length);
console.log("Wrote", OUT);
console.table(rows.slice(0, 20).map(r => ({
  player: r.player,
  team: r.team,
  market: r.market,
  side: r.side,
  batter: r.batter.delta,
  pitcher: r.pitcher.delta,
  env: r.environment.delta,
  total: r.totalDelta
})));
