import fs from 'fs';

const prizepicks = JSON.parse(fs.readFileSync('data/prizepicks-latest.json', 'utf8'));
const ballpark = JSON.parse(fs.readFileSync('data/ballpark-latest.json', 'utf8'));

function normalizeName(name) {
  return name?.toLowerCase().replace(/[^a-z\s]/g, '').trim();
}

function findBallparkMatch(playerName) {
  const norm = normalizeName(playerName);
  return ballpark.find(p => normalizeName(p.player || p.name) === norm);
}

const merged = prizepicks.map(p => {
  const match = findBallparkMatch(p.player_name);

  return {
    player: p.player_name,
    team: p.player_team,
    stat: p.stat_type || p.stat,
    line: p.line_score,
    oddsTier: p.odds_type || p.odds_tier,
    game: `${p.away_team} @ ${p.home_team}`,
    startTime: p.game_start,
    ballpark: match || null,
  };
});

fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/merged-board.json', JSON.stringify(merged, null, 2));

console.log(`Merged rows: ${merged.length}`);
