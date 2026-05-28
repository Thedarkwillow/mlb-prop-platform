import fs from 'fs';

const BOARD_IN = 'outputs/priced-board.json';
const BOARD_OUT = 'outputs/priced-board.json';
const REPORT_OUT = 'outputs/player-team-resolver-report.txt';

function inferSlateDate(board) {
  const dates = new Map();
  for (const r of board) {
    const raw = r.gameStart || r.game_start || r.startTime || r.commenceTime || r.start_time;
    if (!raw) continue;
    const d = String(raw).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dates.set(d, (dates.get(d) || 0) + 1);
  }
  return [...dates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || new Date().toISOString().slice(0, 10);
}
let DATE = process.argv[2] || null;

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
  const variants = [
    url,
    url.includes("/api/v1/game/") ? url.replace("/api/v1/game/", "/api/v1.1/game/") : null,
    url.includes("/boxscore") && !url.includes("?") ? `${url}?language=en` : null,
    url.includes("/api/v1/game/") && url.includes("/boxscore") && !url.includes("?")
      ? `${url.replace("/api/v1/game/", "/api/v1.1/game/")}?language=en`
      : null
  ].filter(Boolean);

  let lastErr = null;

  for (const candidate of [...new Set(variants)]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(candidate, {
          headers: {
            Accept: "application/json,text/plain,*/*",
            "User-Agent": "Mozilla/5.0 mlb-prop-platform"
          }
        });

        if (res.ok) return res.json();

        const text = await res.text().catch(() => "");
        lastErr = new Error(`${res.status} ${candidate}${text ? ` | ${text.slice(0, 120)}` : ""}`);

        if (res.status === 406 || res.status === 404) break;
      } catch (err) {
        lastErr = err;
      }

      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastErr || new Error(`fetch failed ${url}`);
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
  const nameKey = normName(playerName);
  const teamKey = normTeam(teamAbbr);
  const key = `${nameKey}|${teamKey}`;
  if (!nameKey || !teamKey) return;
  map.set(key, {
    player: playerName,
    team: teamKey,
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

    let box = null;
    try {
      box = await getBoxscore(g.gamePk);
    } catch (err) {
      console.warn(`WARN: skipping boxscore gamePk ${g.gamePk}: ${err && err.message ? err.message : err}`);
      continue;
    }

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
  DATE = DATE || inferSlateDate(board);
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

    const sourceTeam = normTeam(row.team);

    const hit = playerTeamMap.get(`${normName(row.player)}|${sourceTeam}`) || null;

    if (!hit) {
      unresolved++;
      return {
        ...row,
        teamResolved: false,
        teamResolverStatus: 'unresolved_or_team_mismatch',
        teamValid: false,
        rankEligible: false,
        disabledReason: `player/team unresolved or mismatch: ${row.player} ${sourceTeam}`
      };
    }

    resolved++;

    const oldTeam = sourceTeam;
    const trueTeam = normTeam(hit.team);
    const trueGame = hit.game;

    // Safety: never silently move a player to a different team.
    // If source team conflicts with resolver team, block the row.
    if (oldTeam && trueTeam && oldTeam !== trueTeam) {
      unresolved++;
      return {
        ...row,
        resolvedTeam: trueTeam,
        resolvedGame: trueGame,
        resolvedGamePk: hit.gamePk,
        teamResolved: false,
        teamResolverStatus: 'team_conflict',
        teamValid: false,
        rankEligible: false,
        disabledReason: `source team ${oldTeam} conflicts with resolver team ${trueTeam}`
      };
    }

    const needsCorrection =
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
