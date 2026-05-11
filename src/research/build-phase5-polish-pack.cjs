const fs = require("fs");

const OUT = "data/context/phase5-polish-pack.json";

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
  const x = Number(String(v).replace("%", "").replace(",", ""));
  return Number.isFinite(x) ? x : fallback;
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

function first(...xs) {
  for (const x of xs) {
    if (x !== null && x !== undefined && x !== "") return x;
  }
  return null;
}

const board = read("outputs/priced-board.json", []);
const handedness = read("data/savant/handedness-splits.json", {});
const pitchMatchups = read("data/savant/pitch-type-matchups.json", {});
const ballpark = read("data/ballpark-latest.json", []);
const confirmed = read("data/context/confirmed-lineups-depth.json", {});
const lineupDepth = read("data/context/lineup-depth.json", {});
const depth = read("data/context/context-depth-pack.json", {});

function collectHandRows() {
  const rows = [];
  for (const v of Object.values(handedness || {})) {
    if (Array.isArray(v)) rows.push(...v);
    else if (v && typeof v === "object") rows.push(...values(v));
  }
  return rows.filter(r => r && typeof r === "object");
}

function collectPitchRows() {
  return values(pitchMatchups.matchups || pitchMatchups.rows || pitchMatchups)
    .filter(r => r && typeof r === "object");
}

function normalizePitchTypes(r = {}) {
  return {
    FB: n(first(r.FB, r.ff, r.FF, r.fourSeam, r.fastball, r["4-Seam Fastball"])),
    CT: n(first(r.CT, r.cutter, r.Cutter)),
    SP: n(first(r.SP, r.splitter, r.Splitter, r.splitFinger)),
    SI: n(first(r.SI, r.sinker, r.Sinker)),
    SL: n(first(r.SL, r.slider, r.Slider)),
    CU: n(first(r.CU, r.curve, r.curveball, r.Curveball)),
    KC: n(first(r.KC, r.knuckleCurve, r["Knuckle Curve"])),
    CH: n(first(r.CH, r.changeup, r.Changeup))
  };
}

const batterByName = {};
for (const r of collectHandRows()) {
  const name = first(r.player, r.name, r.fullName);
  const k = keyName(name);
  if (!k) continue;

  const prev = batterByName[k] || {};
  batterByName[k] = {
    ...prev,
    name: name || prev.name,
    battingHand: first(r.battingHand, r.bats, r.stand, r.hand, prev.battingHand),
    vsLHP: {
      avg: n(first(r.vsLHP_avg, r.avgVsLHP, r.vsL_avg, r.vLAVG, r.avg)),
      ops: n(first(r.vsLHP_ops, r.opsVsLHP, r.vsL_ops, r.vLOPS, r.ops)),
      xwoba: n(first(r.vsLHP_xwoba, r.vsLHP_xwoba, r.vLxwOBA, r.xwoba)),
      xslg: n(first(r.vsLHP_xslg, r.vLxSLG, r.xslg)),
      whiffRate: n(first(r.vsLHP_whiffRate, r.whiffRate, r.whiff)),
      chaseRate: n(first(r.vsLHP_chaseRate, r.chaseRate))
    },
    vsRHP: {
      avg: n(first(r.vsRHP_avg, r.avgVsRHP, r.vsR_avg, r.vRAVG, r.avg)),
      ops: n(first(r.vsRHP_ops, r.opsVsRHP, r.vsR_ops, r.vROPS, r.ops)),
      xwoba: n(first(r.vsRHP_xwoba, r.vsRHP_xwoba, r.vRxwOBA, r.xwoba)),
      xslg: n(first(r.vsRHP_xslg, r.vRxSLG, r.xslg)),
      whiffRate: n(first(r.vsRHP_whiffRate, r.whiffRate, r.whiff)),
      chaseRate: n(first(r.vsRHP_chaseRate, r.chaseRate))
    },
    source: "savant_handedness_normalized"
  };
}

const pitchTypeByName = {};
for (const r of collectPitchRows()) {
  const name = first(r.player, r.hitter, r.name);
  const k = keyName(name);
  if (!k) continue;
  const rv = normalizePitchTypes(r);

  pitchTypeByName[k] = {
    name,
    pitcher: first(r.pitcher, r.opposingPitcher),
    matchupScore: n(first(r.matchupScore, r.edgeScore, r.pitchTypeEdge)),
    pitchTypeRunValues: rv,
    availablePitchTypes: Object.entries(rv).filter(([, v]) => v !== null).map(([k]) => k),
    source: "pitch_type_matchup_normalized"
  };
}

function weatherFromBallparkRow(r) {
  const bp = r.ballpark || r;
  return {
    temp: n(first(bp.temperature, bp.temp, bp.gameTemp)),
    precip: n(first(bp.precip, bp.precipitation, bp.rainChance)),
    wind: n(first(bp.windSpeed, bp.wind, bp.wind_mph)),
    weatherSummary: first(bp.weather, bp.weatherSummary, bp.conditions),
    source: bp.source || "ballpark"
  };
}

const weatherByGame = {};
for (const r of values(ballpark)) {
  const game = first(r.game, r.gameKey, r.matchup);
  if (!game) continue;
  const wx = weatherFromBallparkRow(r);
  weatherByGame[game] ||= wx;
}

for (const r of board) {
  const game = first(r.game, r.gameKey);
  if (!game || weatherByGame[game]) continue;
  const wx = weatherFromBallparkRow(r);
  if (wx.temp !== null || wx.precip !== null || wx.weatherSummary) weatherByGame[game] = wx;
}

const lineupByTeam = {};
for (const [team, rec] of Object.entries(lineupDepth.teams || {})) {
  lineupByTeam[team] = {
    team,
    status: rec.lineupStatus,
    starters: rec.starters || [],
    source: "lineup_depth_inferred"
  };
}

for (const [team, rec] of Object.entries(confirmed.teams || {})) {
  if ((rec.starters || []).length >= 8) {
    lineupByTeam[team] = {
      team,
      status: rec.lineupStatus,
      starters: rec.starters,
      source: "confirmed_lineups_depth"
    };
  }
}

const byPlayer = {};
for (const r of board.filter(r => r.recordType === "merged_prop")) {
  const k = keyName(r.player || r.playerName || r.name);
  if (!k) continue;

  byPlayer[k] ||= {
    player: r.player || r.playerName || r.name,
    team: String(r.team || r.playerTeam || "").toUpperCase(),
    batter: batterByName[k] || null,
    pitchTypes: pitchTypeByName[k] || null
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  recordType: "phase5_polish_pack_v1",
  coverage: {
    boardPlayers: Object.keys(byPlayer).length,
    batterSplits: Object.values(byPlayer).filter(x => x.batter).length,
    pitchTypeRunValues: Object.values(byPlayer).filter(x => x.pitchTypes?.availablePitchTypes?.length).length,
    weatherGames: Object.keys(weatherByGame).length,
    lineupTeams: Object.keys(lineupByTeam).length,
    confirmedLineupTeams: Object.values(lineupByTeam).filter(x => x.source === "confirmed_lineups_depth").length
  },
  byPlayer,
  batterByName,
  pitchTypeByName,
  weatherByGame,
  lineupByTeam,
  notes: [
    "Confirmed lineups only populate when source provides 8+ starters.",
    "Weather verification currently cross-checks available Ballpark/local board weather fields.",
    "Pitch-type run values are normalized to FB/CT/SP/SI/SL/CU/KC/CH where available."
  ]
};

write(OUT, out);

console.log("PHASE 5 POLISH PACK");
console.log("===================");
console.log("Wrote", OUT);
console.table([out.coverage]);
