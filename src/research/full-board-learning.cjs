const fs = require("fs");
const path = require("path");

const DATE =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

function read(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function norm(v) {
  return String(v || "").toLowerCase().replace(/\s+/g, "_").trim();
}

function cleanName(v) {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function side(v) {
  return String(v || "").toUpperCase().trim();
}

function tier(v) {
  return String(v || "standard").toLowerCase().trim();
}

function keyOf(r) {
  return [
    cleanName(r.player),
    norm(r.market || r.stat),
    side(r.side || r.recommendedSide),
    String(r.line ?? r.ppLine ?? "").trim()
  ].join("|");
}

function probOf(r) {
  return Number(
    r.calibratedDistributionProb ??
    r.recommendedProb ??
    r.probability ??
    r.prob
  );
}

function edgeOf(r) {
  return Number(
    r.sportsbookAdjustedEdge ??
    r.adjustedEdge ??
    r.sportsbookEdge ??
    r.edge
  );
}

function bucketProb(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 0.5) return "<50";
  if (n < 0.55) return "50-55";
  if (n < 0.6) return "55-60";
  if (n < 0.65) return "60-65";
  if (n < 0.7) return "65-70";
  if (n < 0.75) return "70-75";
  return "75+";
}

function bucketEdge(e) {
  const n = Number(e);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 0.05) return "<5%";
  if (n < 0.1) return "5-10%";
  if (n < 0.15) return "10-15%";
  return "15%+";
}

function bucketScore(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 0.05) return "<0.05";
  if (n < 0.1) return "0.05-0.10";
  if (n < 0.15) return "0.10-0.15";
  if (n < 0.2) return "0.15-0.20";
  return "0.20+";
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

function hrr(b) {
  return Number(b.hits || 0) + Number(b.runs || 0) + Number(b.rbi || 0);
}

function statForMarket(batting, market) {
  const m = norm(market);
  if (m === "bases") return totalBases(batting);
  if (m === "hits") return Number(batting.hits || 0);
  if (m === "runs") return Number(batting.runs || 0);
  if (m === "rbis" || m === "rbi") return Number(batting.rbi || 0);
  if (m === "home_runs" || m === "hr") return Number(batting.homeRuns || 0);
  if (m === "walks") return Number(batting.baseOnBalls || 0);
  if (m === "singles") {
    const h = Number(batting.hits || 0);
    const d = Number(batting.doubles || 0);
    const t = Number(batting.triples || 0);
    const hr = Number(batting.homeRuns || 0);
    return Math.max(0, h - d - t - hr);
  }
  if (m === "hrr") return hrr(batting);
  return null;
}

async function buildStats(date) {
  const schedule = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const byName = new Map();

  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      const box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
      for (const teamSide of ["away", "home"]) {
        const players = box.teams?.[teamSide]?.players || {};
        for (const p of Object.values(players)) {
          const name = p.person?.fullName;
          if (!name) continue;
          byName.set(cleanName(name), {
            player: name,
            gamePk: g.gamePk,
            teamSide,
            batting: p.stats?.batting || {}
          });
        }
      }
    }
  }

  return byName;
}

function grade(row, statsByName) {
  const found = statsByName.get(cleanName(row.player));
  const actual = found ? statForMarket(found.batting, row.market) : null;

  if (!Number.isFinite(Number(actual))) {
    return {
      ...row,
      actual: null,
      result: "UNKNOWN",
      gamePk: found?.gamePk || null
    };
  }

  const a = Number(actual);
  const line = Number(row.line);
  let result = "UNKNOWN";

  if (row.side === "MORE") result = a > line ? "HIT" : a === line ? "PUSH" : "MISS";
  if (row.side === "LESS") result = a < line ? "HIT" : a === line ? "PUSH" : "MISS";

  return {
    ...row,
    actual: a,
    result,
    gamePk: found?.gamePk || null
  };
}

