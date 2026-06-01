const fs = require("fs");

const OUT = "data/context/confirmed-lineups-depth.json";
const DATE = process.argv[2] || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function read(path, fallback = null) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
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

const handedness = read("data/savant/handedness-splits.json", {});
const pitchMatchups = read("data/savant/pitch-type-matchups.json", {});
const pitcherHands = read("data/context/probable-pitcher-hands.json", {});
const board = read("outputs/priced-board.json", []);
const lineups = read("data/context/lineups.json", {});

const handByName = new Map();

for (const [k, r] of Object.entries(handedness.batters || {})) {
  if (!r || typeof r !== "object") continue;
  const key = keyName(r.player || r.name || k);
  if (!key) continue;
  handByName.set(key, r);
}

for (const r of values(handedness.rows || handedness.batterRows || [])) {
  const key = keyName(r.player || r.name || r.fullName);
  if (!key) continue;
  const prev = handByName.get(key) || {};
  handByName.set(key, { ...prev, ...r });
}

const matchupByPlayer = new Map();
for (const r of values(pitchMatchups.matchups || pitchMatchups.rows || pitchMatchups)) {
  if (!r || typeof r !== "object") continue;
  const key = keyName(r.player || r.hitter || r.name);
  if (!key) continue;
  const arr = matchupByPlayer.get(key) || [];
  arr.push(r);
  matchupByPlayer.set(key, arr);
}

function boardRowsForPlayer(name) {
  const k = keyName(name);
  return values(board).filter(r => keyName(r.player || r.playerName || r.name) === k);
}

function getOpponentPitcherInfo(team, gamePk, side) {
  const direct = pitcherHands.opponentPitcherByTeam?.[team];
  if (direct) {
    if (typeof direct === "string") return { hand: direct, name: null };
    return {
      hand: direct.hand || direct.pitcherHand || direct.opponentPitcherHand || null,
      name: direct.name || direct.pitcher || direct.opponentPitcher || null
    };
  }

  for (const g of Object.values(pitcherHands.games || {})) {
    if (gamePk && Number(g.gamePk) !== Number(gamePk)) continue;

    if (g.awayTeam === team) {
      return {
        hand: g.homePitcherHand || null,
        name: g.homeProbablePitcher || null
      };
    }

    if (g.homeTeam === team) {
      return {
        hand: g.awayPitcherHand || null,
        name: g.awayProbablePitcher || null
      };
    }
  }

  if (side === "away") {
    for (const g of Object.values(pitcherHands.games || {})) {
      if (gamePk && Number(g.gamePk) === Number(gamePk)) {
        return { hand: g.homePitcherHand || null, name: g.homeProbablePitcher || null };
      }
    }
  }

  if (side === "home") {
    for (const g of Object.values(pitcherHands.games || {})) {
      if (gamePk && Number(g.gamePk) === Number(gamePk)) {
        return { hand: g.awayPitcherHand || null, name: g.awayProbablePitcher || null };
      }
    }
  }

  return { hand: null, name: null };
}

function chooseSplit(splitRow, opponentPitcherHand) {
  const hand = String(opponentPitcherHand || "").toUpperCase();

  if (hand === "L" && splitRow?.vsLHP) {
    return { label: "vsLHP", row: splitRow.vsLHP };
  }

  if (hand === "R" && splitRow?.vsRHP) {
    return { label: "vsRHP", row: splitRow.vsRHP };
  }

  if (splitRow?.vsRHP) return { label: "vsRHP_fallback", row: splitRow.vsRHP };
  if (splitRow?.vsLHP) return { label: "vsLHP_fallback", row: splitRow.vsLHP };

  return { label: null, row: null };
}

function choosePitchMatchup(playerKey, opponentPitcherName) {
  const rows = matchupByPlayer.get(playerKey) || [];
  if (!rows.length) return {};

  const oppKey = keyName(opponentPitcherName);
  if (oppKey) {
    const exact = rows.find(r => keyName(r.opponentPitcher || r.pitcher || r.pitcherName) === oppKey);
    if (exact) return exact;
  }

  return rows[0] || {};
}

