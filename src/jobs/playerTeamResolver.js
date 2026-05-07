import fs from 'fs';

const BOARD_IN = 'outputs/priced-board.json';
const BOARD_OUT = 'outputs/priced-board.json';
const REPORT_OUT = 'outputs/player-team-resolver-report.txt';

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

function read(path, fallback = []) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function write(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function normName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normTeam(v) {
  return String(v || '').trim().toUpperCase();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function getSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team`;
  const data = await fetchJson(url);
  return data.dates?.[0]?.games || [];
}

async function getBoxscore(gamePk) {
  return fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
}

function addPlayer(map, playerName, teamAbbr, game, gamePk) {
  const key = normName(playerName);
  if (!key || !teamAbbr) return;

  map.set(key, {
    player: playerName,
    team: normTeam(teamAbbr),
    game,
    gamePk
  });
}

async function buildPlayerTeamMap(date) {
  const games = await getSchedule(date);
  const map = new Map();

  for (const g of games) {
    const away = g.teams?.away?.team?.abbreviation;
    const home = g.teams?.home?.team?.abbreviation;
    const game = `${away} @ ${home}`;

    const box = await getBoxscore(g.gamePk);

    for (const side of ['away', 'home']) {
      const teamAbbr = side === 'away' ? away : home;
      const players = box.teams?.[side]?.players || {};

      for (const id of Object.keys(players)) {
        const p = players[id];
        addPlayer(map, p.person?.fullName, teamAbbr, game, g.gamePk);
      }
    }
  }

  return map;
}

function isComboPlayer(name) {
  return String(name || '').includes('+');
}

function mainGameIncludesTeam(row, team) {
  const g = String(row.game || '');
  if (!g.includes('@')) return false;
  return g.split('@').map(x => normTeam(x)).includes(normTeam(team));
}

async function main() {
  const board = read(BOARD_IN, []);
  const playerTeamMap = await buildPlayerTeamMap(DATE);

  let props = 0;
  let resolved = 0;
  let corrected = 0;
  let invalid = 0;
  let unresolved = 0;
  let combos = 0;

  const out = board.map(row => {
    if (row.recordType !== 'merged_prop') return row;
    props++;

    if (isComboPlayer(row.player)) {
      combos++;
      return {
        ...row,
        teamResolved: false,
        teamResolverStatus: 'combo_player_skip',
        teamValid: false,
        rankEligible: false,
        disabledReason: 'combo player team resolver skip'
      };
    }

    const hit = playerTeamMap.get(normName(row.player));

    if (!hit) {
      unresolved++;
      return {
        ...row,
        teamResolved: false,
        teamResolverStatus: 'unresolved',
        teamValid: false,
        rankEligible: false,
        disabledReason: 'player team unresolved'
      };
    }

    resolved++;

    const oldTeam = normTeam(row.team);
    const trueTeam = normTeam(hit.team);
    const trueGame = hit.game;

    const needsCorrection =
      oldTeam !== trueTeam ||
      String(row.game || '') !== trueGame ||
      row.gamePk !== hit.gamePk;

    let next = {
      ...row,
      resolvedTeam: trueTeam,
      resolvedGame: trueGame,
      resolvedGamePk: hit.gamePk,
      teamResolved: true,
      teamResolverStatus: needsCorrection ? 'corrected' : 'ok',
      teamValid: true,
      team: trueTeam,
      game: trueGame,
      gamePk: hit.gamePk
    };

    if (needsCorrection) corrected++;

    if (!mainGameIncludesTeam(next, trueTeam)) {
      invalid++;
      next = {
        ...next,
        teamValid: false,
        rankEligible: false,
        disabledReason: 'resolved team not in game'
      };
    }

    return next;
  });

  write(BOARD_OUT, out);

  const report = [
    'PLAYER TEAM RESOLVER REPORT',
    `Date: ${DATE}`,
    `Board rows: ${board.length}`,
    `Merged props: ${props}`,
    `MLB players mapped: ${playerTeamMap.size}`,
    `Resolved props: ${resolved}`,
    `Corrected props: ${corrected}`,
    `Unresolved props: ${unresolved}`,
    `Combo skipped: ${combos}`,
    `Invalid after resolve: ${invalid}`
  ].join('\n');

  fs.writeFileSync(REPORT_OUT, report);
  console.log(report);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
