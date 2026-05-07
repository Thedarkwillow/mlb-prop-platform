const fs = require('fs');

const INPUT = 'data/prizepicks-latest.json';
const OUT = 'data/prizepicks-history.json';

if (!fs.existsSync(INPUT)) {
  console.error(`Missing ${INPUT}. Run prizepicks scraper first.`);
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const existing = fs.existsSync(OUT)
  ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
  : [];

const timestamp = new Date().toISOString();

function norm(v) {
  return String(v || '').toLowerCase().trim();
}

function playerValue(r) {
  return r.player || r.player_name;
}

function marketValue(r) {
  return r.market || r.stat || r.stat_short;
}

function lineValue(r) {
  return Number(r.line);
}

const snapshot = rows
  .filter(r =>
    playerValue(r) &&
    marketValue(r) &&
    Number.isFinite(lineValue(r)) &&
    r.event_type !== 'combo'
  )
  .map(r => ({
    timestamp,
    date: timestamp.slice(0, 10),
    projectionId: r.projection_id || null,
    player: playerValue(r),
    market: marketValue(r),
    stat: r.stat || null,
    statShort: r.stat_short || null,
    line: lineValue(r),
    tier: r.tier || r.oddsTier || r.odds_tier || null,
    team: r.team || r.player_team || null,
    game: r.game || r.description || null,
    startTime: r.start_time || r.game_start || null,
    updatedAt: r.updated_at || null,
    key: [
      norm(playerValue(r)),
      norm(marketValue(r)),
      norm(r.odds_tier || r.tier || r.oddsTier),
      r.projection_id || ''
    ].join('|')
  }));

const seen = new Set(existing.map(x =>
  `${x.timestamp}|${norm(x.player)}|${norm(x.market)}|${x.line}|${x.tier || ''}|${x.projectionId || ''}`
));

const fresh = snapshot.filter(x => {
  const k = `${x.timestamp}|${norm(x.player)}|${norm(x.market)}|${x.line}|${x.tier || ''}|${x.projectionId || ''}`;
  return !seen.has(k);
});

const combined = existing.concat(fresh);

fs.writeFileSync(OUT, JSON.stringify(combined, null, 2));

console.log(JSON.stringify({
  recordType: 'prizepicks_history_tracker_summary',
  inputRows: rows.length,
  snapshotRows: snapshot.length,
  addedRows: fresh.length,
  totalHistoryRows: combined.length,
  saved: OUT
}, null, 2));
