const fs = require("fs");

function readJson(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function keyName(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamFromGame(row) {
  const team = row.team || row.resolvedTeam;
  if (team) return String(team).toUpperCase();

  const game = String(row.game || row.resolvedGame || "");
  return game.match(/\b[A-Z]{2,3}\b/)?.[0] || null;
}

function opponentFromGame(row) {
  if (row.opponent) return String(row.opponent).toUpperCase();

  const team = teamFromGame(row);
  const game = String(row.game || row.resolvedGame || "");
  const teams = game.match(/\b[A-Z]{2,3}\b/g) || [];
  return teams.find(t => t !== team) || null;
}

const gameOdds = readJson("data/context/game-odds-context.json");
const bullpenFatigue = readJson("data/context/bullpen-fatigue.json");
const teamForm = readJson("data/context/team-form-context.json");
const handedness = readJson("data/savant/handedness-splits.json");
const rollingForm = readJson("data/savant/rolling-form.json");
const velocity = readJson("data/savant/pitcher-velocity-trends.json");
const pitchType = readJson("data/savant/pitch-type-matchups.json");

const teamsOdds = gameOdds.teams || {};
const bullpenTeams = bullpenFatigue.teams || {};
const formTeams = teamForm.teams || {};
const battersHanded = handedness.batters || {};
const pitchersHanded = handedness.pitchers || {};
const rollingHitters = rollingForm.hitters || {};
const rollingPitchers = rollingForm.pitchers || {};
const velocityPitchers = velocity.pitchers || {};
const pitchMatchups = pitchType.matchups || {};

function byPlayer(obj, player) {
  const k = keyName(player);
  return obj[k] || Object.values(obj).find(x => keyName(x.player || x.pitcher) === k) || null;
}

function inferHandednessAdvantage(row, market) {
  const player = row.player;
  const pitcher = row.opponentPitcher || row.pitcher || row.probablePitcher;
  const batter = byPlayer(battersHanded, player);
  const oppPitcher = byPlayer(pitchersHanded, pitcher);

  if (!batter || !oppPitcher) return null;

  const hand = String(row.opponentPitcherHand || row.pitcherHand || "").toUpperCase();
  const batterSplit = hand === "L" ? batter.vsLHP : hand === "R" ? batter.vsRHP : null;

  if (!batterSplit) return null;

  if (["hits", "bases", "hrr", "runs", "rbis"].includes(market)) {
    if (Number(batterSplit.xwoba) >= 0.380 || Number(batterSplit.xslg) >= 0.520) return "strong";
    if (Number(batterSplit.xwoba) <= 0.285 || Number(batterSplit.xslg) <= 0.340) return "weak";
  }

  if (market === "strikeouts") {
    const pitcherSplit = hand === "L" ? oppPitcher.vsLHB : hand === "R" ? oppPitcher.vsRHB : null;
    if (Number(pitcherSplit?.kRate) >= 27 || Number(pitcherSplit?.whiffRate) >= 30) return "strong";
    if (Number(pitcherSplit?.kRate) <= 18 || Number(pitcherSplit?.whiffRate) <= 20) return "weak";
  }

  return null;
}

function findPitchTypeMatchup(row, market) {
  const playerKey = keyName(row.player);
  const pitcherKey = keyName(row.opponentPitcher || row.pitcher || row.probablePitcher);

  if (playerKey && pitcherKey) {
    const direct = pitchMatchups[`${playerKey}__${pitcherKey}`];
    if (direct) return direct;
  }

  return Object.values(pitchMatchups).find(x =>
    keyName(x.player) === playerKey &&
    (!market || String(x.market || "").toLowerCase() === market)
  ) || null;
}

function applyPhase5ContextFields(row) {
  const market = String(row.market || "").toLowerCase();
  const player = row.player;
  const team = teamFromGame(row);
  const opponent = opponentFromGame(row);

  const teamOdds = teamsOdds[team] || null;
  const oppBullpen = bullpenTeams[opponent] || null;
  const teamCtx = formTeams[team] || null;

  const rolling =
    ["strikeouts", "pitching_outs", "earned_runs_allowed", "hits_allowed", "walks_allowed"].includes(market)
      ? byPlayer(rollingPitchers, player)
      : byPlayer(rollingHitters, player);

  const velo = byPlayer(velocityPitchers, player);
  const ptm = findPitchTypeMatchup(row, market);

  const opponentBullpenWeak =
    oppBullpen?.fatigue === "HIGH" ||
    Number(oppBullpen?.last3DaysReliefPitches) >= 130 ||
    Number(oppBullpen?.pitchCountLast2Days) >= 95;

  const opponentBullpenElite =
    oppBullpen?.fatigue === "LOW" &&
    Number(oppBullpen?.last3DaysReliefPitches || 0) <= 65;

  const formScore = Number(rolling?.formScore);
  const recentForm =
    Number.isFinite(formScore)
      ? Math.max(0.7, Math.min(1.3, 1 + formScore * 0.06))
      : null;

  let velocityTrend = null;
  if (velo?.trend === "up" || Number(velo?.velocityDelta) >= 0.7) velocityTrend = "up";
  if (velo?.trend === "down" || Number(velo?.velocityDelta) <= -0.7) velocityTrend = "down";

  let handednessAdvantage = inferHandednessAdvantage(row, market);

  if (!handednessAdvantage && ptm?.tier === "positive") handednessAdvantage = "strong";
  if (!handednessAdvantage && ptm?.tier === "negative") handednessAdvantage = "weak";

  return {
    ...row,
    team,
    opponent,
    teamTotal: Number(teamOdds?.total ?? row.teamTotal ?? 0) || null,
    teamRunsPerGame: Number(teamCtx?.runsPerGame ?? 0) || null,
    opponentBullpenWeak,
    opponentBullpenElite,
    handednessAdvantage,
    recentForm,
    velocityTrend,
    hardHitRate: Number(
      ptm?.hitterProfile?.hardHitRate ??
      rolling?.metrics?.hardHitRate ??
      row.hardHitRate ??
      0
    ) || null,
    pitchTypeMatchupScore: Number(ptm?.score ?? 0) || null,
    pitchTypeMatchupTier: ptm?.tier ?? null
  };
}

module.exports = { applyPhase5ContextFields };
