const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

const ALLOWED_MARKETS = new Set([
  "strikeouts",
  "pitching_outs",
  "hits_allowed",
  "earned_runs_allowed",
  "walks_allowed",
  "hits",
  "bases",
  "hrr",
  "runs",
  "rbis",
  "walks",
  "singles",
  "home_runs",
  "hr"
]);

function read(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function normName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function normalizeMarket(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/pitcher strikeouts/g, "strikeouts")
    .replace(/pitcher_outs/g, "pitching_outs")
    .replace(/total bases/g, "bases")
    .replace(/batter_total_bases/g, "bases")
    .replace(/batter_hits_runs_rbis/g, "hrr")
    .replace(/hits\+runs\+rbis/g, "hrr")
    .replace(/hits runs rbis/g, "hrr")
    .replace(/home runs/g, "home_runs")
    .replace(/\s+/g, "_")
    .trim();
}

function sideOf(row) {
  const s = String(row.side || row.recommendedSide || row.direction || "").toUpperCase();
  if (s === "OVER") return "MORE";
  if (s === "UNDER") return "LESS";
  return s;
}

function totalBases(b) {
  const h = Number(b.hits || 0);
  const d = Number(b.doubles || 0);
  const t = Number(b.triples || 0);
  const hr = Number(b.homeRuns || 0);
  const singles = Math.max(0, h - d - t - hr);
  return singles + d * 2 + t * 3 + hr * 4;
}

function statForMarket(stats, market) {
  const m = normalizeMarket(market);
  const batting = stats.batting || {};
  const pitching = stats.pitching || {};

  if (m === "bases") return totalBases(batting);
  if (m === "hits") return Number(batting.hits || 0);
  if (m === "singles") {
    const h = Number(batting.hits || 0);
    const d = Number(batting.doubles || 0);
    const t = Number(batting.triples || 0);
    const hr = Number(batting.homeRuns || 0);
    return Math.max(0, h - d - t - hr);
  }
  if (m === "runs") return Number(batting.runs || 0);
  if (m === "rbis" || m === "rbi") return Number(batting.rbi || 0);
  if (m === "walks") return Number(batting.baseOnBalls || batting.walks || 0);
  if (m === "home_runs" || m === "hr") return Number(batting.homeRuns || 0);
  if (m === "hrr") return Number(batting.hits || 0) + Number(batting.runs || 0) + Number(batting.rbi || 0);

  if (m === "strikeouts") return Number(pitching.strikeOuts || pitching.strikeouts || 0);
  if (m === "pitching_outs") return Number(pitching.outs || 0);
  if (m === "walks_allowed") return Number(pitching.baseOnBalls || pitching.walks || 0);
  if (m === "hits_allowed") return Number(pitching.hits || 0);
  if (m === "earned_runs_allowed") return Number(pitching.earnedRuns || 0);

  return null;
}

function bucketProb(p) {
  if (!Number.isFinite(p)) return "unknown";
  const n = Math.floor(p * 100 / 5) * 5;
  return `${n}-${n + 4}`;
}

function bucketEdge(e) {
  if (!Number.isFinite(e)) return "unknown";
  if (e < 0) return "<0";
  if (e < 0.05) return "0-5";
  if (e < 0.10) return "5-10";
  if (e < 0.15) return "10-15";
  return "15+";
}

function getConsensusRows() {
  const consensus = read("data/vegas-consensus.json", []);
  const rows = Array.isArray(consensus) ? consensus : consensus.rows || consensus.data || [];

  return rows
    .map(r => {
      const market = normalizeMarket(r.market || r.rawMarket);
      const side = sideOf(r);
      const line = Number(r.line);
      const prob = Number(r.noVigProb ?? r.weightedImpliedProb ?? r.avgImpliedProb);
      const books = Number(r.books || 0);

      return {
        source: "vegas_consensus",
        player: r.player,
        team: r.team ?? null,
        game: r.game ?? null,
        market,
        side,
        line,
        prob,
        edge: null,
        books,
        rawMarket: r.rawMarket ?? null,
        sportsbooks: r.sportsbooks ?? [],
        commenceTime: r.commenceTime ?? null
      };
    })
    .filter(r =>
      r.player &&
      ALLOWED_MARKETS.has(r.market) &&
      ["MORE", "LESS"].includes(r.side) &&
      Number.isFinite(r.line) &&
      Number.isFinite(r.prob)
    );
}

function pickOneSidePerProp(rows) {
  const groups = new Map();

  for (const r of rows) {
    const k = [normName(r.player), r.market, r.line, r.game || ""].join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const picked = [];
  for (const group of groups.values()) {
    const more = group.filter(r => r.side === "MORE").sort((a, b) => b.prob - a.prob)[0];
    const less = group.filter(r => r.side === "LESS").sort((a, b) => b.prob - a.prob)[0];

    if (more && less) {
      picked.push(more.prob >= less.prob ? more : less);
    } else {
      picked.push(more || less);
    }
  }

  return picked;
}

async function buildPlayerStats(date) {
  const schedule = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const map = new Map();

  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      const box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
      for (const side of ["away", "home"]) {
        const players = box.teams?.[side]?.players || {};
        for (const p of Object.values(players)) {
          const name = p.person?.fullName;
          if (!name) continue;
          map.set(normName(name), {
            player: name,
            gamePk: g.gamePk,
            batting: p.stats?.batting || {},
            pitching: p.stats?.pitching || {}
          });
        }
      }
    }
  }

  return map;
}

