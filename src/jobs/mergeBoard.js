
import fs from 'fs';

const prizepicks = JSON.parse(fs.readFileSync('data/prizepicks-latest.json', 'utf8'));
const ballpark = JSON.parse(fs.readFileSync('data/ballpark-latest.json', 'utf8'));

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

function normTeam(v) {
  return clean(v).toUpperCase();
}

function normalizeMarket(stat) {
  const s = clean(stat).toLowerCase();

  if (s.includes('pitching outs')) return 'pitching_outs';
  if (s.includes('hits allowed')) return 'hits_allowed';
  if (s.includes('earned runs allowed')) return 'earned_runs_allowed';
  if (s.includes('strikeout')) return 'strikeouts';
  if (s.includes('total bases') || s === 'bases') return 'bases';
  if (s.includes('hits+runs+rbi') || s.includes('h+r+r')) return 'hrr';
  if (s === 'hits' || s.includes('hits')) return 'hits';
  if (s.includes('home run')) return 'hr';
  if (s.includes('rbi')) return 'rbis';
  if (s === 'runs' || s.includes('runs')) return 'runs';

  return null;
}

function ballparkProjection(row, market) {
  if (!row) return null;

  if (market === 'hits') return row.hits;
  if (market === 'bases') return row.bases;
  if (market === 'hrr') return (row.hits ?? 0) + (row.runs ?? 0) + (row.rBIs ?? 0);
  if (market === 'hr') return row.homeRuns;
  if (market === 'runs') return row.runs;
  if (market === 'rbis') return row.rBIs;
  if (market === 'strikeouts') return row.strikeouts;
  if (market === 'pitching_outs') return row.innings ? row.innings * 3 : null;
  if (market === 'hits_allowed') return row.hitsAllowed;
  if (market === 'earned_runs_allowed') return row.runsAllowed;

  return null;
}

const bpIndex = new Map();

for (const row of ballpark) {
  const key = `${normName(row.fullName)}|${normTeam(row.team)}`;
  bpIndex.set(key, row);
}

const merged = prizepicks.map((p) => {
  const player = p.player_name;
  const team = p.player_team;
  const market = normalizeMarket(p.stat || p.stat_short);
  const key = `${normName(player)}|${normTeam(team)}`;
  const bp = bpIndex.get(key) || null;
  const projection = ballparkProjection(bp, market);
  const line = Number(p.line);

  const edge =
    projection !== null && Number.isFinite(line)
      ? Number((projection - line).toFixed(3))
      : null;

  return {
    recordType: 'merged_prop',
    player,
    team,
    market,
    stat: p.stat,
    line,
    oddsTier: p.odds_tier,
    side: edge === null ? null : edge > 0 ? 'MORE' : edge < 0 ? 'LESS' : 'PUSH',
    projection,
    edge,
    game: `${p.away_team} @ ${p.home_team}`,
    startTime: p.game_start,
    ballpark: bp,
  };
});

fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/merged-board.json', JSON.stringify(merged, null, 2));

const matched = merged.filter(r => r.ballpark).length;
const withProjection = merged.filter(r => r.projection !== null).length;

console.log(`Merged rows: ${merged.length}`);
console.log(`Matched Ballpark rows: ${matched}`);
console.log(`Rows with projection: ${withProjection}`);
