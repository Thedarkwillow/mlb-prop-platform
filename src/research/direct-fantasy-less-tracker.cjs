const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const date =
  process.argv[2] ||
  process.env.npm_config_date ||
  new Date().toISOString().slice(0, 10);

const FILES = {
  pricedBoard: "outputs/priced-board.json",
  fantasyGrades: `outputs/history/${date}-fantasy-grades.json`,
  out: `outputs/direct-fantasy-less-tracker-${date}.json`,
  latest: "outputs/direct-fantasy-less-tracker-latest.json",
  txt: `outputs/direct-fantasy-less-tracker-${date}.txt`,
  latestTxt: "outputs/direct-fantasy-less-tracker-latest.txt"
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : text + "\n");
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pct(v) {
  const n = num(v, null);
  return n === null ? "n/a" : `${(n * 100).toFixed(2)}%`;
}

function norm(v) {
  return String(v ?? "").trim().toLowerCase();
}

function normName(v) {
  return norm(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function marketOf(row) {
  const raw = norm(row.market ?? row.stat ?? row.type ?? row.statType ?? row.stat_type);
  if (raw.includes("pitcher") && raw.includes("fantasy")) return "pitcher_fantasy_score";
  if (raw.includes("hitter") && raw.includes("fantasy")) return "hitter_fantasy_score";
  if (raw === "fantasy score" || raw === "fantasy_score") return "fantasy_score";
  return raw;
}

function sideOf(row) {
  const raw = String(
    row.side ??
    row.recommendedSide ??
    row.direction ??
    row.pick ??
    row.projectionSide ??
    row.recommendation ??
    ""
  ).trim().toUpperCase();

  if (raw === "OVER") return "MORE";
  if (raw === "UNDER") return "LESS";
  return raw;
}

function lineOf(row) {
  return num(row.line ?? row.ppLine ?? row.target ?? row.projectionLine, null);
}

function resultFor(actual, line, side) {
  if (!Number.isFinite(actual) || !Number.isFinite(line)) return "UNMATCHED";
  if (actual === line) return "PUSH";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  return "UNMATCHED";
}

function lineBucket(line) {
  const n = num(line, null);
  if (n === null) return "unknown";
  if (n < 3) return "<3";
  if (n <= 4.5) return "3-4.5";
  if (n <= 6.5) return "5-6.5";
  if (n <= 8.5) return "7-8.5";
  if (n <= 10.5) return "9-10.5";
  if (n <= 12.5) return "11-12.5";
  return "13+";
}

function readUrlJson(url) {
  const variants = [
    url,
    url.includes("/api/v1/game/") ? url.replace("/api/v1/game/", "/api/v1.1/game/") : null,
    url.includes("/boxscore") && !url.includes("?") ? `${url}?language=en` : null,
    url.includes("/api/v1/game/") && url.includes("/boxscore") && !url.includes("?")
      ? `${url.replace("/api/v1/game/", "/api/v1.1/game/")}?language=en`
      : null
  ].filter(Boolean);

  for (const candidate of [...new Set(variants)]) {
    try {
      const raw = execFileSync("curl", [
        "-fsSL",
        "-H", "accept: application/json,text/plain,*/*",
        "-H", "user-agent: Mozilla/5.0 mlb-prop-platform fantasy-less-tracker",
        candidate
      ], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 15000
      });
      return JSON.parse(raw);
    } catch {
      // Try next endpoint variant.
    }
  }

  return null;
}

function pitcherFantasyScore(stats = {}) {
  const win = num(stats.wins ?? stats.win, 0);
  const qualityStart = num(stats.qualityStarts ?? stats.qualityStart, 0);
  const earnedRuns = num(stats.earnedRuns, 0);
  const strikeouts = num(stats.strikeOuts ?? stats.strikeouts, 0);

  let outs = num(stats.outs, null);
  if (outs === null) outs = parseIpToOuts(stats.inningsPitched ?? stats.ip);

  if (outs === null) return null;

  return (
    win * 6 +
    qualityStart * 4 +
    earnedRuns * -3 +
    strikeouts * 3 +
    outs * 1
  );
}

function hitterFantasyScore(stats = {}) {
  const hits = num(stats.hits, 0);
  const doubles = num(stats.doubles, 0);
  const triples = num(stats.triples, 0);
  const homeRuns = num(stats.homeRuns, 0);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);

  return (
    singles * 3 +
    doubles * 5 +
    triples * 8 +
    homeRuns * 10 +
    num(stats.runs, 0) * 2 +
    num(stats.rbi ?? stats.rbis, 0) * 2 +
    num(stats.baseOnBalls ?? stats.walks, 0) * 2 +
    num(stats.hitByPitch, 0) * 2 +
    num(stats.stolenBases, 0) * 5
  );
}

