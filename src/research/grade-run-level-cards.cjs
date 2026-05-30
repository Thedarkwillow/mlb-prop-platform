const fs = require("fs");
const path = require("path");

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const IN_FILE = `outputs/history/${date}-run-level-cards.json`;
const OUT_JSON = `outputs/history/${date}-run-level-grades.json`;
const OUT_TXT = `outputs/history/${date}-run-level-grades.txt`;

const MLB_SCHEDULE_URL = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore`;
const MLB_FEED_URL = gamePk => `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;

function readJson(file, fallback = null) {
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

function fetchJson(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const out = require("child_process")
        .execFileSync("curl", ["-fsSL", "--max-time", "20", url], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"]
        });
      return JSON.parse(out);
    } catch {}
  }
  return null;
}

function n(v) {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function pct(v) {
  const x = n(v);
  return x == null ? "n/a" : `${(x * 100).toFixed(2)}%`;
}

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamAbbrev(team) {
  return String(team || "").toUpperCase().trim();
}

function resultFor(side, actual, line) {
  const a = n(actual);
  const l = n(line);
  const s = String(side || "").toUpperCase();

  if (a == null || l == null || !s) return "UNMATCHED";
  if (a === l) return "PUSH";
  if (s === "MORE") return a > l ? "HIT" : "MISS";
  if (s === "LESS") return a < l ? "HIT" : "MISS";
  return "UNMATCHED";
}

function fantasyHitter(stats) {
  const batting = stats?.batting || {};
  const singles =
    Number(batting.hits || 0) -
    Number(batting.doubles || 0) -
    Number(batting.triples || 0) -
    Number(batting.homeRuns || 0);

  return (
    singles * 3 +
    Number(batting.doubles || 0) * 5 +
    Number(batting.triples || 0) * 8 +
    Number(batting.homeRuns || 0) * 10 +
    Number(batting.runs || 0) * 2 +
    Number(batting.rbi || 0) * 2 +
    Number(batting.baseOnBalls || 0) * 2 +
    Number(batting.hitByPitch || 0) * 2 +
    Number(batting.stolenBases || 0) * 5
  );
}

function outsFromIp(ip) {
  if (ip == null) return null;
  const s = String(ip);
  const [whole, frac = "0"] = s.split(".");
  return Number(whole || 0) * 3 + Number(frac || 0);
}

function actualForMarket(leg, playerBox) {
  const market = String(leg.market || "").toLowerCase();
  const batting = playerBox?.stats?.batting || {};
  const pitching = playerBox?.stats?.pitching || {};

  const hits = n(batting.hits) ?? 0;
  const doubles = n(batting.doubles) ?? 0;
  const triples = n(batting.triples) ?? 0;
  const hr = n(batting.homeRuns) ?? 0;
  const singles = hits - doubles - triples - hr;

  if (market === "hits") return hits;
  if (market === "singles") return singles;
  if (market === "doubles") return doubles;
  if (market === "triples") return triples;
  if (market === "home_runs" || market === "hr") return hr;
  if (market === "bases") return singles + doubles * 2 + triples * 3 + hr * 4;
  if (market === "runs") return n(batting.runs) ?? 0;
  if (market === "rbis" || market === "rbi") return n(batting.rbi) ?? 0;
  if (market === "walks") return n(batting.baseOnBalls) ?? n(pitching.baseOnBalls) ?? 0;
  if (market === "hrr") return hits + (n(batting.runs) ?? 0) + (n(batting.rbi) ?? 0);
  if (market === "hitter_fantasy_score") return fantasyHitter(playerBox.stats);

  if (market === "strikeouts") return n(pitching.strikeOuts) ?? 0;
  if (market === "pitching_outs") return outsFromIp(pitching.inningsPitched);
  if (market === "hits_allowed") return n(pitching.hits) ?? 0;
  if (market === "earned_runs_allowed") return n(pitching.earnedRuns) ?? 0;
  if (market === "walks_allowed") return n(pitching.baseOnBalls) ?? 0;

  return null;
}

function buildPlayerIndex(feed) {
  const out = [];
  const box = feed?.liveData?.boxscore?.teams || {};
  for (const side of ["home", "away"]) {
    const team = box?.[side]?.team || {};
    const players = box?.[side]?.players || {};
    for (const p of Object.values(players)) {
      const person = p?.person || {};
      out.push({
        id: person.id,
        name: person.fullName,
        normName: norm(person.fullName),
        team: teamAbbrev(team.abbreviation || team.teamCode || team.fileCode),
        box: p
      });
    }
  }
  return out;
}

function findPlayer(leg, idx) {
  const wantName = norm(leg.player);
  const wantTeam = teamAbbrev(leg.team);

  let matches = idx.filter(p => p.normName === wantName);
  if (wantTeam) {
    const teamMatches = matches.filter(p => p.team === wantTeam);
    if (teamMatches.length) return teamMatches[0];
  }
  if (matches.length) return matches[0];

  matches = idx.filter(p => p.normName.includes(wantName) || wantName.includes(p.normName));
  if (wantTeam) {
    const teamMatches = matches.filter(p => p.team === wantTeam);
    if (teamMatches.length) return teamMatches[0];
  }
  return matches[0] || null;
}

function flattenRunLegs(report) {
  const out = [];
  for (const run of report.runs || []) {
    for (const leg of run.legs || []) {
      out.push({ ...leg });
    }
  }
  return out;
}

function summarize(rows, filterFn = () => true) {
  const rows2 = rows.filter(filterFn);
  const graded = rows2.filter(r => ["HIT", "MISS", "PUSH"].includes(r.result));
  const hits = graded.filter(r => r.result === "HIT").length;
  const misses = graded.filter(r => r.result === "MISS").length;
  const pushes = graded.filter(r => r.result === "PUSH").length;
  const unmatched = rows2.filter(r => r.result === "UNMATCHED").length;
  const hitRate = hits + misses > 0 ? hits / (hits + misses) : null;

  return {
    total: rows2.length,
    graded: graded.length,
    hits,
    misses,
    pushes,
    unmatched,
    hitRate: hitRate == null ? null : Number(hitRate.toFixed(4))
  };
}

function groupSummary(rows, keyFn) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({ key, ...summarize(rs) }))
    .sort((a, b) => b.total - a.total);
}

