const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const RAW = "data/prizepicks-raw-latest.json";
const OUT_RAW = "outputs/mlb-live-board-raw.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function write(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function normTeam(x) {
  const s = String(x || "").toUpperCase().replace(/\./g, "").trim();
  const map = {
    ARIZONA: "ARI", "D-BACKS": "ARI", DIAMONDBACKS: "ARI", ARI: "ARI", AZ: "ARI",
    ATLANTA: "ATL", BRAVES: "ATL", ATL: "ATL",
    BALTIMORE: "BAL", ORIOLES: "BAL", BAL: "BAL",
    BOSTON: "BOS", "RED SOX": "BOS", BOS: "BOS",
    CUBS: "CHC", CHC: "CHC",
    "WHITE SOX": "CWS", CWS: "CWS", CHW: "CWS",
    CINCINNATI: "CIN", REDS: "CIN", CIN: "CIN",
    CLEVELAND: "CLE", GUARDIANS: "CLE", CLE: "CLE",
    COLORADO: "COL", ROCKIES: "COL", COL: "COL",
    DETROIT: "DET", TIGERS: "DET", DET: "DET",
    HOUSTON: "HOU", ASTROS: "HOU", HOU: "HOU",
    KANSAS: "KC", ROYALS: "KC", KC: "KC", KCR: "KC",
    ANGELS: "LAA", LAA: "LAA",
    DODGERS: "LAD", LAD: "LAD",
    MIAMI: "MIA", MARLINS: "MIA", MIA: "MIA",
    MILWAUKEE: "MIL", BREWERS: "MIL", MIL: "MIL",
    MINNESOTA: "MIN", TWINS: "MIN", MIN: "MIN",
    METS: "NYM", NYM: "NYM",
    YANKEES: "NYY", NYY: "NYY",
    ATHLETICS: "ATH", ATH: "ATH", OAK: "ATH",
    PHILADELPHIA: "PHI", PHILLIES: "PHI", PHI: "PHI",
    PITTSBURGH: "PIT", PIRATES: "PIT", PIT: "PIT",
    PADRES: "SD", SD: "SD", SDP: "SD",
    GIANTS: "SF", SF: "SF", SFG: "SF",
    SEATTLE: "SEA", MARINERS: "SEA", SEA: "SEA",
    CARDINALS: "STL", STL: "STL",
    RAYS: "TB", TB: "TB", TBR: "TB",
    TEXAS: "TEX", RANGERS: "TEX", TEX: "TEX",
    TORONTO: "TOR", "BLUE JAYS": "TOR", TOR: "TOR",
    WASHINGTON: "WSH", NATIONALS: "WSH", WSH: "WSH", WAS: "WSH"
  };
  return map[s] || s;
}

function normMarket(stat) {
  const s = String(stat || "").toLowerCase();

  if (s.includes("1st inning runs allowed")) return "runs_allowed";
  if (s.includes("pitcher strikeouts") || s === "ks") return "strikeouts";
  if (s.includes("earned runs allowed")) return "earned_runs_allowed";
  if (s.includes("walks allowed")) return "walks_allowed";
  if (s.includes("hits+runs+rbis") || s.includes("hits + runs + rbis") || s.includes("hrr")) return "hrr";
  if (s.includes("hitter fantasy score") || s.includes("fantasy score")) return "hitter_fantasy_score";

  return s.replace(/\s+/g, "_").trim();
}

function sideListForTier(tier) {
  const t = String(tier || "standard").toLowerCase();
  if (t === "goblin" || t === "demon") return ["MORE"];
  return ["LESS", "MORE"];
}

function buildIncludedMaps(raw) {
  const maps = {
    players: new Map(),
    games: new Map(),
    durations: new Map()
  };

  for (const item of raw.included || []) {
    if (item.type === "new_player") maps.players.set(String(item.id), item.attributes || {});
    if (item.type === "game") maps.games.set(String(item.id), item.attributes || {});
    if (item.type === "duration") maps.durations.set(String(item.id), item.attributes || {});
  }

  return maps;
}

