import fs from 'fs';

const YEAR = new Date().getFullYear();
const OUT = 'data/savant-latest.json';

const SELECTIONS = [
  'pa',
  'k_percent',
  'bb_percent',
  'woba',
  'xba',
  'xslg',
  'xwoba',
  'sweet_spot_percent',
  'barrel_batted_rate',
  'hard_hit_percent',
  'exit_velocity_avg',
  'launch_angle_avg',
  'whiff_percent',
  'swing_percent'
].join('%2C');

function csvUrl(type) {
  return `https://baseballsavant.mlb.com/leaderboard/custom` +
    `?chart=false` +
    `&chartType=beeswarm` +
    `&filter=` +
    `&min=10` +
    `&r=no` +
    `&selections=${SELECTIONS}` +
    `&sort=xwoba` +
    `&sortDir=desc` +
    `&type=${type}` +
    `&x=pa` +
    `&y=pa` +
    `&year=${YEAR}` +
    `&csv=true`;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      quoted = !quoted;
      continue;
    }

    if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
      continue;
    }

    cur += ch;
  }

  out.push(cur.trim());
  return out;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());

  return lines.map(line => {
    const cols = parseCsvLine(line);
    const row = {};

    headers.forEach((h, i) => {
      row[h] = cols[i] || '';
    });

    return row;
  });
}

function num(v) {
  const raw = String(v ?? '').replace('%', '').trim();
  if (raw === '') return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function cleanName(v) {
  return String(v || '').trim();
}

function playerName(row) {
  let player =
    cleanName(row.Player) ||
    cleanName(row.player_name) ||
    cleanName(row.Name);

  if (!player && row['last_name, first_name']) {
    const parts = row['last_name, first_name'].split(',').map(s => s.trim());
    player = parts.length === 2 ? `${parts[1]} ${parts[0]}` : row['last_name, first_name'];
  }

  return player;
}

function normalizeRow(row, type) {
  const player = playerName(row);

  return {
    recordType: 'savant_player',
    source: 'baseball_savant',
    season: YEAR,
    playerType: type === 'batter' ? 'batter' : 'pitcher',
    player,
    playerId: row.player_id || null,
    team: row.Team || row.team || null,

    pa: num(row.pa),
    woba: num(row.woba),
    xba: num(row.xba),
    xslg: num(row.xslg),
    xwoba: num(row.xwoba),

    avgExitVelocity: num(row.exit_velocity_avg),
    avgLaunchAngle: num(row.launch_angle_avg),
    sweetSpotRate: num(row.sweet_spot_percent),
    barrelRate: num(row.barrel_batted_rate),
    hardHitRate: num(row.hard_hit_percent),

    kRate: num(row.k_percent),
    bbRate: num(row.bb_percent),
    whiffRate: num(row.whiff_percent),
    swingRate: num(row.swing_percent),

    raw: row
  };
}

async function fetchSavant(type) {
  const url = csvUrl(type);
  console.log(`Fetching Savant ${type}: ${url}`);

  const res = await fetch(url, {
    headers: {
      accept: 'text/csv,*/*',
      'user-agent': 'Mozilla/5.0'
    }
  });

  if (!res.ok) throw new Error(`Savant ${type} failed: ${res.status}`);

  const text = await res.text();

  if (text.toLowerCase().includes('<html')) {
    throw new Error(`Savant ${type} returned HTML, not CSV`);
  }

  const rows = parseCsv(text);
  console.log(`${type} headers:`, Object.keys(rows[0] || {}));

  return rows
    .map(r => normalizeRow(r, type))
    .filter(r => r.player);
}

async function main() {
  fs.mkdirSync('data', { recursive: true });

  const batters = await fetchSavant('batter');
  const pitchers = await fetchSavant('pitcher');

  const rows = [
    {
      recordType: 'savant_summary',
      createdAt: new Date().toISOString(),
      season: YEAR,
      batters: batters.length,
      pitchers: pitchers.length
    },
    ...batters,
    ...pitchers
  ];

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));

  console.log(`Saved ${OUT}`);
  console.log({ batters: batters.length, pitchers: pitchers.length });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
