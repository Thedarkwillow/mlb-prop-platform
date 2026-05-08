const fs = require("fs");
const path = require("path");

const NOW = new Date().toISOString();
const DATE = process.argv[2] || process.env.npm_config_date || NOW.slice(0, 10);
const IN = "data/vegas-raw.json";
const OUT_DIR = `data/odds-history/${DATE}`;

if (!fs.existsSync(IN)) throw new Error(`Missing ${IN}. Run npm run odds first only when you want fresh odds.`);
fs.mkdirSync(OUT_DIR, { recursive: true });

const rows = JSON.parse(fs.readFileSync(IN, "utf8"));
const out = rows.map(r => ({
  snapshotTime: NOW,
  slateDate: DATE,
  source: r.source || "oddsapi",
  sportsbook: r.sportsbook,
  game: r.game,
  eventId: r.eventId,
  commenceTime: r.commenceTime,
  player: r.player,
  market: r.market,
  rawMarket: r.rawMarket,
  side: r.side,
  line: r.line,
  odds: r.odds,
  impliedProb: r.impliedProb,
  lastUpdate: r.lastUpdate
})).filter(r => r.player && r.market && r.side && r.line != null && r.odds != null);

const stamp = NOW.replace(/[:.]/g, "-");
const file = `${OUT_DIR}/odds-snapshot-${stamp}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 2));
fs.writeFileSync(`${OUT_DIR}/latest.json`, JSON.stringify(out, null, 2));

console.log(`saved odds snapshot: ${file}`);
console.log(`rows: ${out.length}`);
