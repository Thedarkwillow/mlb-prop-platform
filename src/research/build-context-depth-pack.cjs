const fs = require("fs");

const OUT = "data/context/context-depth-pack.json";

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
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function n(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function avg(arr) {
  const xs = arr.map(Number).filter(Number.isFinite);
  return xs.length ? xs.reduce((a,b)=>a+b,0) / xs.length : null;
}

function keyName(v) {
  return String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

const gameModel = read("data/context/game-model-context.json", {});
const bullpenFatigue = read("data/context/bullpen-fatigue.json", {});
const pitcherStats = read("data/context/pitcher-stat-table.json", {});
const pitcherAdvanced = read("data/context/pitcher-context-advanced.json", {});
const lineups = read("data/context/lineups.json", {});
const handedness = read("data/savant/handedness-splits.json", {});
const pitchMatchups = read("data/savant/pitch-type-matchups.json", {});
const teamForm = read("data/context/team-form-context.json", {});
const bullpenDepth = read("data/context/bullpen-depth.json", {});
const lineupDepth = read("data/context/lineup-depth.json", {});
const gameOdds = read("data/context/game-odds-context.json", {});
const oddsBoard = read("outputs/priced-board.json", []);

const games = gameModel.games || {};
const teams = gameModel.teams || {};

function values(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") return Object.values(x);
  return [];
}

const pitcherStatRows = values(pitcherStats.pitchers || pitcherStats.players || pitcherStats.rows || pitcherStats);
const pitcherAdvRows = values(pitcherAdvanced.pitchers || pitcherAdvanced.players || pitcherAdvanced.rows || pitcherAdvanced);
const matchupRows = values(pitchMatchups.matchups || pitchMatchups.rows || pitchMatchups);

const pitcherStatByName = new Map();
for (const r of pitcherStatRows) pitcherStatByName.set(keyName(r.name || r.player), r);

const pitcherAdvByName = new Map();
for (const r of pitcherAdvRows) pitcherAdvByName.set(keyName(r.name || r.player), r);

function enrichPitcher(sp) {
  if (!sp?.name) return sp || null;
  const k = keyName(sp.name);
  const stat = pitcherStatByName.get(k) || {};
  const adv = pitcherAdvByName.get(k) || {};

  return {
    ...sp,
    era: n(stat.era ?? sp.era),
    whip: n(stat.whip ?? sp.whip),
    fip: n(stat.fip ?? sp.fip),
    xfip: n(stat.xfip ?? sp.xfip),
    kRate: n(stat.kRate ?? stat.kPct ?? adv.kRate ?? sp.kRate),
    bbRate: n(stat.bbRate ?? stat.bbPct ?? adv.bbRate ?? sp.bbRate),
    avgAgainst: n(stat.avgAgainst ?? sp.avgAgainst),
    chaseRate: n(stat.chaseRate ?? adv.chaseRate),
    swingMissRate: n(stat.swingMissRate ?? adv.swingMissRate ?? adv.whiffRate),
    gbFb: n(stat.gbFb ?? adv.gbFb),
    pmr: n(stat.pmr ?? adv.pmr ?? adv.pmrLite),
    pitchMix: stat.pitchMix || adv.pitchMix || sp.pitchMix || sp.arsenal?.pitchTypes || {},
    homeAwaySplits: stat.homeAwaySplits || {
      home: stat.home || null,
      away: stat.away || null
    },
    handednessSplits: stat.handednessSplits || {
      vsLHH: stat.vsLHH || stat.vsLHB || null,
      vsRHH: stat.vsRHH || stat.vsRHB || null
    },
    contextFlags: adv.contextFlags || sp.contextFlags || []
  };
}

function bullpenForTeam(team) {
  const fat = bullpenFatigue.teams?.[team] || bullpenFatigue[team] || {};
  const base = teams[team]?.bullpen || {};
  const depth = bullpenDepth.teams?.[team] || {};

  return {
    team,
    seasonRanks: {
      eraRank: n(depth.bullpenEraRank ?? base.seasonRanks?.eraRank ?? base.bullpenEraRank ?? base.eraRank),
      whipRank: n(depth.bullpenWhipRank ?? base.seasonRanks?.whipRank ?? base.bullpenWhipRank ?? base.whipRank)
    },
    bullpenEra: n(depth.bullpenEra ?? base.bullpenEra),
    bullpenWhip: n(depth.bullpenWhip ?? base.bullpenWhip),
    fatigue: fat.fatigue || base.fatigue || null,
    pitchCountLast2Days: n(fat.pitchCountLast2Days ?? base.pitchCountLast2Days),
    last3DaysReliefPitches: n(fat.last3DaysReliefPitches ?? base.last3DaysReliefPitches),
    backToBackRelievers: n(fat.backToBackRelievers ?? base.backToBackRelievers),
    relieverAppearances: n(depth.relieverAppearances ?? fat.relieverAppearances ?? base.relieverAppearances),
    recentPitches: n(depth.recentPitches),
    relievers: depth.relievers || base.relievers || [],
    riskScore: (() => {
      const pitches = n(fat.pitchCountLast2Days ?? fat.last3DaysReliefPitches ?? depth.recentPitches, 0);
      const b2b = n(fat.backToBackRelievers, 0);
      return Math.max(0, Math.min(1, pitches / 220 + b2b / 12));
    })()
  };
}

function normalizePitchTypeMatchups(gameKey) {
  const rows = matchupRows.filter(r =>
    String(r.gameKey || r.game || "").includes(gameKey) ||
    String(gameKey).includes(String(r.gameKey || r.game || "__none__"))
  );

  return rows.map(r => ({
    player: r.player || r.hitter || null,
    pitcher: r.pitcher || null,
    matchupScore: n(r.matchupScore ?? r.edgeScore ?? r.pitchTypeEdge),
    pitchTypes: {
      FB: n(r.FB ?? r.ff ?? r.fourSeam),
      CT: n(r.CT ?? r.cutter),
      SP: n(r.SP ?? r.splitter),
      SI: n(r.SI ?? r.sinker),
      SL: n(r.SL ?? r.slider),
      CU: n(r.CU ?? r.curve),
      KC: n(r.KC ?? r.knuckleCurve),
      CH: n(r.CH ?? r.changeup)
    },
    raw: r
  }));
}

function boardTeamRows(team) {
  return oddsBoard.filter(r => String(r.team || r.playerTeam || "").toUpperCase() === team);
}

function teamMarketContext(team) {
  const rows = boardTeamRows(team);
  const odds = gameOdds.teams?.[team] || {};
  const moneylines = rows.map(r => n(r.moneyline ?? r.ml ?? r.consensusMoneyline)).filter(Number.isFinite);
  const totals = rows.map(r => n(r.total ?? r.gameTotal ?? r.consensusTotal)).filter(Number.isFinite);

  return {
    moneyline: n(odds.moneyline ?? avg(moneylines), null),
    total: n(odds.total ?? avg(totals), null),
    marketRows: rows.length
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  recordType: "context_depth_pack_v1",
  games: {},
  teams: {}
};

for (const [team, rec] of Object.entries(teams)) {
  out.teams[team] = {
    team,
    opponent: rec.teamContext?.opponent || null,
    gamePk: rec.teamContext?.gamePk || rec.startingPitcher?.gamePk || null,
    teamContext: {
      ...rec.teamContext,
      ...(lineupDepth.teams?.[team] || {}),
      ...teamMarketContext(team),
      winRate: teamForm.teams?.[team]?.winRate ?? rec.teamContext?.winRate ?? null,
      homeWinRate: teamForm.teams?.[team]?.homeWinRate ?? rec.teamContext?.homeWinRate ?? null,
      awayWinRate: teamForm.teams?.[team]?.awayWinRate ?? rec.teamContext?.awayWinRate ?? null,
      last3WinRate: teamForm.teams?.[team]?.last3WinRate ?? rec.teamContext?.last3WinRate ?? null,
      runsPerGame: teamForm.teams?.[team]?.runsPerGame ?? rec.teamContext?.runsPerGame ?? null,
      homeRunsPerGame: teamForm.teams?.[team]?.homeRunsPerGame ?? rec.teamContext?.homeRunsPerGame ?? null,
      awayRunsPerGame: teamForm.teams?.[team]?.awayRunsPerGame ?? rec.teamContext?.awayRunsPerGame ?? null,
      last3RunsPerGame: teamForm.teams?.[team]?.last3RunsPerGame ?? rec.teamContext?.last3RunsPerGame ?? null,
      f5RunsPerGame: teamForm.teams?.[team]?.f5RunsPerGame ?? rec.teamContext?.f5RunsPerGame ?? null,
      homeF5RunsPerGame: teamForm.teams?.[team]?.homeF5RunsPerGame ?? rec.teamContext?.homeF5RunsPerGame ?? null,
      awayF5RunsPerGame: teamForm.teams?.[team]?.awayF5RunsPerGame ?? rec.teamContext?.awayF5RunsPerGame ?? null,
      last3F5RunsPerGame: teamForm.teams?.[team]?.last3F5RunsPerGame ?? rec.teamContext?.last3F5RunsPerGame ?? null
    },
    startingPitcher: enrichPitcher(rec.startingPitcher),
    bullpen: bullpenForTeam(team)
  };
}

for (const [gameKey, g] of Object.entries(games)) {
  out.games[gameKey] = {
    gamePk: g.gamePk,
    game: g.game,
    status: g.status,
    awayTeam: g.awayTeam,
    homeTeam: g.homeTeam,
    marketContext: g.marketContext || {},
    away: out.teams[g.awayTeam] || g.away,
    home: out.teams[g.homeTeam] || g.home,
    pitchTypeMatchups: normalizePitchTypeMatchups(gameKey)
  };
}

write(OUT, out);

console.log("CONTEXT DEPTH PACK V1");
console.log("=====================");
console.log("Games:", Object.keys(out.games).length);
console.log("Teams:", Object.keys(out.teams).length);
console.log("Wrote", OUT);

const summary = Object.values(out.teams).map(t => ({
  team: t.team,
  pitcher: t.startingPitcher?.name || null,
  era: t.startingPitcher?.era ?? null,
  whip: t.startingPitcher?.whip ?? null,
  pmr: t.startingPitcher?.pmr ?? null,
  pitchMix: Object.keys(t.startingPitcher?.pitchMix || {}).length,
  bullpenFatigue: t.bullpen?.fatigue || null,
  bullpenRisk: t.bullpen?.riskScore ?? null,
  moneyline: t.teamContext?.moneyline ?? null,
  total: t.teamContext?.total ?? null
}));

console.table(summary);