function enrichBatter({ player, team, battingOrder, battingHand, position, game, gamePk, side, source, status }) {
  const k = keyName(player.name);
  const split = handByName.get(k) || {};
  const oppPitcher = getOpponentPitcherInfo(team, gamePk, side);
  const selectedSplit = chooseSplit(split, oppPitcher.hand);
  const matchup = choosePitchMatchup(k, oppPitcher.name);
  const boardRows = boardRowsForPlayer(player.name);

  const inferredHand =
    battingHand ||
    player.batSide?.code ||
    player.batSide?.description?.[0] ||
    split.battingHand ||
    split.bats ||
    split.stand ||
    null;

  const sr = selectedSplit.row || {};

  const pitchTypeRunValues =
    split.pitchTypeRunValues ||
    split.runValues ||
    matchup.pitchTypeRunValues ||
    matchup.runValues ||
    matchup.pitchTypes ||
    {
      FB: n(matchup.FB ?? matchup.ff ?? matchup.fourSeam),
      CT: n(matchup.CT ?? matchup.cutter),
      SP: n(matchup.SP ?? matchup.splitter),
      SI: n(matchup.SI ?? matchup.sinker),
      SL: n(matchup.SL ?? matchup.slider),
      CU: n(matchup.CU ?? matchup.curve),
      KC: n(matchup.KC ?? matchup.knuckleCurve),
      CH: n(matchup.CH ?? matchup.changeup)
    };

  return {
    id: player.id || null,
    name: player.name,
    team,
    battingOrder: battingOrder ?? null,
    position: position || null,
    game: game || null,
    gamePk: gamePk || null,
    side: side || null,
    status: status || null,
    source: source || null,

    opponentPitcher: oppPitcher.name || null,
    opponentPitcherHand: oppPitcher.hand || null,

    battingHand: inferredHand,
    splitUsed: selectedSplit.label,
    splitPA: n(sr.pa),
    splitPitches: n(sr.pitches),

    avgVsPitcherHand: n(sr.ba ?? split.avgVsPitcherHand ?? split.avg ?? split.battingAvg ?? split.avgAgainst),
    slgVsPitcherHand: n(sr.slg),
    wobaVsPitcherHand: n(sr.woba),
    xbaVsPitcherHand: n(sr.xba),
    xslgVsPitcherHand: n(sr.xslg),
    xwobaVsPitcherHand: n(sr.xwoba),
    kRateVsPitcherHand: n(sr.kRate),
    bbRateVsPitcherHand: n(sr.bbRate),
    whiffRateVsPitcherHand: n(sr.whiffRate),
    hardHitRateVsPitcherHand: n(sr.hardHitRate),
    barrelRateVsPitcherHand: n(sr.barrelRate),

    opsVsPitcherHand: n(split.opsVsPitcherHand ?? split.ops),
    pmr: n(split.pmr ?? split.pmrLite ?? matchup.pmr ?? matchup.pmrLite),
    pitchTypeRunValues,

    pitchTypeMatchupScore: n(matchup.score),
    pitchTypeMatchupTier: matchup.tier || null,
    pitchTypeMatchupFlags: matchup.flags || [],

    propMarketsAvailable: [...new Set(boardRows.map(r => r.stat || r.market).filter(Boolean))],
    enrichmentSources: {
      mlbLineup: true,
      savantHandedness: Boolean(split.player || split.playerKey || selectedSplit.row),
      pitcherHand: Boolean(oppPitcher.hand),
      pitchTypeMatchup: Boolean(matchup.player || matchup.hitter || matchup.name),
      prizepicksBoard: boardRows.length > 0
    }
  };
}

function summarize(starters) {
  const counts = { L: 0, R: 0, S: 0, unknown: 0, total: starters.length, known: 0 };

  for (const p of starters) {
    const h = String(p.battingHand || "").toUpperCase();
    if (["L", "R", "S"].includes(h)) {
      counts[h]++;
      counts.known++;
    } else {
      counts.unknown++;
    }
  }

  return {
    lineupHandCounts: counts,
    pitcherHandAvailable: starters.filter(p => p.opponentPitcherHand).length,
    battingSplitsAvailable: starters.filter(p => p.avgVsPitcherHand != null || p.xwobaVsPitcherHand != null).length,
    pmrAvailable: starters.filter(p => p.pmr != null).length,
    pitchTypeRunValuesAvailable: starters.filter(p => {
      const rv = p.pitchTypeRunValues || {};
      return Object.values(rv).some(v => v !== null && v !== undefined);
    }).length
  };
}

function normalizePlayerRow(row) {
  return {
    player: row.player || row.playerName || row.name || null,
    id: row.id || row.playerId || null,
    team: row.team || null,
    status: row.status || null,
    battingOrder: row.battingOrder ?? row.order ?? row.lineupSpot ?? null,
    position: row.position || row.pos || null,
    game: row.game || null,
    gamePk: row.gamePk || null,
    side: row.side || null,
    source: row.source || null,
    battingHand: row.battingHand || row.batSide || row.hand || null
  };
}