function result(row) {
  const r = String(row.result || "").toUpperCase();
  if (["HIT", "WIN", "WON"].includes(r)) return "HIT";
  if (["MISS", "LOSS", "LOST"].includes(r)) return "MISS";
  if (["PUSH", "VOID"].includes(r)) return "PUSH";
  return "UNKNOWN";
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(result(r)));
  const hits = graded.filter(r => result(r) === "HIT").length;
  const misses = graded.filter(r => result(r) === "MISS").length;
  const pushes = graded.filter(r => result(r) === "PUSH").length;
  const decisions = hits + misses;

  return {
    count: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    hitRate: decisions ? Number((hits / decisions).toFixed(4)) : null,
    roi: decisions ? Number(((hits - misses) / decisions).toFixed(4)) : null
  };
}

function add(map, key, row) {
  if (!map[key]) map[key] = [];
  map[key].push(row);
}

function buildReport(rows) {
  const byDecision = {};
  const byMarketSideTier = {};
  const byDecisionMarketSideTier = {};
  const byProbBucket = {};
  const byEdgeBucket = {};
  const byScoreBucket = {};
  const byBlockedReason = {};

  for (const r of rows) {
    const mst = `${r.market}_${r.side}_${r.oddsTier}`;
    add(byDecision, r.decision, r);
    add(byMarketSideTier, mst, r);
    add(byDecisionMarketSideTier, `${r.decision}_${mst}`, r);
    add(byProbBucket, bucketProb(r.prob), r);
    add(byEdgeBucket, bucketEdge(r.edge), r);
    add(byScoreBucket, bucketScore(r.score), r);
    if (r.reasonBlocked) add(byBlockedReason, r.reasonBlocked, r);
  }

  const ignoredButHit = rows.filter(r => r.decision === "ignored" && result(r) === "HIT");
  const blockedButHit = rows.filter(r => r.decision === "blocked" && result(r) === "HIT");
  const playedAndHit = rows.filter(r => r.decision === "played" && result(r) === "HIT");
  const playedAndMissed = rows.filter(r => r.decision === "played" && result(r) === "MISS");

  return {
    generatedAt: new Date().toISOString(),
    note: "Full-board shadow learning. Official ROI should still come only from playable slips.",
    date: DATE,
    summary: summarize(rows),
    byDecision: Object.fromEntries(Object.entries(byDecision).map(([k,v]) => [k, summarize(v)])),
    byMarketSideTier: Object.fromEntries(Object.entries(byMarketSideTier).map(([k,v]) => [k, summarize(v)])),
    byDecisionMarketSideTier: Object.fromEntries(Object.entries(byDecisionMarketSideTier).map(([k,v]) => [k, summarize(v)])),
    byProbBucket: Object.fromEntries(Object.entries(byProbBucket).map(([k,v]) => [k, summarize(v)])),
    byEdgeBucket: Object.fromEntries(Object.entries(byEdgeBucket).map(([k,v]) => [k, summarize(v)])),
    byScoreBucket: Object.fromEntries(Object.entries(byScoreBucket).map(([k,v]) => [k, summarize(v)])),
    byBlockedReason: Object.fromEntries(Object.entries(byBlockedReason).map(([k,v]) => [k, summarize(v)])),
    ignoredButHit: ignoredButHit.slice(0, 50),
    blockedButHit: blockedButHit.slice(0, 50),
    playedAndHit: playedAndHit.slice(0, 50),
    playedAndMissed: playedAndMissed.slice(0, 50)
  };
}

