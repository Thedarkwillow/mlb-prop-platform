const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(String(r.result || "").toUpperCase()));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const profit = hits - misses;
  return {
    picks: graded.length,
    hits,
    misses,
    pushes,
    hitRate: graded.length ? Number((hits / graded.length).toFixed(4)) : null,
    roi: graded.length ? Number((profit / graded.length).toFixed(4)) : null
  };
}

function groupBy(rows, fn) {
  const out = {};
  for (const r of rows) {
    const k = fn(r);
    if (!out[k]) out[k] = [];
    out[k].push(r);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, summarize(v)]));
}

const shadow = read(`outputs/history/${DATE}-shadow-graded.json`, []);
const playable = read(`outputs/playable-final-slips-graded-${DATE}.json`, []);

const playableLegs = [];
for (const slip of playable) {
  for (const leg of slip.legs || []) playableLegs.push(leg);
}

const report = {
  date: DATE,
  shadow: {
    overall: summarize(shadow),
    byMarket: groupBy(shadow, r => String(r.market || "unknown").toLowerCase()),
    byMarketSide: groupBy(shadow, r => `${String(r.market || "unknown").toLowerCase()} ${String(r.side || "").toUpperCase()}`),
    rows: shadow
  },
  playable: {
    overall: summarize(playableLegs),
    byMarket: groupBy(playableLegs, r => String(r.market || "unknown").toLowerCase()),
    byMarketSide: groupBy(playableLegs, r => `${String(r.market || "unknown").toLowerCase()} ${String(r.side || "").toUpperCase()}`),
    rows: playableLegs
  }
};

fs.writeFileSync(`outputs/shadow-roi-${DATE}.json`, JSON.stringify(report, null, 2));
fs.writeFileSync("outputs/shadow-roi-latest.json", JSON.stringify(report, null, 2));

console.log(`SHADOW ROI REPORT ${DATE}`);
console.log("Shadow overall:");
console.table([report.shadow.overall]);
console.log("Shadow by market:");
console.table(Object.entries(report.shadow.byMarket).map(([bucket, x]) => ({ bucket, ...x })));
console.log("Playable overall:");
console.table([report.playable.overall]);
console.log("Playable by market:");
console.table(Object.entries(report.playable.byMarket).map(([bucket, x]) => ({ bucket, ...x })));
console.log(`Wrote outputs/shadow-roi-${DATE}.json`);
