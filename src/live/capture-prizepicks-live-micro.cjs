const fs = require("fs");
const { execFileSync } = require("child_process");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const rawPath = "data/prizepicks-raw-latest.json";
const outPath = "outputs/mlb-live-board-raw.json";

function read(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function normMarket(s) {
  return String(s || "").toLowerCase();
}

function isMicroMarket(attrs) {
  const text = [
    attrs.stat_type,
    attrs.stat_display_name,
    attrs.description,
    attrs.projection_type
  ].map(x => String(x || "")).join(" ").toLowerCase();

  return (
    text.includes("inning") ||
    text.includes("1st") ||
    text.includes("2nd") ||
    text.includes("3rd") ||
    text.includes("4th") ||
    text.includes("5th") ||
    attrs.is_live === true ||
    attrs.in_game === true ||
    attrs.status !== "pre_game"
  );
}

function inningRange(attrs) {
  const text = [
    attrs.stat_type,
    attrs.stat_display_name,
    attrs.description
  ].map(x => String(x || "")).join(" ");

  const range = text.match(/([1-9])\s*(?:\+|-|to|through)\s*([1-9])/i);
  if (range) return `${Number(range[1])}-${Number(range[2])}`;

  const single = text.match(/([1-9])(?:st|nd|rd|th)?\s*inning/i);
  if (single) return `${Number(single[1])}`;

  return null;
}

function marketName(attrs) {
  return attrs.stat_display_name || attrs.stat_type || null;
}

function tier(attrs) {
  const oddsType = String(attrs.odds_type || attrs.adjusted_odds || "").toLowerCase();
  if (oddsType.includes("goblin")) return "goblin";
  if (oddsType.includes("demon")) return "demon";
  if (attrs.adjusted_odds === true && Number(attrs.line_score) < 0) return "goblin";
  return "standard";
}

function expandSides(row) {
  if (row.oddsTier === "goblin" || row.oddsTier === "demon") {
    return [{ ...row, side: "MORE" }];
  }
  return [
    { ...row, side: "LESS" },
    { ...row, side: "MORE" }
  ];
}

const raw = read(rawPath, null);
if (!raw || !Array.isArray(raw.data)) {
  console.error(`Missing or invalid ${rawPath}`);
  process.exit(1);
}

const rows = raw.data
  .map(item => {
    const a = item.attributes || {};
    const market = marketName(a);
    const line = Number(a.line_score);
    const range = inningRange(a);
    const oddsTier = tier(a);

    if (!market || !Number.isFinite(line) || !isMicroMarket(a)) return null;

    // PrizePicks micro markets can be player, pitcher, team, or game props.
    // For team/game micro rows, description is still useful as the tracked entity.
    const entity = a.description || a.name || null;

    return {
      date,
      prizepicksId: item.id,
      player: entity,
      team: entity,
      game: entity,
      inningRange: range,
      market,
      line,
      oddsTier,
      startTime: a.start_time,
      gameId: a.game_id,
      status: a.status,
      isLive: a.is_live,
      inGame: a.in_game,
      source: "prizepicks_auto_micro_capture"
    };
  })
  .filter(Boolean)
  .flatMap(expandSides);

fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));

console.log("PRIZEPICKS MLB LIVE/MICRO CAPTURE");
console.log("---------------------------------");
console.log("date:", date);
console.log("raw rows:", raw.data.length);
console.log("micro rows written:", rows.length);
console.log("saved:", outPath);
console.table(rows.slice(0, 30).map(r => ({
  player: r.player,
  inningRange: r.inningRange,
  market: r.market,
  side: r.side,
  line: r.line,
  tier: r.oddsTier,
  status: r.status
})));

if (rows.length > 0) {
  execFileSync("npm", ["run", "live:track", "--", date], { stdio: "inherit" });
  execFileSync("npm", ["run", "live:resolve", "--", date], { stdio: "inherit" });
} else {
  console.log("No MLB Live/micro rows found. Nothing to track.");
}