async function main() {
  const pricedBoard = read(`outputs/priced-board-${DATE}.json`, read("outputs/priced-board.json", []));
  const enriched = read("outputs/slips-distribution-enriched.json", []);
  const blocked = read("outputs/blocked-final-candidates.json", []);
  const playable = read("outputs/playable-final-slips.json", []);

  const playableKeys = new Set();
  for (const s of playable || []) {
    for (const l of s.legs || []) playableKeys.add(keyOf(l));
  }

  const blockedByKey = new Map();
  for (const b of blocked || []) blockedByKey.set(keyOf(b), b);

  const rowsByKey = new Map();

  const SUPPORTED_MARKETS = new Set([
    "bases",
    "hits",
    "runs",
    "rbis",
    "rbi",
    "home_runs",
    "hr",
    "walks",
    "singles",
    "hrr"
  ]);

  const allBoardRows = [
    ...(pricedBoard || []).filter(r =>
      r &&
      r.recordType !== "pricing_summary" &&
      SUPPORTED_MARKETS.has(norm(r.market || r.stat)) &&
      !(["goblin", "demon"].includes(tier(r.oddsTier || r.tier)) && side(r.side || r.recommendedSide) === "LESS")
    ),
    ...(enriched || []).filter(r =>
      SUPPORTED_MARKETS.has(norm(r.market || r.stat)) &&
      !(["goblin", "demon"].includes(tier(r.oddsTier || r.tier)) && side(r.side || r.recommendedSide) === "LESS")
    )
  ];

  for (const r of allBoardRows) {
    const k = keyOf(r);
    const b = blockedByKey.get(k);
    const isPlayed = playableKeys.has(k);
    const isBlocked = Boolean(b);

    rowsByKey.set(k, {
      date: DATE,
      player: r.player,
      team: r.team || null,
      game: r.game || null,
      market: norm(r.market || r.stat),
      side: side(r.side || r.recommendedSide),
      line: r.line ?? r.ppLine ?? null,
      oddsTier: tier(r.oddsTier || r.tier),
      prob: Number.isFinite(probOf(r)) ? probOf(r) : null,
      edge: Number.isFinite(edgeOf(r)) ? edgeOf(r) : null,
      score: Number.isFinite(Number(r.finalScore)) ? Number(r.finalScore) : null,
      decision: isPlayed ? "played" : isBlocked ? "blocked" : "ignored",
      reasonBlocked: b?.reason || null,
      reasons: b?.reasons || [],
      source: "full_board"
    });
  }

  for (const b of blocked || []) {
    const k = keyOf(b);
    if (rowsByKey.has(k)) continue;
    rowsByKey.set(k, {
      date: DATE,
      player: b.player,
      team: b.team || null,
      game: b.game || null,
      market: norm(b.market),
      side: side(b.side),
      line: b.line,
      oddsTier: tier(b.oddsTier || b.tier),
      prob: b.prob ?? null,
      edge: b.edge ?? null,
      score: b.score ?? null,
      decision: "blocked",
      reasonBlocked: b.reason || null,
      reasons: b.reasons || [],
      source: "blocked_only"
    });
  }

  const statsByName = await buildStats(DATE);
  const gradedRows = [...rowsByKey.values()].map(r => grade(r, statsByName));

  const histPath = "data/results/full-board-history.json";
  const hist = read(histPath, []);
  const histByKey = new Map();

  for (const r of hist) {
    if (String(r.date || "").slice(0, 10) === DATE) continue;
    histByKey.set([r.date, keyOf(r)].join("|"), r);
  }
  for (const r of gradedRows) {
    histByKey.set([r.date, keyOf(r)].join("|"), r);
  }

  const combined = [...histByKey.values()];
  const report = buildReport(combined);

  write(`outputs/full-board-graded-${DATE}.json`, gradedRows);
  write(histPath, combined);
  write("data/learning/full-board-learning.json", report);

  console.log("FULL BOARD LEARNING");
  console.log("===================");
  console.log("date:", DATE);
  console.log("graded today:", gradedRows.length);
  console.log("history total:", combined.length);
  console.log("Summary:");
  console.table([summarize(gradedRows)]);
  console.log("By decision:");
  console.table(Object.entries(buildReport(gradedRows).byDecision).map(([bucket, x]) => ({ bucket, ...x })));
  console.log("Blocked but hit:");
  console.table(buildReport(gradedRows).blockedButHit.map(r => ({
    player: r.player,
    market: r.market,
    side: r.side,
    line: r.line,
    tier: r.oddsTier,
    prob: r.prob,
    edge: r.edge,
    score: r.score,
    reason: r.reasonBlocked,
    actual: r.actual
  })).slice(0, 20));
  console.log("Ignored but hit:");
  console.table(buildReport(gradedRows).ignoredButHit.map(r => ({
    player: r.player,
    market: r.market,
    side: r.side,
    line: r.line,
    tier: r.oddsTier,
    prob: r.prob,
    edge: r.edge,
    actual: r.actual
  })).slice(0, 20));
  console.log("Wrote", `outputs/full-board-graded-${DATE}.json`);
  console.log("Wrote", histPath);
  console.log("Wrote data/learning/full-board-learning.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
