const fs = require("fs");

const OUT = "data/context/confirmed-lineups-depth.json";
const DATE = process.argv[2] || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);

const TEAM_ABBR = {
  "Arizona Diamondbacks": "AZ", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE", "Colorado Rockies": "COL",
  "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM",
  "New York Yankees": "NYY", "Athletics": "ATH", "Oakland Athletics": "ATH",
  "Philadelphia Phillies": "PHI", "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD",
  "San Francisco Giants": "SF", "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL",
  "Tampa Bay Rays": "TB", "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR",
  "Washington Nationals": "WSH"
};

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

function abbr(name) {
  return TEAM_ABBR[name] || name;
}

function values(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x;
  if (typeof x === "object") return Object.values(x);
  return [];
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

const handedness = read("data/savant/handedness-splits.json", {});
const pitchMatchups = read("data/savant/pitch-type-matchups.json", {});
const board = read("outputs/priced-board.json", []);

function collectHandednessRows() {
  const out = [];
  for (const v of Object.values(handedness || {})) {
    if (Array.isArray(v)) out.push(...v);
    else if (v && typeof v === "object") out.push(...values(v));
  }
  return out.filter(x => x && typeof x === "object");
}

const handByName = new Map();
for (const r of collectHandednessRows()) {
  const k = keyName(r.player || r.name || r.fullName);
  if (!k) continue;
  const prev = handByName.get(k) || {};
  handByName.set(k, { ...prev, ...r });
}

const matchupByName = new Map();
for (const r of values(pitchMatchups.matchups || pitchMatchups.rows || pitchMatchups)) {
  const k = keyName(r.player || r.hitter || r.name);
  if (!k) continue;
  const prev = matchupByName.get(k) || {};
  matchupByName.set(k, { ...prev, ...r });
}

function boardRowsForPlayer(name) {
  const k = keyName(name);
  return board.filter(r => keyName(r.player || r.playerName || r.name) === k);
}

function enrichBatter({ player, team, battingOrder, battingHand }) {
  const k = keyName(player.name);
  const split = handByName.get(k) || {};
  const matchup = matchupByName.get(k) || {};
  const boardRows = boardRowsForPlayer(player.name);

  const inferredHand =
    battingHand ||
    player.batSide?.code ||
    player.batSide?.description?.[0] ||
    split.battingHand ||
    split.bats ||
    split.stand ||
    null;

  const avgVsPitcherHand = n(
    split.avgVsPitcherHand ??
    split.avg ??
    split.battingAvg ??
    split.avgAgainst ??
    null
  );

  const opsVsPitcherHand = n(
    split.opsVsPitcherHand ??
    split.ops ??
    null
  );

  const pmr = n(
    split.pmr ??
    split.pmrLite ??
    matchup.pmr ??
    matchup.pmrLite ??
    null
  );

  const pitchTypeRunValues =
    split.pitchTypeRunValues ||
    split.runValues ||
    matchup.pitchTypeRunValues ||
    matchup.runValues ||
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
    id: player.id,
    name: player.name,
    team,
    battingOrder,
    battingHand: inferredHand,
    avgVsPitcherHand,
    opsVsPitcherHand,
    pmr,
    pitchTypeRunValues,
    propMarketsAvailable: [...new Set(boardRows.map(r => r.stat || r.market).filter(Boolean))],
    enrichmentSources: {
      mlbLineup: true,
      savantHandedness: Boolean(split.player || split.name),
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
    battingSplitsAvailable: starters.filter(p => p.avgVsPitcherHand != null || p.opsVsPitcherHand != null).length,
    pmrAvailable: starters.filter(p => p.pmr != null).length,
    pitchTypeRunValuesAvailable: starters.filter(p => {
      const rv = p.pitchTypeRunValues || {};
      return Object.values(rv).some(v => v !== null && v !== undefined);
    }).length
  };
}

async function main() {
  const schedule = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}&hydrate=lineups,probablePitcher`);
  const teams = {};
  const games = {};

  for (const d of schedule.dates || []) {
    for (const game of d.games || []) {
      const away = abbr(game.teams.away.team.name);
      const home = abbr(game.teams.home.team.name);
      const gameKey = `${away}@${home}`;

      games[gameKey] = {
        gamePk: game.gamePk,
        game: gameKey,
        status: game.status?.detailedState || game.status?.abstractGameState,
        awayTeam: away,
        homeTeam: home
      };

      for (const side of ["away", "home"]) {
        const team = side === "away" ? away : home;
        const opponent = side === "away" ? home : away;
        const lineup = game.lineups?.[side]?.players || game.teams?.[side]?.lineup || [];

        const starters = values(lineup)
          .map((x, i) => {
            const person = x.person || x;
            return enrichBatter({
              player: {
                id: person.id,
                name: person.fullName || person.name || x.fullName || x.name,
                batSide: person.batSide || x.batSide
              },
              team,
              battingOrder: x.battingOrder || x.order || i + 1,
              battingHand: x.batSide?.code || person.batSide?.code || null
            });
          })
          .filter(p => p.name);

        const summary = summarize(starters);

        teams[team] = {
          team,
          opponent,
          gamePk: game.gamePk,
          game: gameKey,
          lineupStatus: starters.length >= 8 ? "confirmed_or_mlb_loaded" : "not_confirmed",
          starters,
          ...summary
        };
      }
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: "MLB Stats API schedule hydrate=lineups,probablePitcher + local Savant enrichment",
    games,
    teams
  };

  write(OUT, out);

  console.log("CONFIRMED LINEUPS DEPTH");
  console.log("=======================");
  console.log("Date:", DATE);
  console.log("Games:", Object.keys(games).length);
  console.log("Teams:", Object.keys(teams).length);
  console.log("Wrote", OUT);
  console.table(Object.values(teams).map(t => ({
    team: t.team,
    status: t.lineupStatus,
    starters: t.starters.length,
    L: t.lineupHandCounts.L,
    R: t.lineupHandCounts.R,
    S: t.lineupHandCounts.S,
    splits: t.battingSplitsAvailable,
    pmr: t.pmrAvailable,
    runValues: t.pitchTypeRunValuesAvailable
  })));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
