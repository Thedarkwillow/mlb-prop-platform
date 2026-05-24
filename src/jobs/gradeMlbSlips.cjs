const fs = require('fs');
const normalizePlayerName = require('../utils/normalizePlayerName.cjs');

const DATE = process.argv[2] || new Date().toISOString().slice(0, 10);

const SLIPS_IN = `outputs/history/${DATE}-locked-slips.json`;
const REPORT_OUT = 'outputs/performance-report.txt';
const GRADED_OUT = `outputs/history/${DATE}-graded-slips.json`;

if (!fs.existsSync(SLIPS_IN)) {
  console.error(`No locked slips found: ${SLIPS_IN}`);
  console.error('Run scripts/dailyBuildSlate.sh first.');
  process.exit(1);
}

const TEAM_ABBR = {
  'Arizona Diamondbacks': 'ARI',
  'Atlanta Braves': 'ATL',
  'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS',
  'Chicago Cubs': 'CHC',
  'Chicago White Sox': 'CHW',
  'Cincinnati Reds': 'CIN',
  'Cleveland Guardians': 'CLE',
  'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET',
  'Houston Astros': 'HOU',
  'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA',
  'Los Angeles Dodgers': 'LAD',
  'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL',
  'Minnesota Twins': 'MIN',
  'New York Mets': 'NYM',
  'New York Yankees': 'NYY',
  'Athletics': 'ATH',
  'Oakland Athletics': 'ATH',
  'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT',
  'San Diego Padres': 'SD',
  'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA',
  'St. Louis Cardinals': 'STL',
  'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX',
  'Toronto Blue Jays': 'TOR',
  'Washington Nationals': 'WSH'
};

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function normName(v) {
  return normalizePlayerName(v);
}

