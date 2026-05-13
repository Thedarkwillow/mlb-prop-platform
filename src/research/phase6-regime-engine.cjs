const fs = require("fs");

function readJson(p, fallback) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback; }
  catch { return fallback; }
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sideOf(v) {
  return String(v || "").toUpperCase().includes("LESS") ? "LESS" : "MORE";
}

function marketOf(r) {
  return norm(r.market || r.stat || r.statKey);
}

function resultOf(r) {
  const raw = String(r.result || r.grade || r.outcome || r.status || "").toUpperCase();
  if (["WIN", "WON", "HIT", "CASH", "GREEN"].includes(raw)) return "WIN";
  if (["LOSS", "LOST", "MISS", "RED"].includes(raw)) return "LOSS";
  return null;
}

function dateOf(r, fallbackDate) {
  const raw = r.date || r.gameDate || r.createdAt || r.settledAt || r.startTime || fallbackDate;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return fallbackDate;
  return d.toISOString().slice(0, 10);
}

function daysAgo(dateStr, now = new Date()) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Math.floor((now - d) / 86400000);
}

function add(group, key, r) {
  group[key] ||= { key, sample: 0, wins: 0, losses: 0 };
  group[key].sample++;
  if (r.result === "WIN") group[key].wins++;
  if (r.result === "LOSS") group[key].losses++;
}

function finalize(group) {
  for (const g of Object.values(group)) {
    g.hitRate = g.sample ? +(g.wins / g.sample).toFixed(4) : null;

    if (g.sample < 8) {
      g.regime = "LOW_SAMPLE";
      g.exposureMultiplier = 1;
      g.scoreMultiplier = 1;
    } else if (g.hitRate < 0.42) {
      g.regime = "COLD";
      g.exposureMultiplier = 0.35;
      g.scoreMultiplier = 0.55;
    } else if (g.hitRate < 0.50) {
      g.regime = "WEAK";
      g.exposureMultiplier = 0.65;
      g.scoreMultiplier = 0.75;
    } else if (g.hitRate > 0.62) {
      g.regime = "HOT";
      g.exposureMultiplier = 1.1;
      g.scoreMultiplier = 1.05;
    } else {
      g.regime = "NORMAL";
      g.exposureMultiplier = 1;
      g.scoreMultiplier = 1;
    }
  }
}

const files = [
  "outputs/all-markets-graded.json",
  "outputs/graded-props.json",
  "outputs/history.json",
  "outputs/fantasy-graded.json"
];

if (fs.existsSync("outputs/history")) {
  for (const f of fs.readdirSync("outputs/history")) {
    if (f.endsWith(".json")) files.push(`outputs/history/${f}`);
  }
}

const rows = [];

for (const file of files) {
  const fallbackDateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
  const fallbackDate = fallbackDateMatch ? fallbackDateMatch[1] : new Date().toISOString().slice(0, 10);
  const raw = readJson(file, []);
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.rows) ? raw.rows : Object.values(raw || {});

  for (const r of arr) {
    const result = resultOf(r);
    const market = marketOf(r);
    if (!result || !market) continue;

    rows.push({
      market,
      side: sideOf(r.side || r.recommendedSide),
      result,
      date: dateOf(r, fallbackDate)
    });
  }
}

const windows = { "3d": {}, "7d": {}, "14d": {} };

for (const r of rows) {
  const age = daysAgo(r.date);
  const key = `${r.market}_${r.side}`;

  if (age <= 3) add(windows["3d"], key, r);
  if (age <= 7) add(windows["7d"], key, r);
  if (age <= 14) add(windows["14d"], key, r);
}

for (const group of Object.values(windows)) finalize(group);

const combined = {};
const keys = new Set([
  ...Object.keys(windows["3d"]),
  ...Object.keys(windows["7d"]),
  ...Object.keys(windows["14d"])
]);

for (const key of keys) {
  const r3 = windows["3d"][key];
  const r7 = windows["7d"][key];
  const r14 = windows["14d"][key];

  const regimes = [r3, r7, r14].filter(Boolean).map(x => x.regime);
  const coldCount = regimes.filter(x => x === "COLD").length;
  const weakCount = regimes.filter(x => x === "WEAK").length;
  const hotCount = regimes.filter(x => x === "HOT").length;

  let action = "ALLOW";
  let scoreMultiplier = 1;
  let exposureCapMultiplier = 1;

  if (coldCount >= 1 || weakCount >= 2) {
    action = "TIGHTEN";
    scoreMultiplier = 0.7;
    exposureCapMultiplier = 0.5;
  }
  if (coldCount >= 2) {
    action = "SUPPRESS_RECENT";
    scoreMultiplier = 0.45;
    exposureCapMultiplier = 0.25;
  }
  if (hotCount >= 2) {
    action = "BOOST_RECENT";
    scoreMultiplier = 1.05;
    exposureCapMultiplier = 1.1;
  }

  combined[key] = {
    key,
    action,
    scoreMultiplier,
    exposureCapMultiplier,
    d3: r3 || null,
    d7: r7 || null,
    d14: r14 || null
  };
}

const out = {
  createdAt: new Date().toISOString(),
  sourceRows: rows.length,
  windows,
  combined
};

fs.mkdirSync("data/learning", { recursive: true });
fs.writeFileSync("data/learning/phase6-regime-detection.json", JSON.stringify(out, null, 2));

console.log("PHASE 6 REGIME DETECTION BUILT");
console.log("graded rows:", rows.length);
console.table(Object.values(combined).slice(0, 25).map(x => ({
  key: x.key,
  action: x.action,
  scoreMultiplier: x.scoreMultiplier,
  d3: x.d3?.hitRate ?? null,
  d7: x.d7?.hitRate ?? null,
  d14: x.d14?.hitRate ?? null
})));
