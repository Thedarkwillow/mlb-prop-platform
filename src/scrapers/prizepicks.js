import fs from 'fs/promises';
import path from 'path';

const OUT_FILE = 'data/prizepicks-latest.json';
const RAW_OUT_FILE = 'data/prizepicks-raw-latest.json';

const LEAGUE = process.env.PRIZEPICKS_LEAGUE || 'MLB';
const LEAGUE_ID = process.env.PRIZEPICKS_LEAGUE_ID || '2';

const API_URL =
  process.env.PRIZEPICKS_API_URL ||
  `https://api.prizepicks.com/projections?league_id=${LEAGUE_ID}&per_page=1000&single_stat=true`;

function clean(v) {
  return String(v ?? '').trim();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getIncludedMap(included = []) {
  const map = new Map();

  for (const item of included) {
    map.set(`${item.type}:${item.id}`, item);
  }

  return map;
}

function getRelation(item, name, includedMap) {
  const rel = item?.relationships?.[name]?.data;
  if (!rel) return null;

  if (Array.isArray(rel)) {
    return rel.map((x) => includedMap.get(`${x.type}:${x.id}`)).filter(Boolean);
  }

  return includedMap.get(`${rel.type}:${rel.id}`) || null;
}

function normalizeTier(proj) {
  const attrs = proj.attributes || {};

  if (attrs.odds_type) return clean(attrs.odds_type).toLowerCase();
  if (attrs.odds_tier) return clean(attrs.odds_tier).toLowerCase();

  if (attrs.adjusted_odds === true) return 'demon';

  return 'standard';
}

function normalizeProjection(proj, includedMap) {
  const attrs = proj.attributes || {};

  const player =
    getRelation(proj, 'new_player', includedMap) ||
    getRelation(proj, 'player', includedMap);

  const league =
    getRelation(proj, 'league', includedMap);

  const game =
    getRelation(proj, 'game', includedMap) ||
    getRelation(proj, 'event', includedMap);

  const playerAttrs = player?.attributes || {};
  const leagueAttrs = league?.attributes || {};
  const gameAttrs = game?.attributes || {};

  const playerName =
    attrs.player_name ||
    playerAttrs.name ||
    playerAttrs.display_name ||
    playerAttrs.full_name ||
    '';

  const playerTeam =
    attrs.team ||
    attrs.player_team ||
    playerAttrs.team ||
    playerAttrs.team_abbr ||
    playerAttrs.team_abbreviation ||
    '';

  const stat =
    attrs.stat_type ||
    attrs.stat_display_name ||
    attrs.stat ||
    attrs.name ||
    '';

  const startTime =
    attrs.start_time ||
    attrs.game_start ||
    gameAttrs.start_time ||
    gameAttrs.scheduled_at ||
    null;

  const homeTeam =
    attrs.home_team ||
    gameAttrs.home_team ||
    gameAttrs.home_team_abbreviation ||
    null;

  const awayTeam =
    attrs.away_team ||
    gameAttrs.away_team ||
    gameAttrs.away_team_abbreviation ||
    null;

  const description =
    attrs.description ||
    attrs.opponent ||
    null;

  return {
    projection_id: clean(proj.id),

    line: num(attrs.line_score ?? attrs.line ?? attrs.value),
    stat,
    stat_short: attrs.stat_display_name || attrs.stat_type || stat,

    odds_tier: normalizeTier(proj),
    adjusted_odds: attrs.adjusted_odds ?? null,
    flash_line: attrs.flash_line ?? null,
    is_promo: attrs.is_promo ?? false,

    status: attrs.status || null,
    is_live: attrs.is_live ?? false,
    is_live_scored: attrs.is_live_scored ?? null,
    in_game: attrs.in_game ?? false,
    refundable: attrs.refundable ?? null,

    rank: attrs.rank ?? null,
    projection_type: attrs.projection_type || attrs.projection_type_name || null,

    start_time: startTime,
    board_time: attrs.board_time || null,
    updated_at: attrs.updated_at || null,

    description,
    hot: attrs.hot ?? false,
    tv_channel: attrs.tv_channel || null,
    custom_image: attrs.custom_image || null,
    event_type: attrs.event_type || null,
    end_time: attrs.end_time || gameAttrs.end_time || null,
    today: attrs.today ?? null,

    player_name: playerName,
    player_team: playerTeam,
    player_team_name: playerAttrs.team_name || attrs.player_team_name || null,
    player_market: playerAttrs.market || attrs.player_market || null,
    player_position: playerAttrs.position || attrs.player_position || null,
    player_image: playerAttrs.image_url || attrs.player_image || null,
    player_jersey: playerAttrs.jersey_number || attrs.player_jersey || null,
    player_combo: attrs.is_combo ?? attrs.player_combo ?? false,
    player_id: clean(player?.id || attrs.player_id || ''),

    league: leagueAttrs.name || attrs.league || LEAGUE,
    league_id: league?.id ? Number(league.id) : Number(LEAGUE_ID),

    game_start: startTime,
    game_end: attrs.game_end || gameAttrs.end_time || null,
    game_status: gameAttrs.status || attrs.game_status || null,
    game_is_live: gameAttrs.is_live ?? attrs.game_is_live ?? false,

    home_team: homeTeam,
    home_team_name: gameAttrs.home_team_name || attrs.home_team_name || null,
    home_team_market: gameAttrs.home_team_market || attrs.home_team_market || null,
    home_team_color: gameAttrs.home_team_color || attrs.home_team_color || null,

    away_team: awayTeam,
    away_team_name: gameAttrs.away_team_name || attrs.away_team_name || null,
    away_team_market: gameAttrs.away_team_market || attrs.away_team_market || null,
    away_team_color: gameAttrs.away_team_color || attrs.away_team_color || null,

    duration: attrs.duration || 'Full',
    projection_type_name: attrs.projection_type_name || attrs.projection_type || null,
    stat_rank: attrs.stat_rank ?? null,
  };
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function fetchPrizePicks() {
  const res = await fetch(API_URL, {
    headers: {
      accept: 'application/json',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      origin: 'https://app.prizepicks.com',
      referer: 'https://app.prizepicks.com/',
    },
  });

  if (!res.ok) {
    throw new Error(`PrizePicks request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function main() {
  console.log('Fetching PrizePicks board...');
  console.log(`URL: ${API_URL}`);

  const raw = await fetchPrizePicks();

  const includedMap = getIncludedMap(raw.included || []);
  const projections = Array.isArray(raw.data) ? raw.data : [];

  const normalized = projections
    .map((proj) => normalizeProjection(proj, includedMap))
    .filter((row) => {
      if (!row.projection_id) return false;
      if (!row.player_name) return false;
      if (!row.stat) return false;
      if (row.line === null) return false;
      if (row.league !== LEAGUE && Number(row.league_id) !== Number(LEAGUE_ID)) return false;
      return true;
    });

  await ensureDir(OUT_FILE);

  await fs.writeFile(RAW_OUT_FILE, JSON.stringify(raw, null, 2));
  await fs.writeFile(OUT_FILE, JSON.stringify(normalized, null, 2));

  console.log(`Saved raw board: ${RAW_OUT_FILE}`);
  console.log(`Saved normalized board: ${OUT_FILE}`);
  console.log(`Rows: ${normalized.length}`);

  const byTier = normalized.reduce((acc, row) => {
    acc[row.odds_tier] = (acc[row.odds_tier] || 0) + 1;
    return acc;
  }, {});

  console.log('Tier counts:', byTier);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