function oldNormName_UNUSED(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normTeam(v) {
  return String(v || '').trim().toUpperCase();
}

function abbr(teamName) {
  return TEAM_ABBR[teamName] || teamName || null;
}

function gamePairKeyFromTeams(a, b) {
  return [normTeam(a), normTeam(b)].sort().join('-');
}

function gamePairKeyFromString(game) {
  const parts = String(game || '').split('@').map(x => normTeam(x));
  if (parts.length !== 2) return '';
  return gamePairKeyFromTeams(parts[0], parts[1]);
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function getSchedule(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`;
  const data = await fetchJson(url);
  return data.dates?.[0]?.games || [];
}

async function getBoxscore(gamePk) {
  return fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
}

function playerStatsFromBox(box, playerName, team) {
  const target = normName(playerName);
  const targetTeam = normTeam(team);

  for (const side of ['away', 'home']) {
    const sideTeam = normTeam(
      box.teams?.[side]?.team?.abbreviation ||
      abbr(box.teams?.[side]?.team?.name)
    );

    const players = box.teams?.[side]?.players || {};

    if (targetTeam && sideTeam && targetTeam !== sideTeam) continue;

    for (const p of Object.values(players)) {
      if (normName(p.person?.fullName) === target) {
        return {
          player: p.person?.fullName,
          batting: p.stats?.batting || {},
          pitching: p.stats?.pitching || {},
          team: sideTeam
        };
      }
    }
  }

  return null;
}

function statValue(leg, stats) {
  const m = String(leg.market || leg.stat || '').toLowerCase();
  const statText = String(leg.stat || '').toLowerCase();

  const b = stats.batting || {};
  const p = stats.pitching || {};

  if (m.includes('strikeout') || statText.includes('pitcher strikeouts')) {
    return Number(p.strikeOuts || 0);
  }

  if (m.includes('outs') || statText.includes('pitching outs')) {
    const ip = String(p.inningsPitched || '0');
    const [whole, frac] = ip.split('.');
    return Number(whole || 0) * 3 + Number(frac || 0);
  }

  if (m.includes('hits_allowed') || statText.includes('hits allowed')) {
    return Number(p.hits || 0);
  }

  if (m.includes('earned_runs') || statText.includes('earned runs')) {
    return Number(p.earnedRuns || 0);
  }

  if (m.includes('walks_allowed') || statText.includes('walks allowed')) {
    return Number(p.baseOnBalls || 0);
  }

  if (m.includes('hrr') || statText.includes('hits+runs+rbis')) {
    return Number(b.hits || 0) + Number(b.runs || 0) + Number(b.rbi || 0);
  }

  if (m.includes('bases') || statText.includes('total bases')) {
    return Number(b.totalBases || 0);
  }

  if (m.includes('hits') || statText === 'hits') {
    return Number(b.hits || 0);
  }

  if (m.includes('runs') || statText === 'runs') {
    return Number(b.runs || 0);
  }

  if (m.includes('rbi') || statText.includes('rbi')) {
    return Number(b.rbi || 0);
  }

  if (m.includes('home_run') || statText.includes('home runs')) {
    return Number(b.homeRuns || 0);
  }

  return null;
}

function grade(value, line, side) {
  const ln = Number(line);
  const s = String(side || '').toUpperCase();

  if (!Number.isFinite(value) || !Number.isFinite(ln)) return 'PENDING';
  if (value === ln) return 'PUSH';

  if (s === 'MORE' || s === 'OVER') return value > ln ? 'HIT' : 'MISS';
  if (s === 'LESS' || s === 'UNDER') return value < ln ? 'HIT' : 'MISS';

  return 'PENDING';
}

async function main() {
  fs.mkdirSync('outputs/history', { recursive: true });

  const slips = readJson(SLIPS_IN, []);
  const schedule = await getSchedule(DATE);

  const games = [];

  for (const g of schedule) {
    const away = abbr(g.teams?.away?.team?.name);
    const home = abbr(g.teams?.home?.team?.name);
    const status = g.status?.detailedState || '';

    let boxscore = null;
    if (status === 'Final') {
      boxscore = await getBoxscore(g.gamePk);
    }

    games.push({
      gamePk: g.gamePk,
      away,
      home,
      pairKey: gamePairKeyFromTeams(away, home),
      status,
      isFinal: status === 'Final',
      boxscore
    });
  }

  let graded = 0;
  let hits = 0;
  let misses = 0;
  let pushes = 0;
  let pending = 0;

  const pendingLegs = [];

  const gradedSlips = slips.map(slip => {
    const legs = (slip.legs || []).map(leg => {
      const pairKey = gamePairKeyFromString(leg.game);

      const candidateGames = games.filter(g => {
        if (leg.gamePk && Number(leg.gamePk) === Number(g.gamePk)) return true;
        return g.pairKey === pairKey;
      });

      let matchedGame = null;
      let found = null;

      for (const g of candidateGames) {
        if (!g.isFinal) {
          matchedGame = g;
          break;
        }

        const stats = playerStatsFromBox(g.boxscore, leg.player, leg.team);

        if (stats) {
          matchedGame = g;
          found = stats;
          break;
        }

        if (!matchedGame) matchedGame = g;
      }

      if (!matchedGame || !matchedGame.isFinal) {
        pending++;

        const next = {
          ...leg,
          result: 'PENDING',
          actual: null,
          matchedGamePk: matchedGame?.gamePk || null,
          matchedGame: matchedGame ? `${matchedGame.away} @ ${matchedGame.home}` : null,
          gradeReason: 'game not final'
        };

        pendingLegs.push(next);
        return next;
      }

      if (!found) {
        const actual = 0;
        const result = grade(actual, leg.line, leg.side || leg.recommendedSide);

        if (result === 'HIT') hits++;
        else if (result === 'MISS') misses++;
        else if (result === 'PUSH') pushes++;
        else pending++;

        if (result !== 'PENDING') graded++;

        const next = {
          ...leg,
          result,
          actual,
          matchedGamePk: matchedGame.gamePk,
          matchedGame: `${matchedGame.away} @ ${matchedGame.home}`,
          gradeReason: 'no appearance → treated as 0'
        };

        if (result === 'PENDING') pendingLegs.push(next);
        return next;
      }

      const actual = statValue(leg, found);
      const result = grade(actual, leg.line, leg.side || leg.recommendedSide);

      if (result === 'HIT') hits++;
      else if (result === 'MISS') misses++;
      else if (result === 'PUSH') pushes++;
      else pending++;

      if (result !== 'PENDING') graded++;

      const next = {
        ...leg,
        result,
        actual,
        matchedGamePk: matchedGame.gamePk,
        matchedGame: `${matchedGame.away} @ ${matchedGame.home}`,
        gradeReason: null
      };

      if (result === 'PENDING') pendingLegs.push(next);
      return next;
    });

    const slipHits = legs.filter(x => x.result === 'HIT').length;
    const slipMisses = legs.filter(x => x.result === 'MISS').length;
    const slipPushes = legs.filter(x => x.result === 'PUSH').length;
    const slipPending = legs.filter(x => x.result === 'PENDING').length;

    return {
      ...slip,
      legs,
      resultSummary: {
        hits: slipHits,
        misses: slipMisses,
        pushes: slipPushes,
        pending: slipPending
      }
    };
  });

  fs.writeFileSync(GRADED_OUT, JSON.stringify(gradedSlips, null, 2));

  const hitRate = graded ? ((hits / graded) * 100).toFixed(1) : '0.0';

  const lines = [
    'MLB AUTO GRADING REPORT V3',
    `Date: ${DATE}`,
    `Slips: ${slips.length}`,
    `Graded legs: ${graded}`,
    `Hits: ${hits}`,
    `Misses: ${misses}`,
    `Pushes: ${pushes}`,
    `Pending: ${pending}`,
    `Hit Rate: ${hitRate}%`,
    '',
    'Pending Legs:',
    ...pendingLegs.map(x =>
      `- ${x.player} | ${x.team} | ${x.game} | ${x.stat || x.market} ${x.side || x.recommendedSide} ${x.line} | ${x.gradeReason || 'pending'}`
    ),
    '',
    `Saved graded slips: ${GRADED_OUT}`
  ];

  fs.writeFileSync(REPORT_OUT, lines.join('\n'));
  console.log(lines.join('\n'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