function gameTextFromGame(game) {
  const away = normTeam(game?.metadata?.game_info?.teams?.away?.abbreviation);
  const home = normTeam(game?.metadata?.game_info?.teams?.home?.abbreviation);
  if (away && home) return `${away} @ ${home}`;
  return null;
}

function makeRows(item, maps) {
  const a = item.attributes || {};
  const rel = item.relationships || {};
  const stat = a.stat_type || a.stat_display_name || "";
  const market = normMarket(stat);
  const tier = String(a.odds_type || "standard").toLowerCase();
  const game = maps.games.get(String(rel.game?.data?.id || ""));
  const player = maps.players.get(String(rel.new_player?.data?.id || ""));
  const duration = maps.durations.get(String(rel.duration?.data?.id || ""));
  const durationName = String(duration?.name || "").toLowerCase();

  const rows = [];

  // True combo micro: 1st Inning Runs Allowed.
  if (a.event_type === "combo" && String(stat).toLowerCase().includes("1st inning runs allowed")) {
    for (const side of sideListForTier(tier)) {
      rows.push({
        date,
        prizepicksId: item.id,
        sourceType: "combo_micro",
        player: a.description,
        team: a.description,
        game: String(a.description || "").includes("/") ? String(a.description).split("/").map(normTeam).join("/") : a.description,
        market,
        side,
        line: Number(a.line_score),
        inningWindow: "1",
        oddsTier: tier,
        status: a.status || null,
        startTime: a.start_time || null,
        gameId: a.game_id || game?.external_game_id || null,
        durationId: rel.duration?.data?.id || null,
        durationName: duration?.name || null,
        trackOnly: true
      });
    }
  }

  // Team-event full-duration alternate pitcher props.
  // These are not inning micro unless PrizePicks sends a non-Full duration later.
  if (
    a.event_type === "team" &&
    ["strikeouts", "earned_runs_allowed", "walks_allowed", "hrr"].includes(market)
  ) {
    const inningWindow = durationName && durationName !== "full" ? duration?.name : "full";

    for (const side of sideListForTier(tier)) {
      rows.push({
        date,
        prizepicksId: item.id,
        sourceType: durationName === "full" ? "team_alt_full" : "team_micro_duration",
        player: player?.display_name || player?.name || null,
        team: normTeam(player?.team || a.description),
        game: gameTextFromGame(game) || a.game_id || null,
        market,
        side,
        line: Number(a.line_score),
        inningWindow,
        oddsTier: tier,
        status: a.status || null,
        startTime: a.start_time || null,
        gameId: a.game_id || game?.external_game_id || null,
        durationId: rel.duration?.data?.id || null,
        durationName: duration?.name || null,
        trackOnly: true
      });
    }
  }

  return rows;
}

const raw = read(RAW, null);

if (!raw || !Array.isArray(raw.data)) {
  console.error(`Missing or invalid ${RAW}`);
  process.exit(1);
}

const maps = buildIncludedMaps(raw);
const rows = [];

for (const item of raw.data) {
  rows.push(...makeRows(item, maps));
}

write(OUT_RAW, rows);

const summary = rows.reduce((acc, r) => {
  const key = `${r.sourceType} | ${r.inningWindow} | ${r.market} | ${r.oddsTier}`;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

console.log("PRIZEPICKS MLB LIVE/MICRO CAPTURE");
console.log("---------------------------------");
console.log("date:", date);
console.log("raw rows:", raw.data.length);
console.log("rows written:", rows.length);
console.log("saved:", OUT_RAW);
console.table(Object.entries(summary).map(([bucket, count]) => ({ bucket, count })));
console.table(rows.slice(0, 40).map(r => ({
  player: r.player,
  inningRange: r.inningWindow,
  market: r.market,
  side: r.side,
  line: r.line,
  tier: r.oddsTier,
  sourceType: r.sourceType,
  duration: r.durationName
})));
