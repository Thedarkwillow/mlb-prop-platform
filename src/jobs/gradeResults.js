import fs from 'fs';

const BOARD_FILE = 'outputs/merged-board.json';
const OUT_FILE = 'outputs/graded-results.json';

function clean(v) {
  return String(v ?? '').trim();
}

function normName(v) {
  return clean(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function slateDate() {
  return new Date().toISOString().slice(0, 10);
}

function grade(actual, line, side) {
  if (actual === null || line === null || !side) return 'UNAVAILABLE';

  if (actual === line) return 'PUSH';

  if (side === 'MORE') {
    return actual > line ? 'HIT' : 'MISS';
  }

  if (side === 'LESS') {
    return actual < line ? 'HIT' : 'MISS';
  }

  return 'UNAVAILABLE';
}

async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed ${res.status}: ${url}`);
  }

  return res.json();
}

async function getSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`;
  return fetchJson(url);
}

async function getBoxscore(gamePk) {
  const url = `https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`;
  return fetchJson(url);
}

function flattenPlayers(boxscore) {
  const players = [];

  for (const side of ['home', 'away']) {
    const team = boxscore.teams?.[side];

    if (!team?.players) continue;

    for (const p of Object.values(team.players)) {
      players.push({
        name: p.person?.fullName,
        id: p.person?.id,
        teamSide: side,
        batting: p.stats?.batting || {},
        pitching: p.stats?.pitching || {},
      });
    }
  }

  return players;
}

function findPlayer(players, playerName) {
  const target = normName(playerName);

  return (
    players.find(p => normName(p.name) === target) ||
    players.find(p => normName(p.name).includes(target)) ||
    players.find(p => target.includes(normName(p.name)))
  );
}

function actualForMarket(player, market) {
  if (!player) return null;

  const b = player.batting || {};
  const p = player.pitching || {};

  if (market === 'hits') {
    return num(b.hits);
  }

  if (market === 'bases') {
    const singles = num(b.hits) - num(b.doubles) - num(b.triples) - num(b.homeRuns);
    const doubles = num(b.doubles) || 0;
    const triples = num(b.triples) || 0;
    const hrs = num(b.homeRuns) || 0;

    if (!Number.isFinite(singles)) return null;

    return singles + doubles * 2 + triples * 3 + hrs * 4;
  }

  if (market === 'hrr') {
    const hits = num(b.hits);
    const runs = num(b.runs);
    const rbi = num(b.rbi);

    if (hits === null || runs === null || rbi === null) return null;

    return hits + runs + rbi;
  }

  if (market === 'hr') {
    return num(b.homeRuns);
  }

  if (market === 'rbis') {
    return num(b.rbi);
  }

  if (market === 'runs') {
    return num(b.runs);
  }

  if (market === 'strikeouts') {
    return num(p.strikeOuts);
  }

  return null;
}

function isGameFinal(game) {
  const state = game.status?.abstractGameState;
  const detailed = game.status?.detailedState || '';

  return (
    state === 'Final' ||
    detailed.toLowerCase().includes('final')
  );
}

async function main() {
  if (!fs.existsSync(BOARD_FILE)) {
    throw new Error(`Missing ${BOARD_FILE}`);
  }

  const board = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
  const date = process.env.GRADE_DATE || slateDate();

  console.log(`Grading date: ${date}`);

  const schedule = await getSchedule(date);
  const games = schedule.dates?.[0]?.games || [];

  const finalGames = games.filter(isGameFinal);
  const finalGamePks = new Set(finalGames.map(g => g.gamePk));

  const boxscores = new Map();

  for (const game of finalGames) {
    console.log(`Fetching boxscore ${game.gamePk}`);
    boxscores.set(game.gamePk, await getBoxscore(game.gamePk));
  }

  const graded = [];

  for (const row of board) {
    if (row.recordType !== 'merged_prop') continue;
    if (!['hits', 'bases', 'hrr', 'hr', 'rbis', 'runs', 'strikeouts'].includes(row.market)) continue;

    const gamePk = row.gamePk;

    if (!gamePk || !finalGamePks.has(gamePk)) {
      graded.push({
        ...row,
        gradeStatus: 'PENDING',
        actual: null,
        result: 'PENDING',
        gradedAt: new Date().toISOString(),
      });
      continue;
    }

    const boxscore = boxscores.get(gamePk);
    const players = flattenPlayers(boxscore);
    const player = findPlayer(players, row.player);

    const actual = actualForMarket(player, row.market);
    const result = grade(actual, num(row.line), row.edge > 0 ? 'MORE' : row.edge < 0 ? 'LESS' : null);

    graded.push({
      ...row,
      actual,
      result,
      gradeStatus: result === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'GRADED',
      gradedAt: new Date().toISOString(),
    });
  }

  const summary = {
    recordType: 'grading_summary',
    date,
    totalRows: graded.length,
    finalGames: finalGames.length,
    graded: graded.filter(r => r.gradeStatus === 'GRADED').length,
    pending: graded.filter(r => r.gradeStatus === 'PENDING').length,
    unavailable: graded.filter(r => r.gradeStatus === 'UNAVAILABLE').length,
    hits: graded.filter(r => r.result === 'HIT').length,
    misses: graded.filter(r => r.result === 'MISS').length,
    pushes: graded.filter(r => r.result === 'PUSH').length,
    createdAt: new Date().toISOString(),
  };

  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify([summary, ...graded], null, 2));

  fs.mkdirSync('history/graded', { recursive: true });
  fs.writeFileSync(
    `history/graded/graded-${date}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    JSON.stringify([summary, ...graded], null, 2)
  );

  console.log(summary);
  console.log(`Saved ${OUT_FILE}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