function main() {
  const localPlayers = values(lineups.players || {})
    .map(normalizePlayerRow)
    .filter(r => r.player && r.team);

  const teams = {};
  const games = {};

  for (const [team, meta] of Object.entries(lineups.teams || {})) {
    teams[team] = {
      team,
      opponent: null,
      gamePk: meta.gamePk || null,
      game: meta.game || null,
      lineupStatus: meta.status || "unknown",
      starters: [],
      lineupHandCounts: { L: 0, R: 0, S: 0, unknown: 0, total: 0, known: 0 },
      pitcherHandAvailable: 0,
      battingSplitsAvailable: 0,
      pmrAvailable: 0,
      pitchTypeRunValuesAvailable: 0
    };
  }

  for (const row of localPlayers) {
    const team = row.team;

    if (!teams[team]) {
      teams[team] = {
        team,
        opponent: null,
        gamePk: row.gamePk || null,
        game: row.game || null,
        lineupStatus: "unknown",
        starters: [],
        lineupHandCounts: { L: 0, R: 0, S: 0, unknown: 0, total: 0, known: 0 },
        pitcherHandAvailable: 0,
        battingSplitsAvailable: 0,
        pmrAvailable: 0,
        pitchTypeRunValuesAvailable: 0
      };
    }

    teams[team].gamePk = teams[team].gamePk || row.gamePk || null;
    teams[team].game = teams[team].game || row.game || null;

    teams[team].starters.push(enrichBatter({
      player: {
        id: row.id,
        name: row.player
      },
      team,
      battingOrder: row.battingOrder,
      battingHand: row.battingHand,
      position: row.position,
      game: row.game,
      gamePk: row.gamePk,
      side: row.side,
      source: row.source,
      status: row.status
    }));
  }

  for (const team of Object.keys(teams)) {
    teams[team].starters.sort((a, b) => {
      const ao = Number(a.battingOrder || 999);
      const bo = Number(b.battingOrder || 999);
      if (ao !== bo) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    teams[team].lineupStatus =
      teams[team].starters.length >= 8
        ? "confirmed_or_mlb_loaded"
        : teams[team].lineupStatus === "confirmed"
          ? "confirmed_missing_starters"
          : "not_confirmed";

    Object.assign(teams[team], summarize(teams[team].starters));
  }

  for (const row of localPlayers) {
    const gameKey = row.gamePk ? String(row.gamePk) : String(row.game || "unknown");

    if (!games[gameKey]) {
      games[gameKey] = {
        gamePk: row.gamePk || null,
        game: row.game || null,
        status: null,
        awayTeam: null,
        homeTeam: null,
        teams: []
      };
    }

    if (!games[gameKey].teams.includes(row.team)) games[gameKey].teams.push(row.team);
  }

  for (const g of Object.values(games)) {
    const teamRows = localPlayers.filter(r => {
      if (g.gamePk && Number(r.gamePk) === Number(g.gamePk)) return true;
      return r.game === g.game;
    });

    const away = teamRows.find(r => r.side === "away")?.team || null;
    const home = teamRows.find(r => r.side === "home")?.team || null;

    g.awayTeam = away;
    g.homeTeam = home;

    if (away && home) {
      teams[away].opponent = home;
      teams[home].opponent = away;
      g.game = `${away}@${home}`;
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: "local data/context/lineups.json primary + Savant handedness splits + probable pitcher hands",
    sourceLineupsRefreshedAt: lineups.refreshedAt || null,
    games,
    teams
  };

  write(OUT, out);

  console.log("CONFIRMED LINEUPS DEPTH");
  console.log("=======================");
  console.log("Date:", DATE);
  console.log("Local lineup players:", localPlayers.length);
  console.log("Games:", Object.keys(games).length);
  console.log("Teams:", Object.keys(teams).length);
  console.log("Wrote", OUT);

  console.table(Object.values(teams).map(t => ({
    team: t.team,
    status: t.lineupStatus,
    starters: t.starters.length,
    pitcherHand: t.pitcherHandAvailable,
    splits: t.battingSplitsAvailable,
    pmr: t.pmrAvailable,
    runValues: t.pitchTypeRunValuesAvailable,
    L: t.lineupHandCounts.L,
    R: t.lineupHandCounts.R,
    S: t.lineupHandCounts.S
  })));
}

main();