function parseIpToOuts(ip) {
  if (ip === null || ip === undefined || ip === "") return null;
  const s = String(ip);
  const [wholeRaw, fracRaw = "0"] = s.split(".");
  const whole = Number(wholeRaw);
  const frac = Number(fracRaw);
  if (!Number.isFinite(whole) || !Number.isFinite(frac)) return null;
  if (![0, 1, 2].includes(frac)) return null;
  return whole * 3 + frac;
}

function getPlayerStatsFromBoxscore(box, playerName) {
  const target = normName(playerName);
  const teams = [box?.teams?.away, box?.teams?.home].filter(Boolean);

  for (const tm of teams) {
    for (const p of Object.values(tm.players || {})) {
      const fullName = p.person?.fullName || "";
      if (normName(fullName) !== target) continue;

      return {
        fullName,
        batting: p.stats?.batting || {},
        pitching: p.stats?.pitching || {}
      };
    }
  }

  return null;
}

function directBoxscoreFantasy(row, boxCache) {
  const gamePk = row.resolvedGamePk || row.gamePk || row.mlbGamePk;
  if (!gamePk) return null;

  if (!boxCache.has(gamePk)) {
    boxCache.set(gamePk, readUrlJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`));
  }

  const box = boxCache.get(gamePk);
  if (!box) return null;

  const found = getPlayerStatsFromBoxscore(box, row.player);
  if (!found) return null;

  const market = marketOf(row);
  const actual =
    market === "pitcher_fantasy_score"
      ? pitcherFantasyScore(found.pitching)
      : market === "hitter_fantasy_score"
        ? hitterFantasyScore(found.batting)
        : null;

  if (actual === null) return null;

  return {
    actual: Number(actual.toFixed(2)),
    matchedName: found.fullName,
    matchStatus: "BOX_SCORE_DIRECT"
  };
}

function pickFantasyLessRows() {
  const priced = readJson(FILES.pricedBoard, []);
  const rows = Array.isArray(priced) ? priced : [];

  const picked = [];
  const seen = new Set();

  for (const row of rows) {
    const market = marketOf(row);
    const side = sideOf(row);
    const line = lineOf(row);

    if (!["pitcher_fantasy_score", "hitter_fantasy_score"].includes(market)) continue;
    if (side !== "LESS") continue;
    if (line === null) continue;

    const key = [
      normName(row.player),
      market,
      side,
      line,
      row.resolvedGamePk || row.gamePk || ""
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);

    picked.push({
      player: row.player ?? null,
      team: row.team ?? row.resolvedTeam ?? null,
      market,
      stat: row.stat ?? row.market ?? null,
      side,
      line,
      oddsTier: row.oddsTier ?? row.tier ?? row.specialTier ?? "standard",
      projection: num(row.projection, null),
      recommendedProb: num(row.recommendedProb ?? row.prob ?? row.probability, null),
      expectedValue: num(row.expectedValue ?? row.edge, null),
      game: row.resolvedGame ?? row.game ?? null,
      gamePk: row.resolvedGamePk ?? row.gamePk ?? row.mlbGamePk ?? null,
      resolvedGame: row.resolvedGame ?? row.game ?? null,
      resolvedGamePk: row.resolvedGamePk ?? row.gamePk ?? row.mlbGamePk ?? null,
      source: FILES.pricedBoard
    });
  }

  return picked;
}

function summarize(rows) {
  const graded = rows.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const unmatched = rows.filter(r => r.result === "UNMATCHED").length;
  const denom = hits + misses;

  return {
    rows: rows.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
    hitRate: denom ? Number((hits / denom).toFixed(4)) : 0,
    roi: denom ? Number(((hits - misses) / denom).toFixed(4)) : 0
  };
}

function groupSummary(rows, keyFn) {
  const m = new Map();
  for (const row of rows) {
    const k = keyFn(row);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(row);
  }

  return [...m.entries()]
    .map(([key, rows]) => ({ key, ...summarize(rows) }))
    .sort((a, b) => b.rows - a.rows || String(a.key).localeCompare(String(b.key)));
}

const boxCache = new Map();

const rows = pickFantasyLessRows().map(row => {
  const direct = directBoxscoreFantasy(row, boxCache);
  const actual = direct?.actual ?? null;
  const result = actual === null ? "UNMATCHED" : resultFor(actual, row.line, row.side);

  return {
    ...row,
    actual,
    result,
    matchStatus: direct?.matchStatus ?? "UNMATCHED",
    matchedName: direct?.matchedName ?? null,
    lineBucket: lineBucket(row.line),
    playable: false,
    policy: "DIRECT_TRACK_ONLY"
  };
});

const output = {
  date,
  generatedAt: new Date().toISOString(),
  policy: {
    playable: false,
    note: "Fantasy LESS is direct-tracked only. Do not feed official/actionable until direct sample and ROI stabilize."
  },
  summary: summarize(rows),
  byMarket: groupSummary(rows, r => r.market),
  byLineBucket: groupSummary(rows, r => `${r.market}|${r.lineBucket}`),
  rows
};

writeJson(FILES.out, output);
writeJson(FILES.latest, output);

const lines = [];
lines.push("DIRECT FANTASY LESS TRACKER v4");
lines.push("==============================");
lines.push(`date: ${date}`);
lines.push(`generatedAt: ${output.generatedAt}`);
lines.push("");
lines.push("POLICY");
lines.push("------");
lines.push("Fantasy LESS = direct tracked only");
lines.push("Playable = false");
lines.push(output.policy.note);
lines.push("");
lines.push("SUMMARY");
lines.push("-------");
for (const [k, v] of Object.entries(output.summary)) {
  lines.push(`${k}=${v}`);
}
lines.push("");
lines.push("BY MARKET");
lines.push("---------");
for (const r of output.byMarket) {
  lines.push(`${r.key}: rows=${r.rows} graded=${r.graded} hits=${r.hits} misses=${r.misses} pushes=${r.pushes} unmatched=${r.unmatched} hitRate=${pct(r.hitRate)} roi=${pct(r.roi)}`);
}
lines.push("");
lines.push("BY LINE BUCKET");
lines.push("--------------");
for (const r of output.byLineBucket) {
  lines.push(`${r.key}: rows=${r.rows} graded=${r.graded} hits=${r.hits} misses=${r.misses} pushes=${r.pushes} unmatched=${r.unmatched} hitRate=${pct(r.hitRate)} roi=${pct(r.roi)}`);
}
lines.push("");
lines.push("SAMPLE ROWS");
lines.push("-----------");
for (const r of rows.slice(0, 25)) {
  lines.push(`- ${r.player} | ${r.market} ${r.side} ${r.line} | actual=${r.actual ?? "n/a"} | result=${r.result} | bucket=${r.lineBucket} | match=${r.matchStatus}`);
}

writeText(FILES.txt, lines.join("\n"));
writeText(FILES.latestTxt, lines.join("\n"));

console.log(lines.join("\n"));
console.log("saved:", FILES.out);
console.log("saved:", FILES.latest);
console.log("saved:", FILES.txt);
console.log("saved:", FILES.latestTxt);