const cardReport = readJson(IN_FILE);
if (!cardReport) {
  console.error(`Missing run-level cards file: ${IN_FILE}`);
  console.error(`Run first: npm run runs:cards -- ${date}`);
  process.exit(1);
}

const legs = flattenRunLegs(cardReport);

const gamePks = [...new Set(legs.map(l => l.gamePk).filter(Boolean))].sort();
const feeds = new Map();
const indexes = new Map();

for (const gamePk of gamePks) {
  const feed = fetchJson(MLB_FEED_URL(gamePk), 4);
  if (!feed) {
    console.error(`WARN: missing feed for gamePk ${gamePk}`);
    continue;
  }
  feeds.set(String(gamePk), feed);
  indexes.set(String(gamePk), buildPlayerIndex(feed));
}

const gradedRows = legs.map(leg => {
  const gamePk = String(leg.gamePk || "");
  const idx = indexes.get(gamePk) || [];
  const found = findPlayer(leg, idx);

  const actual = found ? actualForMarket(leg, found.box) : null;
  const result = found ? resultFor(leg.side, actual, leg.line) : "UNMATCHED";

  return {
    ...leg,
    result,
    actual,
    matchedPlayer: found?.name || null,
    matchedTeam: found?.team || null,
    actualSource: found ? "mlb_stats_feed_live_boxscore" : null
  };
});

const summary = {
  all: summarize(gradedRows),
  executionPassedFinal: summarize(
    gradedRows,
    r => r.source === "final" && r.finalExecutionPassed === true
  ),
  finalOnly: summarize(gradedRows, r => r.source === "final"),
  playableOnly: summarize(gradedRows, r => r.source === "playable"),
  blockedOnly: summarize(gradedRows, r => r.source === "blocked"),
  v5ShadowOnly: summarize(gradedRows, r => r.source === "v5_shadow"),
  byRun: groupSummary(gradedRows, r => r.runId),
  bySource: groupSummary(gradedRows, r => r.source),
  byMarketSide: groupSummary(gradedRows, r => `${r.market} ${r.side}`),
  byTier: groupSummary(gradedRows, r => r.oddsTier)
};

const out = {
  date,
  generatedAt: new Date().toISOString(),
  inputFile: IN_FILE,
  gamePks,
  summary,
  rows: gradedRows
};

writeJson(OUT_JSON, out);

let txt = "";
txt += `RUN-LEVEL CARD GRADES\n`;
txt += `=====================\n`;
txt += `date: ${date}\n`;
txt += `rows: ${gradedRows.length}\n`;
txt += `graded: ${summary.all.graded}\n`;
txt += `hitRate: ${summary.all.hitRate == null ? "n/a" : pct(summary.all.hitRate)}\n\n`;

txt += `EXECUTION-PASSED FINAL LEGS\n`;
txt += `---------------------------\n`;
for (const r of gradedRows.filter(x => x.source === "final" && x.finalExecutionPassed === true)) {
  txt += `- ${r.runId} | ${r.player} | ${r.team || ""} | ${r.market} ${r.side} ${r.line} | ${r.oddsTier} | result=${r.result} | actual=${r.actual ?? "n/a"} | prob=${pct(r.prob)} | edge=${pct(r.edge)}\n`;
}
txt += `\n`;

txt += `BY RUN\n`;
txt += `------\n`;
for (const r of summary.byRun) {
  txt += `- ${r.key}: total=${r.total} graded=${r.graded} hits=${r.hits} misses=${r.misses} pushes=${r.pushes} unmatched=${r.unmatched} hitRate=${r.hitRate == null ? "n/a" : pct(r.hitRate)}\n`;
}
txt += `\n`;

txt += `BY MARKET/SIDE\n`;
txt += `--------------\n`;
for (const r of summary.byMarketSide.slice(0, 40)) {
  txt += `- ${r.key}: total=${r.total} graded=${r.graded} hits=${r.hits} misses=${r.misses} pushes=${r.pushes} unmatched=${r.unmatched} hitRate=${r.hitRate == null ? "n/a" : pct(r.hitRate)}\n`;
}

fs.writeFileSync(OUT_TXT, txt);

console.log("RUN-LEVEL CARD GRADES");
console.log("=====================");
console.log({
  date,
  rows: gradedRows.length,
  graded: summary.all.graded,
  hits: summary.all.hits,
  misses: summary.all.misses,
  pushes: summary.all.pushes,
  unmatched: summary.all.unmatched,
  hitRate: summary.all.hitRate,
  outJson: OUT_JSON,
  outTxt: OUT_TXT
});
console.log();
console.log(txt.split("\n").slice(0, 120).join("\n"));