function gradeRow(row, statsByName) {
  const found = statsByName.get(normName(row.player));
  const actual = found ? statForMarket(found, row.market) : null;

  const base = {
    date: DATE,
    player: row.player,
    team: row.team,
    game: row.game,
    market: row.market,
    side: row.side,
    line: row.line,
    prob: row.prob,
    edge: row.edge,
    confidence: bucketProb(row.prob),
    books: row.books,
    source: "full_board_consensus_clean",
    foundPlayer: Boolean(found),
    gamePk: found?.gamePk || null,
    rawMarket: row.rawMarket,
    sportsbooks: row.sportsbooks
  };

  if (!Number.isFinite(Number(actual))) {
    return { ...base, actual: null, result: "UNSUPPORTED", reason: "unsupported_or_unmatched_market" };
  }

  const a = Number(actual);
  let result = "UNKNOWN";
  if (row.side === "MORE") result = a > row.line ? "HIT" : a === row.line ? "PUSH" : "MISS";
  if (row.side === "LESS") result = a < row.line ? "HIT" : a === row.line ? "PUSH" : "MISS";

  return { ...base, actual: a, result, reason: null };
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const profit = hits - misses;
  return {
    count: graded.length,
    hits,
    misses,
    pushes,
    hitRate: graded.length ? Number((hits / graded.length).toFixed(4)) : null,
    roi: graded.length ? Number((profit / graded.length).toFixed(4)) : null
  };
}

function grouped(rows, fn) {
  const out = {};
  for (const r of rows) {
    const k = fn(r);
    if (!out[k]) out[k] = [];
    out[k].push(r);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, summarize(v)]));
}

async function main() {
  const rawConsensus = getConsensusRows();
  const rows = pickOneSidePerProp(rawConsensus);
  const stats = await buildPlayerStats(DATE);

  const gradedAll = rows.map(r => gradeRow(r, stats));
  const supported = gradedAll.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const unsupported = gradedAll.filter(r => !["HIT", "MISS", "PUSH"].includes(r.result));

  fs.mkdirSync("outputs/history", { recursive: true });
  fs.mkdirSync("data/results", { recursive: true });
  fs.mkdirSync("data/learning", { recursive: true });

  fs.writeFileSync(`outputs/history/${DATE}-full-board-graded.json`, JSON.stringify(supported, null, 2));
  fs.writeFileSync(`outputs/history/${DATE}-full-board-unmatched.json`, JSON.stringify(unsupported, null, 2));

  const histPath = "data/results/full-board-history.json";
  const hist = read(histPath, []).filter(r => r.date !== DATE);
  const updatedHist = [...hist, ...supported];
  fs.writeFileSync(histPath, JSON.stringify(updatedHist, null, 2));

  const learning = {
    date: DATE,
    updatedAt: new Date().toISOString(),
    note: "Clean consensus full-board learning: one side per player/market/line/game; learning-only, not direct ROI.",
    overall: summarize(updatedHist),
    byMarket: grouped(updatedHist, r => r.market),
    byMarketSide: grouped(updatedHist, r => `${r.market} ${r.side}`),
    byMarketSideConfidence: grouped(updatedHist, r => `${r.market} ${r.side} ${r.confidence || "unknown"}`),
    byMarketSideProbBucket: grouped(updatedHist, r => `${r.market} ${r.side} ${bucketProb(r.prob)}`),
    byMarketSideEdgeBucket: grouped(updatedHist, r => `${r.market} ${r.side} ${bucketEdge(r.edge)}`)
  };

  fs.writeFileSync("data/learning/full-board-market-learning.json", JSON.stringify(learning, null, 2));

  console.log(`FULL BOARD CLEAN CONSENSUS GRADING ${DATE}`);
  console.log("Raw consensus rows:", rawConsensus.length);
  console.log("One-side prop rows:", rows.length);
  console.log("Supported graded:", supported.length);
  console.log("Unsupported/unmatched:", unsupported.length);
  console.log("Overall:");
  console.table([summarize(supported)]);
  console.log("By market:");
  console.table(Object.entries(grouped(supported, r => r.market)).map(([bucket, x]) => ({ bucket, ...x })).slice(0, 30));
  console.log("By market side:");
  console.table(Object.entries(grouped(supported, r => `${r.market} ${r.side}`)).map(([bucket, x]) => ({ bucket, ...x })).slice(0, 30));
  console.log("Wrote:");
  console.log(`outputs/history/${DATE}-full-board-graded.json`);
  console.log(`outputs/history/${DATE}-full-board-unmatched.json`);
  console.log("data/results/full-board-history.json");
  console.log("data/learning/full-board-market-learning.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
