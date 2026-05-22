const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function avg(arr) {
  const xs = arr.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function rate(num, den) {
  return den > 0 ? num / den : null;
}

function bucketTrend(v7, v30) {
  if (!Number.isFinite(v7) || !Number.isFinite(v30)) return "UNKNOWN";
  const diff = v7 - v30;
  if (diff >= 0.12) return "HOT";
  if (diff <= -0.12) return "COLD";
  return "STABLE";
}

const warehouse = readJson("data/results/prop-warehouse.json", []);
const rows = Array.isArray(warehouse) ? warehouse : (warehouse.rows || warehouse.props || []);

const byPlayer = new Map();

for (const r of rows) {
  const player = r.player || r.playerName || r.name;
  const market = r.market || r.stat;
  const result = String(r.result || r.outcome || "").toUpperCase();
  const date = r.date || r.slateDate || r.gameDate;

  if (!player || !market || !date) continue;

  const k = norm(player);
  if (!byPlayer.has(k)) {
    byPlayer.set(k, {
      player,
      key: k,
      rows: []
    });
  }

  byPlayer.get(k).rows.push({
    date,
    market: String(market).toLowerCase().replace(/\s+/g, "_"),
    result,
    hit: result === "HIT" ? 1 : result === "MISS" ? 0 : null
  });
}

function withinDays(rowDate, days) {
  const d = new Date(rowDate);
  const end = new Date(DATE);
  if (!Number.isFinite(d.getTime()) || !Number.isFinite(end.getTime())) return false;
  const diff = (end - d) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
}

const out = [];

for (const p of byPlayer.values()) {
  const decided = p.rows.filter(r => r.hit !== null);

  const makeWindow = days => {
    const xs = decided.filter(r => withinDays(r.date, days));
    return {
      sample: xs.length,
      hitRate: avg(xs.map(r => r.hit)),
      byMarket: Object.values(xs.reduce((acc, r) => {
        const k = r.market;
        acc[k] ||= { market: k, sample: 0, hits: 0, misses: 0 };
        acc[k].sample++;
        if (r.hit === 1) acc[k].hits++;
        if (r.hit === 0) acc[k].misses++;
        return acc;
      }, {})).map(x => ({
        ...x,
        hitRate: rate(x.hits, x.hits + x.misses)
      }))
    };
  };

  const w7 = makeWindow(7);
  const w15 = makeWindow(15);
  const w30 = makeWindow(30);

  out.push({
    player: p.player,
    key: p.key,
    asOfDate: DATE,
    rolling7: w7,
    rolling15: w15,
    rolling30: w30,
    trend: bucketTrend(w7.hitRate, w30.hitRate)
  });
}

fs.mkdirSync("data/context", { recursive: true });
fs.writeFileSync("data/context/rolling-form.json", JSON.stringify(out, null, 2));

console.log("ROLLING FORM REPORT");
console.log("===================");
console.log({ asOfDate: DATE, players: out.length });
console.table(out
  .filter(x => x.rolling30.sample >= 3)
  .slice(0, 25)
  .map(x => ({
    player: x.player,
    r7: x.rolling7.sample,
    r7Hit: x.rolling7.hitRate == null ? null : Number(x.rolling7.hitRate.toFixed(3)),
    r15: x.rolling15.sample,
    r15Hit: x.rolling15.hitRate == null ? null : Number(x.rolling15.hitRate.toFixed(3)),
    r30: x.rolling30.sample,
    r30Hit: x.rolling30.hitRate == null ? null : Number(x.rolling30.hitRate.toFixed(3)),
    trend: x.trend
  })));
console.log("Wrote data/context/rolling-form.json");
