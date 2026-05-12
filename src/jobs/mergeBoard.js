import fs from 'fs';

const prizepicks = JSON.parse(fs.readFileSync('data/prizepicks-latest.json', 'utf8'));
const ballpark = JSON.parse(fs.readFileSync('data/ballpark-latest.json', 'utf8'));

function clean(v) {
  return String(v ?? '').trim();
}

function normName(v) {
  return clean(v)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normTeam(v) {
  return clean(v).toUpperCase().trim();
}

function normalizeMarket(stat) {
  const s = clean(stat).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  if (s === 'pitching outs' || s === 'pitcher outs' || s === 'outs recorded') return 'pitching_outs';
  if (s === 'walks allowed' || s === 'pitcher walks' || s === 'pitcher walks allowed') return 'walks_allowed';
  if (s === 'pitcher fantasy score') return 'pitcher_fantasy_score';
  if (s === 'hitter fantasy score') return 'hitter_fantasy_score';
  if (s === 'pitches thrown') return 'pitches_thrown';

  if (s.includes('strikeout')) return 'strikeouts';
  if (s.includes('total bases') || s === 'bases') return 'bases';
  if (s.includes('hits+runs+rbi') || s.includes('hits + runs + rbis') || s.includes('h+r+r')) return 'hrr';
  if (s === 'hits' || s.includes('batter hits')) return 'hits';
  if (s.includes('home run')) return 'hr';
  if (s.includes('rbi')) return 'rbis';
  if (s === 'runs' || s.includes('runs scored')) return 'runs';
  if (s.includes('singles')) return 'singles';
  if (s.includes('doubles')) return 'doubles';
  if (s.includes('triples')) return 'triples';
  if (s.includes('walks')) return 'walks';
  if (s.includes('stolen bases')) return 'stolen_bases';
  if (s.includes('plate appearances')) return 'plate_appearances';

  return null;
}

function inferSourceType(market) {
  if ([
    'pitching_outs',
    'walks_allowed',
    'pitcher_fantasy_score',
    'pitches_thrown',
    'strikeouts'
  ].includes(market)) {
    return 'pitcher';
  }
  return 'hitter';
}

function projection(row, market) {
  if (!row || !market) return null;

  if (market === 'pitching_outs') {
    const innings = Number(row.innings ?? row.raw?.Innings);
    return Number.isFinite(innings) ? innings * 3 : null;
  }

  if (market === 'walks_allowed') {
    const walks = Number(row.walks ?? row.raw?.Walks);
    return Number.isFinite(walks) ? walks : null;
  }

  if (market === 'pitcher_fantasy_score') {
    const v = Number(row.pointsDK ?? row.pointsFD);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  if (market === 'pitches_thrown') {
    const v = Number(row.pitchesThrown ?? row.raw?.PitchesThrown);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  if (market === 'hits') return row.hits ?? null;
  if (market === 'bases') return row.bases ?? null;
  if (market === 'hrr') return (row.hits ?? 0) + (row.runs ?? 0) + (row.rBIs ?? 0);
  if (market === 'hr') return row.homeRuns ?? null;
  if (market === 'runs') return row.runs ?? null;
  if (market === 'rbis') return row.rBIs ?? null;
  if (market === 'strikeouts') return row.strikeouts ?? null;
  if (market === 'singles') return row.singles ?? null;
  if (market === 'doubles') return row.doubles ?? null;
  if (market === 'triples') return row.triples ?? null;
  if (market === 'walks') return row.walks ?? null;
  if (market === 'stolen_bases') return row.stolenBaseSuccesses ?? row.stolenBases ?? null;
  if (market === 'plate_appearances') return row.plateAppearances ?? null;
  if (market === 'hitter_fantasy_score') return row.pointsDK ?? row.pointsFD ?? null;

  return null;
}

const bpByNameTeamType = new Map();
const bpByNameType = new Map();

for (const r of ballpark) {
  const name = normName(r.fullName);
  const team = normTeam(r.team);
  const type = clean(r.recordType).toLowerCase();

  if (!name || !type) continue;

  bpByNameTeamType.set(`${name}|${team}|${type}`, r);

  const nameTypeKey = `${name}|${type}`;
  if (!bpByNameType.has(nameTypeKey)) bpByNameType.set(nameTypeKey, []);
  bpByNameType.get(nameTypeKey).push(r);
}

function findBallpark(player, team, desiredType) {
  const name = normName(player);
  const t = normTeam(team);
  const type = desiredType === 'pitcher' ? 'pitcher' : 'batter';

  const exact = bpByNameTeamType.get(`${name}|${t}|${type}`);
  if (exact) return { row: exact, matchType: 'name_team_type' };

  const candidates = bpByNameType.get(`${name}|${type}`) || [];
  if (candidates.length === 1) {
    return { row: candidates[0], matchType: 'name_type_unique' };
  }

  return { row: null, matchType: candidates.length > 1 ? 'ambiguous_name_type' : 'no_match' };
}

const merged = prizepicks.map(p => {
  const player = p.player_name;
  const team = p.player_team;
  const market = normalizeMarket(p.stat || p.stat_short);
  const desiredType = inferSourceType(market);
  const found = findBallpark(player, team, desiredType);
  const bp = found.row;
  const proj = projection(bp, market);
  const line = Number(p.line);

  const edge = (proj !== null && Number.isFinite(Number(proj)) && Number.isFinite(line))
    ? Number((Number(proj) - line).toFixed(3))
    : null;

  let confidence = 0;
  if (edge !== null) confidence += Math.min(Math.abs(edge), 2);
  if (bp) confidence += 1;
  if (p.odds_tier === 'standard') confidence += 0.5;

  return {
    recordType: 'merged_prop',
    player,
    team,
    market,
    stat: p.stat,
    line,
    oddsTier: p.odds_tier,
    projection: proj,
    edge,
    confidence: Number(confidence.toFixed(3)),
    sourceType: desiredType,
    ballparkMatchType: found.matchType,
    game: bp
      ? `${clean(bp.team)} @ ${clean(bp.opponent)}`
      : `${p.away_team} @ ${p.home_team}`,
    gamePk: bp?.gamePk || null,
    startTime: p.game_start,
    ballpark: bp
  };
});

fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/merged-board.json', JSON.stringify(merged, null, 2));

console.log(`Merged rows: ${merged.length}`);
console.log(`Matched Ballpark rows: ${merged.filter(r => r.ballpark).length}`);
console.log(`With projection: ${merged.filter(r => r.projection !== null).length}`);
console.log(`Pitcher matches: ${merged.filter(r => r.sourceType === 'pitcher' && r.ballpark).length}`);
console.log(`Name-only unique matches: ${merged.filter(r => r.ballparkMatchType === 'name_type_unique').length}`);
console.log(`Ambiguous misses: ${merged.filter(r => r.ballparkMatchType === 'ambiguous_name_type').length}`);
