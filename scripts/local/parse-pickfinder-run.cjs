const fs = require("fs");
const path = require("path");

const RUN_DIR = process.argv[2] || process.env.PICKFINDER_RUN_DIR;
const TARGETS_FILE = process.env.TARGETS_FILE || null;
const OUT = process.env.OUT || "manual-pickfinder-signals-from-capture.json";

if (!RUN_DIR) {
  console.error("Usage: node parse-pickfinder-run.cjs <pickfinder-board-run/TIMESTAMP>");
  process.exit(1);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file) === "." ? "." : path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function marketFromPickFinderStat(stat) {
  const s = norm(stat);
  if (s === "total bases") return "bases";
  if (s === "hits") return "hits";
  if (s === "runs") return "runs";
  if (s === "batter walks") return "walks";
  if (s === "hits runs rbis" || s === "hits+runs+rbis") return "hrr";
  if (s === "hits allowed") return "hits_allowed";
  if (s === "pitcher strikeouts") return "strikeouts";
  if (s === "walks allowed") return "walks_allowed";
  if (s === "earned runs allowed") return "earned_runs_allowed";
  if (s === "pitching outs") return "pitching_outs";
  if (s.includes("pitcher fantasy score")) return "pitcher_fantasy_score";
  if (s.includes("hitter fantasy score")) return "hitter_fantasy_score";
  if (s === "hitter strikeouts") return "hitter_strikeouts";
  if (s === "rbis") return "rbis";
  if (s === "singles") return "singles";
  if (s === "doubles") return "doubles";
  if (s === "home runs") return "home_runs";
  if (s === "stolen bases") return "stolen_bases";
  return s.replace(/\s+/g, "_");
}

function targetMarketMatches(targetMarket, item) {
  const pfMarket = marketFromPickFinderStat(item.stat);
  if (targetMarket === pfMarket) return true;

  const pos = String(item.player_position || "").toUpperCase();
  if (pos === "SP" || pos === "P" || pos === "RP") {
    if (targetMarket === "hits" && pfMarket === "hits_allowed") return true;
    if (targetMarket === "walks" && pfMarket === "walks_allowed") return true;
  }

  return false;
}

function sideAdjusted(value, side) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return side === "LESS" ? Number((100 - n).toFixed(1)) : Number(n.toFixed(1));
}

function loadTargets(runDir) {
  const progress = readJson(path.join(runDir, "per-target-progress.json"), []);
  if (Array.isArray(progress) && progress.length) return progress.map(r => r.target).filter(Boolean);

  const tf = TARGETS_FILE || path.join(runDir, "targets.json");
  const data = readJson(tf, { rows: [] });
  return Array.isArray(data.rows) ? data.rows : [];
}

function loadItems(runDir) {
  const respDir = path.join(runDir, "responses");
  const files = fs.existsSync(respDir)
    ? fs.readdirSync(respDir).filter(f => f.endsWith(".json")).map(f => path.join(respDir, f))
    : [];

  const items = [];
  for (const file of files) {
    const wrapper = readJson(file, null);
    const body = wrapper && wrapper.body;
    if (body && Array.isArray(body.items)) {
      for (const item of body.items) {
        items.push({ ...item, _sourceFile: file, _url: wrapper.url || null });
      }
    }
  }
  return items;
}

const targets = loadTargets(RUN_DIR);
const items = loadItems(RUN_DIR);

const rows = [];
const misses = [];

for (const target of targets) {
  const player = target.player;
  const market = target.market;
  const side = String(target.side || "").toUpperCase();
  const line = Number(target.line);

  const samePlayerMarket = items.filter(item =>
    norm(item.player_name) === norm(player) &&
    targetMarketMatches(market, item)
  );

  const exactCandidates = samePlayerMarket.filter(item =>
    Math.abs(Number(item.line) - line) < 1e-9
  );

  let item = exactCandidates[0] || null;
  let matchType = "exact_line";

  // PitchFinder sometimes exposes only nearby pitcher lines.
  // Example: target K LESS 5.5, captured Pitcher Strikeouts 4.5.
  // Use nearest same-player/same-market line as a fallback, but mark it clearly.
  if (!item && samePlayerMarket.length) {
    const sorted = samePlayerMarket
      .map(x => ({ item: x, distance: Math.abs(Number(x.line) - line) }))
      .filter(x => Number.isFinite(x.distance))
      .sort((a, b) => a.distance - b.distance);

    if (sorted.length && sorted[0].distance <= 1.5) {
      item = sorted[0].item;
      matchType = `nearby_line_${item.line}_for_target_${line}`;
    }
  }

  if (!item) {
    misses.push({
      player,
      market,
      side,
      line,
      samePlayerMarketLines: samePlayerMarket.map(x => ({
        stat: x.stat,
        line: x.line,
        position: x.player_position
      })).slice(0, 20)
    });
    continue;
  }

  rows.push({
    player,
    market,
    side,
    line,
    pickfinderLine: Number(item.line),
    pickfinderStat: item.stat,
    pickfinderMatchType: matchType,
    l5: sideAdjusted(item.hitRateLast5, side),
    l10: sideAdjusted(item.hitRateLast10, side),
    l15: sideAdjusted(item.hitRateLast15, side),
    season: sideAdjusted(item.hrSeason, side),
    vsPitcher: sideAdjusted(item.hitRateH2H, side),
    averageLast10: item.averageLast10 ?? null,
    differenceLast10: item.differenceLast10 ?? null,
    notes: [
      "auto PickFinder capture",
      `matchType=${matchType}`,
      `targetLine=${line}`,
      `pickfinderLine=${item.line}`,
      `stat=${item.stat}`,
      `game=${item.game_string || ""}`,
      `avgLast10=${item.averageLast10 ?? "n/a"}`,
      `diffLast10=${item.differenceLast10 ?? "n/a"}`,
      "side-adjusted hit rates"
    ].join("; ")
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  sourceRunDir: RUN_DIR,
  targets: targets.length,
  responseItems: items.length,
  matchedSignals: rows.length,
  unmatched: misses,
  rows
};

writeJson(OUT, output);

console.log("PARSE PICKFINDER RUN");
console.log("====================");
console.log(`runDir: ${RUN_DIR}`);
console.log(`targets: ${targets.length}`);
console.log(`responseItems: ${items.length}`);
console.log(`matchedSignals: ${rows.length}`);
console.log(`unmatched: ${misses.length}`);
console.log(`saved: ${OUT}`);
console.table(rows.slice(0, 20).map(r => ({
  player: r.player,
  prop: `${r.market} ${r.side} ${r.line}`,
  l5: r.l5,
  l10: r.l10,
  l15: r.l15,
  season: r.season,
  vsPitcher: r.vsPitcher
})));
if (misses.length) {
  console.log("Unmatched:");
  console.table(misses);
}
