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

function normMarket(x) {
  return String(x || "unknown").toLowerCase().replace(/\s+/g, "_").trim();
}

function normSide(x) {
  return String(x || "").toUpperCase().trim() || "NA";
}

function result(row) {
  const r = String(row.result || row.outcome || row.gradeResult || "").toUpperCase();
  if (["HIT", "WIN", "WON"].includes(r)) return "WIN";
  if (["MISS", "LOSS", "LOST"].includes(r)) return "LOSS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";
  return "UNKNOWN";
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
      const r = result(row);
      if (!["WIN", "LOSS"].includes(r)) continue;

      const key = [
        row.date || row.gradingDate || row.slateDate || "",
        row.player,
        row.market || row.stat,
        row.side || row.recommendedSide,
        row.line,
        row.game || row.sportsbookGame
      ].join("|");

      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        market: normMarket(row.market || row.stat),
        side: normSide(row.side || row.recommendedSide),
        result: r
      });
    }
  }

  return rows;
}

function summarize(rows, keyFn) {
  const map = new Map();

  for (const r of rows) {
    const key = keyFn(r);
    if (!map.has(key)) {
      map.set(key, {
        bucket: key,
        count: 0,
        wins: 0,
        losses: 0
      });
    }

    const x = map.get(key);
    x.count += 1;
    if (r.result === "WIN") x.wins += 1;
    else x.losses += 1;
  }

  return [...map.values()].map(x => {
    const hitRate = x.count ? x.wins / x.count : null;

    // Bernoulli variance proxy: highest near 50%, lower near extremes.
    const variance = hitRate == null ? null : hitRate * (1 - hitRate);

    let volatility = "unknown";
    let penalty = 0;

    if (x.count < 5) {
      volatility = "insufficient_sample";
      penalty = 0;
    } else if (variance >= 0.24) {
      volatility = "high";
      penalty = -0.035;
    } else if (variance >= 0.20) {
      volatility = "medium";
      penalty = -0.02;
    } else {
      volatility = "low";
      penalty = 0;
    }

    return {
      ...x,
      hitRate: hitRate == null ? null : Number(hitRate.toFixed(4)),
      variance: variance == null ? null : Number(variance.toFixed(4)),
      volatility,
      penalty
    };
  }).sort((a, b) => b.count - a.count || String(a.bucket).localeCompare(String(b.bucket)));
}

const rows = loadRows();

const report = {
  generatedAt: new Date().toISOString(),
  totalRows: rows.length,
  byMarket: summarize(rows, r => r.market),
  byMarketSide: summarize(rows, r => `${r.market} ${r.side}`)
};

writeJson("data/results/volatility-scoring.json", report);
writeJson("outputs/volatility-scoring.json", report);

console.log("VOLATILITY SCORING");
console.log("==================");
console.log("rows:", rows.length);
console.log("\nBY MARKET");
console.table(report.byMarket.slice(0, 20));
console.log("\nBY MARKET+SIDE");
console.table(report.byMarketSide.slice(0, 20));
