const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

const INPUTS = [
  { path: "data/prizepicks-mlb-live-raw-latest.json", sourceFeed: "mlb_live_231" },
  { path: "data/prizepicks-raw-latest.json", sourceFeed: "mlb_main_2" }
];

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
    AZ: "AZ", ARI: "AZ", ATL: "ATL", BAL: "BAL", BOS: "BOS", CHC: "CHC", CWS: "CWS", CHW: "CWS",
    CIN: "CIN", CLE: "CLE", COL: "COL", DET: "DET", HOU: "HOU", KC: "KC", KCR: "KC",
    LAA: "LAA", LAD: "LAD", MIA: "MIA", MIL: "MIL", MIN: "MIN", NYM: "NYM", NYY: "NYY",
    ATH: "ATH", OAK: "ATH", PHI: "PHI", PIT: "PIT", SD: "SD", SDP: "SD", SF: "SF", SFG: "SF",
    SEA: "SEA", STL: "STL", TB: "TB", TBR: "TB", TEX: "TEX", TOR: "TOR", WSH: "WSH", WAS: "WSH"
  };
  return map[s] || s;
}

function normMarket(stat) {
  const s = String(stat || "").toLowerCase();

  if (s.includes("hits+runs+rbis") || s.includes("hits + runs + rbis") || s.includes("hrr")) return "hrr";
  if (s.includes("hitter fantasy score") || s.includes("fantasy score")) return "hitter_fantasy_score";
  if (s.includes("1st inning runs allowed")) return "runs_allowed";
  if (s.includes("pitcher strikeouts") || s.includes("strikeout") || s === "ks") return "strikeouts";
  if (s.includes("earned runs allowed")) return "earned_runs_allowed";
  if (s.includes("walks allowed")) return "walks_allowed";

  return s.replace(/\s+/g, "_").trim();
}

function inningWindowFromDuration(durationName, statType) {
  const d = String(durationName || "").toLowerCase();
  const s = String(statType || "").toLowerCase();

  if (d.includes("1+2+3+4+5") || s.includes("1+2+3+4+5") || s.includes("1-5")) return "1-5";
  if (d.includes("1+2+3") || s.includes("1+2+3") || s.includes("1-3")) return "1-3";
  if (d.includes("1+2") || s.includes("1+2") || s.includes("1-2")) return "1-2";
  if (d.includes("1st") || s.includes("1st inning")) return "1";
  if (d.includes("full")) return "full";

  return "full";
}

function sourceTypeFromWindow(sourceFeed, inningWindow) {
  if (sourceFeed === "mlb_live_231") return inningWindow === "full" ? "live_full" : "live_micro";
  return inningWindow === "1" ? "combo_micro" : "team_alt_full";
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

function shouldCapture(a, market, sourceFeed) {
  if (sourceFeed === "mlb_live_231") {
    return ["hrr", "hitter_fantasy_score", "strikeouts"].includes(market);
  }

  if (a.event_type === "combo" && String(a.stat_type || "").toLowerCase().includes("1st inning runs allowed")) return true;

  if (
    a.event_type === "team" &&
    ["strikeouts", "earned_runs_allowed", "walks_allowed", "hrr"].includes(market)
  ) return true;

  return false;
}

function makeRows(item, maps, sourceFeed) {
  const a = item.attributes || {};
  const rel = item.relationships || {};
  const stat = a.stat_type || a.stat_display_name || "";
  const market = normMarket(stat);
  const tier = String(a.odds_type || "standard").toLowerCase();
  const game = maps.games.get(String(rel.game?.data?.id || ""));
  const player = maps.players.get(String(rel.new_player?.data?.id || ""));
  const durationId = String(rel.duration?.data?.id || "");
  const duration = maps.durations.get(durationId) || {};
  const durationName = duration?.name || null;

  if (!shouldCapture(a, market, sourceFeed)) return [];

  const inningWindow = inningWindowFromDuration(durationName, stat);
  const sourceType = sourceTypeFromWindow(sourceFeed, inningWindow);

  const playerName =
    player?.display_name ||
    player?.name ||
    a.description ||
    null;

  const team =
    normTeam(player?.team || String(a.description || "").split(" ")[0]);

  const rows = [];

  for (const side of sideListForTier(tier)) {
    rows.push({
      date,
      sourceFeed,
      prizepicksId: item.id,
      sourceType,
      player: playerName,
      team,
      game: gameTextFromGame(game) || a.game_id || null,
      market,
      side,
      line: Number(a.line_score),
      inningWindow,
      oddsTier: tier,
      status: a.status || null,
      startTime: a.start_time || null,
      gameId: a.game_id || game?.external_game_id || null,
      durationId,
      durationName,
      statType: a.stat_type || null,
      statDisplayName: a.stat_display_name || null,
      groupKey: a.group_key || null,
      trackOnly: true
    });
  }

  return rows;
}

const rows = [];
const feedReports = [];

for (const input of INPUTS) {
  const raw = read(input.path, null);
  if (!raw || !Array.isArray(raw.data)) {
    feedReports.push({ sourceFeed: input.sourceFeed, path: input.path, found: false, rawRows: 0, written: 0 });
    continue;
  }

  const maps = buildIncludedMaps(raw);
  const before = rows.length;

  for (const item of raw.data) {
    rows.push(...makeRows(item, maps, input.sourceFeed));
  }

  feedReports.push({
    sourceFeed: input.sourceFeed,
    path: input.path,
    found: true,
    rawRows: raw.data.length,
    written: rows.length - before
  });
}

write(OUT_RAW, rows);

const summary = rows.reduce((acc, r) => {
  const key = `${r.sourceFeed} | ${r.sourceType} | ${r.inningWindow} | ${r.market} | ${r.oddsTier}`;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

console.log("PRIZEPICKS MLB LIVE/MICRO CAPTURE");
console.log("---------------------------------");
console.log("date:", date);
console.table(feedReports);
console.log("rows written:", rows.length);
console.log("saved:", OUT_RAW);
console.table(Object.entries(summary).map(([bucket, count]) => ({ bucket, count })).sort((a, b) => b.count - a.count));
console.table(rows.slice(0, 50).map(r => ({
  player: r.player,
  inningRange: r.inningWindow,
  market: r.market,
  side: r.side,
  line: r.line,
  tier: r.oddsTier,
  sourceFeed: r.sourceFeed,
  sourceType: r.sourceType,
  duration: r.durationName
})));
