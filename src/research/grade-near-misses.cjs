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

function norm(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function totalBases(b) {
  const h = Number(b.hits || 0);
  const d = Number(b.doubles || 0);
  const t = Number(b.triples || 0);
  const hr = Number(b.homeRuns || 0);
  const singles = Math.max(0, h - d - t - hr);
  return singles + 2 * d + 3 * t + 4 * hr;
}

function statForMarket(batting, market) {
  const m = String(market || "").toLowerCase();
  if (m === "bases") return totalBases(batting);
  if (m === "hits") return Number(batting.hits || 0);
  if (m === "singles") {
    const h = Number(batting.hits || 0);
    const d = Number(batting.doubles || 0);
    const t = Number(batting.triples || 0);
    const hr = Number(batting.homeRuns || 0);
    return Math.max(0, h - d - t - hr);
  }
  if (m === "walks") return Number(batting.baseOnBalls || batting.walks || 0);
  if (m === "runs") return Number(batting.runs || 0);
  if (m === "rbis" || m === "rbi") return Number(batting.rbi || 0);
  if (m === "home_runs" || m === "hr") return Number(batting.homeRuns || 0);
  return null;
}

async function buildPlayerStatsByName(date) {
  const schedule = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const out = new Map();

  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      const box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
      for (const side of ["away", "home"]) {
        const players = box.teams?.[side]?.players || {};
        for (const p of Object.values(players)) {
          const name = p.person?.fullName;
          if (!name) continue;
          out.set(norm(name), {
            player: name,
            gamePk: g.gamePk,
            batting: p.stats?.batting || {}
          });
        }
      }
    }
  }

  return out;
}

function gradeRow(row, statsByName) {
  const found = statsByName.get(norm(row.player));
  const actual = found ? statForMarket(found.batting, row.market) : null;

  if (!Number.isFinite(Number(actual))) {
    return { ...row, actual: null, result: "UNKNOWN", shadow: true, source: "mlb_stats_api_boxscore" };
  }

  const a = Number(actual);
  const line = Number(row.line);
  const side = String(row.side || "").toUpperCase();

  let result = "UNKNOWN";
  if (side === "MORE") result = a > line ? "HIT" : a === line ? "PUSH" : "MISS";
  if (side === "LESS") result = a < line ? "HIT" : a === line ? "PUSH" : "MISS";

  return {
    ...row,
    actual: a,
    result,
    shadow: true,
    source: "mlb_stats_api_boxscore",
    gamePk: found?.gamePk || null
  };
}

async function main() {
  const near = read("outputs/near-miss-tracking.json", []).filter(r => r.date === DATE);
  const statsByName = await buildPlayerStatsByName(DATE);
  const graded = near.map(r => gradeRow(r, statsByName));

  fs.writeFileSync(`outputs/near-miss-graded-${DATE}.json`, JSON.stringify(graded, null, 2));
  fs.mkdirSync("outputs/history", { recursive: true });
  fs.writeFileSync(`outputs/history/${DATE}-shadow-graded.json`, JSON.stringify(graded, null, 2));

  const histPath = "data/results/near-miss-history.json";
  const hist = read(histPath, []);
  const byKey = new Map();

  for (const r of hist) {
    byKey.set([r.date, r.player, r.market, r.side, r.line].join("|"), r);
  }
  for (const r of graded) {
    byKey.set([r.date, r.player, r.market, r.side, r.line].join("|"), r);
  }

  fs.writeFileSync(histPath, JSON.stringify([...byKey.values()], null, 2));

  console.log("Near-misses graded:", graded.length);
  console.table(graded.map(r => ({
    date: r.date,
    player: r.player,
    market: r.market,
    side: r.side,
    line: r.line,
    actual: r.actual,
    result: r.result,
    gamePk: r.gamePk
  })));
  console.log("Wrote", `outputs/near-miss-graded-${DATE}.json`);
  console.log("Updated", histPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
