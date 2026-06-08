const fs = require("fs");
const https = require("https");

function argDate() {
  const eq = process.argv.find(x => x.startsWith("--date="));
  if (eq) return eq.split("=")[1];
  const plain = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  return plain || process.env.npm_config_date || new Date().toISOString().slice(0, 10);
}

const DATE = argDate();
const IN = `outputs/fantasy-less-history-graded-${DATE}-to-${DATE}.json`;
const OUT = `outputs/fantasy-less-history-graded-${DATE}-to-${DATE}.json`;
const BACKUP = `outputs/fantasy-less-history-graded-${DATE}-to-${DATE}.backup-before-boxscore-repair.json`;
const REPORT = `outputs/fantasy-less-unmatched-boxscore-repair-${DATE}.txt`;

function readJson(p, f = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return f; }
}
function writeJson(p, v) {
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
}
function s(v) { return String(v ?? "").trim(); }
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function norm(v) {
  return s(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
function marketOf(r) {
  return s(r.market || r.statType || r.projectionType || r.stat)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
function playerOf(r) {
  return s(r.player || r.playerName || r.name || r.athleteName);
}
function lineOf(r) {
  return n(r.line ?? r.statValue ?? r.value ?? r.projectionLine);
}
function sideOf(r) {
  const x = s(r.side || r.pick || r.direction || r.selection).toUpperCase();
  if (x === "UNDER") return "LESS";
  if (x === "OVER") return "MORE";
  return x;
}
function resultFor(side, actual, line) {
  if (actual === null || line === null) return "UNMATCHED";
  if (actual === line) return "PUSH";
  if (side === "LESS") return actual < line ? "HIT" : "MISS";
  if (side === "MORE") return actual > line ? "HIT" : "MISS";
  return "UNMATCHED";
}
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = "";
      res.on("data", d => body += d);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

function hitterFantasy(b) {
  const hits = Number(b.hits || 0);
  const doubles = Number(b.doubles || 0);
  const triples = Number(b.triples || 0);
  const hr = Number(b.homeRuns || 0);
  const singles = Math.max(0, hits - doubles - triples - hr);
  const runs = Number(b.runs || 0);
  const rbi = Number(b.rbi || 0);
  const bb = Number(b.baseOnBalls || b.walks || 0);
  const hbp = Number(b.hitByPitch || 0);
  const sb = Number(b.stolenBases || 0);

  return singles * 3 + doubles * 5 + triples * 8 + hr * 10 + runs * 2 + rbi * 2 + bb * 2 + hbp * 2 + sb * 5;
}

function pitcherFantasy(p) {
  const outs = Number(p.outs || 0);
  const strikeouts = Number(p.strikeOuts || 0);
  const er = Number(p.earnedRuns || 0);
  const wins = Number(p.wins || 0);
  const innings = outs / 3;
  const qs = innings >= 6 && er <= 3 ? 1 : 0;

  return outs + strikeouts * 3 - er * 3 + wins * 6 + qs * 4;
}

function walkRows(v, cb, path = "root") {
  if (!v) return;
  if (Array.isArray(v)) {
    v.forEach((x, i) => walkRows(x, cb, `${path}[${i}]`));
    return;
  }
  if (typeof v !== "object") return;

  const looksLikeFantasy =
    playerOf(v) &&
    ["hitter_fantasy_score", "pitcher_fantasy_score"].includes(marketOf(v)) &&
    sideOf(v) === "LESS";

  if (looksLikeFantasy) cb(v, path);

  for (const [k, x] of Object.entries(v)) {
    if (x && typeof x === "object") walkRows(x, cb, `${path}.${k}`);
  }
}

async function main() {
  const data = readJson(IN);
  if (!data) throw new Error(`Missing ${IN}`);

  if (!fs.existsSync(BACKUP)) writeJson(BACKUP, data);

  const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}&hydrate=probablePitcher`;
  const schedule = await fetchJson(scheduleUrl);
  const gamePks = [];
  for (const d of schedule.dates || []) {
    for (const g of d.games || []) gamePks.push(g.gamePk);
  }

  const actuals = new Map();
  for (const gamePk of gamePks) {
    const box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
    for (const side of ["home", "away"]) {
      const team = box.teams?.[side];
      if (!team?.players) continue;

      for (const p of Object.values(team.players)) {
        const name = p.person?.fullName || "";
        if (!name) continue;

        const batting = p.stats?.batting;
        if (batting) {
          actuals.set(`${norm(name)}|hitter_fantasy_score`, {
            actual: hitterFantasy(batting),
            gamePk,
            team: team.team?.abbreviation || "",
            source: "mlb_boxscore_hitter_fantasy"
          });
        }

        const pitching = p.stats?.pitching;
        if (pitching && Number(pitching.outs || 0) > 0) {
          actuals.set(`${norm(name)}|pitcher_fantasy_score`, {
            actual: pitcherFantasy(pitching),
            gamePk,
            team: team.team?.abbreviation || "",
            source: "mlb_boxscore_pitcher_fantasy"
          });
        }
      }
    }
  }

  let rows = 0, beforeUnmatched = 0, repaired = 0, stillUnmatched = 0;
  const examples = [];
  const still = [];

  walkRows(data, (row, path) => {
    rows++;
    const res = s(row.result).toUpperCase();
    if (res === "UNMATCHED") beforeUnmatched++;

    if (res !== "UNMATCHED") return;

    const m = marketOf(row);
    const key = `${norm(playerOf(row))}|${m}`;
    const found = actuals.get(key);
    const line = lineOf(row);

    if (!found || line === null) {
      stillUnmatched++;
      if (still.length < 20) still.push(`${playerOf(row)} | ${m} ${line ?? "?"} | no boxscore fantasy actual | ${path}`);
      return;
    }

    const result = resultFor(sideOf(row), found.actual, line);
    row.actual = found.actual;
    row.result = result.toLowerCase();
    row.matchType = found.source;
    row.gamePk = row.gamePk || found.gamePk;
    row.team = row.team || found.team;
    row.repairedFantasyActual = true;

    repaired++;
    if (examples.length < 20) {
      examples.push(`${playerOf(row)} | ${m} LESS ${line} | actual=${found.actual} | ${result}`);
    }
  });

  function summarize(root) {
    const bucket = { rows: 0, graded: 0, hits: 0, misses: 0, pushes: 0, unmatched: 0, hitRate: null };
    walkRows(root, row => {
      bucket.rows++;
      const r = s(row.result).toUpperCase();
      if (r === "HIT" || r === "WIN") bucket.hits++;
      else if (r === "MISS" || r === "LOSS") bucket.misses++;
      else if (r === "PUSH") bucket.pushes++;
      else bucket.unmatched++;
    });
    bucket.graded = bucket.hits + bucket.misses;
    bucket.hitRate = bucket.graded ? Number((bucket.hits / bucket.graded).toFixed(4)) : null;
    return bucket;
  }

  const summary = summarize(data);
  data.fantasyLessBoxscoreRepair = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    rows,
    beforeUnmatched,
    repaired,
    stillUnmatched,
    summary
  };

  writeJson(OUT, data);

  const lines = [];
  lines.push("FANTASY LESS BOXSCORE REPAIR");
  lines.push("============================");
  lines.push(`date=${DATE}`);
  lines.push(`rows=${rows}`);
  lines.push(`beforeUnmatched=${beforeUnmatched}`);
  lines.push(`repaired=${repaired}`);
  lines.push(`stillUnmatched=${stillUnmatched}`);
  lines.push(`summary=${JSON.stringify(summary)}`);
  lines.push("");
  lines.push("EXAMPLES");
  lines.push("--------");
  lines.push(...(examples.length ? examples : ["none"]));
  lines.push("");
  lines.push("STILL UNMATCHED SAMPLE");
  lines.push("----------------------");
  lines.push(...(still.length ? still : ["none"]));
  fs.writeFileSync(REPORT, lines.join("\n") + "\n");

  console.log({ date: DATE, rows, beforeUnmatched, repaired, stillUnmatched, summary });
  console.log(`saved: ${OUT}`);
  console.log(`saved: ${REPORT}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
