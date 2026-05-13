const fs = require("fs");
const path = require("path");

function readJson(p, fallback = []) {
  try {
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sideOf(r) {
  return String(r.side || r.recommendedSide || r.pickSide || r.pick || "").toUpperCase().includes("LESS")
    ? "LESS"
    : "MORE";
}

function marketOf(r) {
  return norm(r.market || r.stat || r.prop || r.pick || "");
}

function resultOf(r) {
  const raw = String(r.result || r.grade || r.outcome || r.status || "").toUpperCase();
  if (["WIN", "WON", "HIT", "CASH"].includes(raw)) return "WIN";
  if (["LOSS", "LOST", "MISS"].includes(raw)) return "LOSS";
  return null;
}

function dateOf(r) {
  return String(r.date || r.gameDate || r.gradingDate || r.createdAt || "").slice(0, 10);
}

function collectRows() {
  const files = [
    "outputs/all-markets-graded.json",
    "outputs/fantasy-graded.json",
    "outputs/graded-props.json",
    "outputs/history.json",
    ...fs.existsSync("outputs/history")
      ? fs.readdirSync("outputs/history").filter(f => f.endsWith(".json")).map(f => `outputs/history/${f}`)
      : []
  ];

  const rows = [];
  for (const f of files) {
    const data = readJson(f, []);
    if (Array.isArray(data)) {
      for (const row of data) rows.push(row);
    } else if (Array.isArray(data.rows)) {
      for (const row of data.rows) rows.push(row);
    } else if (Array.isArray(data.props)) {
      for (const row of data.props) rows.push(row);
    }
  }
  return rows;
}

const HARD_BANNED = [
  "strikeouts_MORE",
  "runs_MORE",
  "rbis_MORE",
  "hitter_fantasy_score_MORE",
  "pitcher_fantasy_score_MORE",
  "hits_allowed_MORE",
  "walks_allowed_MORE",
  "earned_runs_allowed_MORE"
];

const rows = collectRows()
  .map(r => ({
    ...r,
    market: marketOf(r),
    side: sideOf(r),
    result: resultOf(r),
    date: dateOf(r)
  }))
  .filter(r => r.result === "WIN" || r.result === "LOSS");

const byKey = new Map();

for (const r of rows) {
  const key = `${r.market}_${r.side}`;
  if (!HARD_BANNED.includes(key)) continue;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}

function summarize(key, arr) {
  arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const sample = arr.length;
  const wins = arr.filter(r => r.result === "WIN").length;
  const losses = arr.filter(r => r.result === "LOSS").length;
  const hitRate = sample ? wins / sample : null;

  const dates = [...new Set(arr.map(r => r.date).filter(Boolean))].sort();
  const last7Dates = dates.slice(-7);
  const last7 = arr.filter(r => last7Dates.includes(r.date));
  const d7Sample = last7.length;
  const d7Wins = last7.filter(r => r.result === "WIN").length;
  const d7HitRate = d7Sample ? d7Wins / d7Sample : null;

  const latestDate = dates.at(-1);
  const latestRows = latestDate ? arr.filter(r => r.date === latestDate) : [];
  const latestWins = latestRows.filter(r => r.result === "WIN").length;
  const latestLosses = latestRows.filter(r => r.result === "LOSS").length;
  const recentZeroForDay = latestRows.length >= 2 && latestWins === 0 && latestLosses > 0;

  let status = "KEEP_HARD_BANNED";
  let reason = "insufficient recovery";

  if (sample >= 50 && hitRate >= 0.52 && d7Sample >= 10 && d7HitRate >= 0.55 && !recentZeroForDay) {
    status = "WATCH_ELIGIBLE";
    reason = "sample and recent hit rate support watchlist reactivation";
  } else if (sample >= 30 && d7Sample >= 8 && d7HitRate >= 0.55 && !recentZeroForDay) {
    status = "MONITOR_CLOSE";
    reason = "recent form improving but not enough total sample";
  }

  return {
    key,
    sample,
    wins,
    losses,
    hitRate: hitRate == null ? null : Number(hitRate.toFixed(4)),
    d7Sample,
    d7HitRate: d7HitRate == null ? null : Number(d7HitRate.toFixed(4)),
    latestDate,
    latestWins,
    latestLosses,
    recentZeroForDay,
    status,
    reason,
    watchGate: {
      minProb: 0.65,
      minBooks: 5,
      minEdge: 0.20
    }
  };
}

const report = HARD_BANNED.map(k => summarize(k, byKey.get(k) || []));

const out = {
  createdAt: new Date().toISOString(),
  mode: "REPORT_ONLY_NOT_WIRED",
  hardBannedMarkets: HARD_BANNED,
  rules: {
    watchEligible: "sample >= 50 && overall hitRate >= 52% && d7 sample >= 10 && d7 hitRate >= 55% && no recent 0-for day",
    watchGate: "prob >= 0.65 && books >= 5 && edge >= 0.20"
  },
  report
};

writeJson("data/learning/phase6-hardban-reactivation.json", out);

let txt = "";
txt += "PHASE 6 HARDBAN REACTIVATION REPORT\n";
txt += "====================================\n";
txt += `Generated: ${out.createdAt}\n`;
txt += "Mode: REPORT ONLY - not wired into slipBuilder\n\n";

for (const r of report) {
  txt += `${r.key}\n`;
  txt += `  status: ${r.status}\n`;
  txt += `  sample: ${r.sample}\n`;
  txt += `  hitRate: ${r.hitRate}\n`;
  txt += `  d7Sample: ${r.d7Sample}\n`;
  txt += `  d7HitRate: ${r.d7HitRate}\n`;
  txt += `  latest: ${r.latestDate || "n/a"} ${r.latestWins}-${r.latestLosses}\n`;
  txt += `  reason: ${r.reason}\n`;
  txt += `  watchGate: prob>=0.65 books>=5 edge>=0.20\n\n`;
}

fs.writeFileSync("outputs/phase6-hardban-reactivation.txt", txt);

console.log(txt);
console.log("Wrote data/learning/phase6-hardban-reactivation.json");
console.log("Wrote outputs/phase6-hardban-reactivation.txt");
