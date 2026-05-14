const fs = require("fs");

function readJson(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function asDate(x) {
  const s = String(x || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function normMarket(x) {
  return String(x || "unknown").toLowerCase().replace(/\s+/g, "_").trim();
}

function normSide(x) {
  return String(x || "").toUpperCase().trim() || "NA";
}

function num(x, fallback = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function resultOf(row) {
  const r = String(row.result || row.gradeResult || row.outcome || "").toUpperCase();
  if (["HIT", "WIN", "WON"].includes(r)) return "WIN";
  if (["MISS", "LOSS", "LOST"].includes(r)) return "LOSS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";
  return "UNKNOWN";
}

function profitFor(row) {
  const r = resultOf(row);
  if (r === "WIN") return 1;
  if (r === "LOSS") return -1;
  return 0;
}

function probBucket(row) {
  const p = num(row.calibratedDistributionProb ?? row.recommendedProb ?? row.probability ?? row.prob);
  if (p == null) return "unknown";
  const lo = Math.floor(p * 20) / 20;
  const hi = lo + 0.05;
  return `${lo.toFixed(2)}-${hi.toFixed(2)}`;
}

function edgeBucket(row) {
  const e = num(row.adjustedEdge ?? row.sportsbookAdjustedEdge ?? row.edge ?? row.sportsbookEdge);
  if (e == null) return "unknown";
  if (e < 0.06) return "<0.06";
  if (e < 0.10) return "0.06-0.10";
  if (e < 0.14) return "0.10-0.14";
  if (e < 0.18) return "0.14-0.18";
  return ">=0.18";
}

function confidenceBucket(row) {
  return String(
    row.calibratedConfidence?.confidence ||
    row.confidenceBucket ||
    row.confidence ||
    row.grade ||
    "unknown"
  ).toLowerCase();
}

function getDate(row) {
  return asDate(
    row.date ||
    row.gradingDate ||
    row.slateDate ||
    row.gameDate ||
    row.createdDate ||
    row.savedDate
  );
}

function loadRows() {
  const files = [
    "data/results/prop-warehouse.json",
    "data/results/graded-leg-history.json"
  ];

  const rows = [];
  const seen = new Set();

  for (const f of files) {
    const data = readJson(f, []);
    const arr = Array.isArray(data) ? data : data.rows || data.legs || [];
    for (const row of arr) {
      const date = getDate(row);
      const result = resultOf(row);
      if (!date || !["WIN", "LOSS", "PUSH"].includes(result)) continue;

      const key = [
        date,
        row.player,
        row.market || row.stat,
        row.side || row.recommendedSide,
        row.line,
        row.game || row.sportsbookGame
      ].join("|");

      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        ...row,
        _date: date,
        _result: result,
        _profit: profitFor(row),
        _market: normMarket(row.market || row.stat),
        _side: normSide(row.side || row.recommendedSide)
      });
    }
  }

  return rows.sort((a, b) => a._date.localeCompare(b._date));
}

function summarize(rows, keyFn) {
  const map = new Map();

  for (const row of rows) {
    const key = keyFn(row);
    if (!map.has(key)) {
      map.set(key, {
        bucket: key,
        count: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        profit: 0
      });
    }

    const x = map.get(key);
    x.count += 1;
    if (row._result === "WIN") x.wins += 1;
    else if (row._result === "LOSS") x.losses += 1;
    else x.pushes += 1;
    x.profit += row._profit;
  }

  return [...map.values()]
    .map(x => ({
      ...x,
      hitRate: x.wins + x.losses > 0 ? Number((x.wins / (x.wins + x.losses)).toFixed(4)) : null,
      roi: x.count > 0 ? Number((x.profit / x.count).toFixed(4)) : null,
      roiPct: x.count > 0 ? `${((x.profit / x.count) * 100).toFixed(1)}%` : null
    }))
    .sort((a, b) => b.count - a.count || String(a.bucket).localeCompare(String(b.bucket)));
}

function dateMinus(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

const requestedDate = process.env.npm_config_date || process.argv[2] || new Date().toISOString().slice(0, 10);
const rows = loadRows();
const latestDate = rows.length ? rows[rows.length - 1]._date : requestedDate;
const asOf = asDate(requestedDate) || latestDate;

const windows = [7, 15, 30];
const report = {
  generatedAt: new Date().toISOString(),
  asOf,
  totalRows: rows.length,
  windows: {}
};

for (const days of windows) {
  const start = dateMinus(asOf, days);
  const windowRows = rows.filter(r => r._date >= start && r._date <= asOf);

  report.windows[`${days}d`] = {
    start,
    end: asOf,
    rows: windowRows.length,
    byMarket: summarize(windowRows, r => r._market),
    byMarketSide: summarize(windowRows, r => `${r._market} ${r._side}`),
    byConfidence: summarize(windowRows, confidenceBucket),
    byProbabilityBucket: summarize(windowRows, probBucket),
    byEdgeBucket: summarize(windowRows, edgeBucket)
  };
}

writeJson("data/results/rolling-roi-windows.json", report);
writeJson(`outputs/rolling-roi-windows-${asOf}.json`, report);

console.log("ROLLING ROI WINDOWS");
console.log("===================");
console.log("asOf:", asOf);
console.log("rows:", rows.length);

for (const days of windows) {
  const key = `${days}d`;
  const w = report.windows[key];
  console.log(`\n${key}: ${w.start} → ${w.end} | rows=${w.rows}`);
  console.log("BY MARKET");
  console.table(w.byMarket.slice(0, 12));
  console.log("BY MARKET+SIDE");
  console.table(w.byMarketSide.slice(0, 12));
}
