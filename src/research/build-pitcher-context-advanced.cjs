const fs = require("fs");

const DATE =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2] ||
  new Date().toISOString().slice(0, 10);

const YEAR = Number(DATE.slice(0, 4));

const STATS = "data/context/pitcher-stat-table.json";
const STAFFS = "data/context/pitching-staffs.json";
const VELO = "data/savant/pitcher-velocity-trends.json";
const OUT = "data/context/pitcher-context-advanced.json";

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function num(v) {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace("%", "").replace(",", "").trim());
  return Number.isFinite(x) ? x : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function estimateChaseFromArsenal(arsenal = {}) {
  const mix = arsenal.pitchMix || {};
  let score = null;
  let total = 0;

  for (const p of Object.values(mix)) {
    const pct = num(p.pitchPercent) || 0;
    if (!pct) continue;

    let pitchScore = 0;
    const whiff = num(p.whiffRate);
    const velo = num(p.velocity);

    if (whiff != null) pitchScore += whiff * 0.65;
    if (velo != null && velo >= 96) pitchScore += 3;
    if (velo != null && velo <= 88) pitchScore -= 1;

    score = (score || 0) + pitchScore * pct;
    total += pct;
  }

  return total ? Number((score / total).toFixed(3)) : null;
}

async function splitStats(playerId, venue) {
  const url =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=statSplits&group=pitching&season=${YEAR}&sitCodes=${venue}`;
  try {
    const data = await fetchJson(url);
    const stat = data.stats?.[0]?.splits?.[0]?.stat || {};
    return {
      era: num(stat.era),
      whip: num(stat.whip),
      avgAgainst: num(stat.avg),
      inningsPitched: stat.inningsPitched || null,
      strikeouts: num(stat.strikeOuts),
      walks: num(stat.baseOnBalls),
      hits: num(stat.hits),
      homeRuns: num(stat.homeRuns)
    };
  } catch {
    return null;
  }
}

async function main() {
  const stats = read(STATS, {});
  const staffs = read(STAFFS, {});
  const velo = read(VELO, {});

  const rows = [];
  const byId = {};
  const byName = {};
  const max = Number(process.env.PITCHER_CONTEXT_MAX || 180);

  const pitchers = Object.values(stats.byId || {}).slice(0, max);

  for (const p of pitchers) {
    const arsenal = p.arsenal || {};
    const home = await splitStats(p.id, "h");
    const away = await splitStats(p.id, "a");

    const rec = {
      ...p,
      chaseRate: p.chaseRate ?? estimateChaseFromArsenal(arsenal),
      homeAwaySplits: {
        home,
        away
      },
      pmrLite: null,
      contextFlags: []
    };

    const whiff = num(rec.swingMissRate);
    const hardHit = num(rec.hardHitRate);
    const era = num(rec.era);
    const whip = num(rec.whip);

    let pmr = 0;
    if (era != null) pmr += Math.max(-2, Math.min(2, (4.2 - era) / 1.2));
    if (whip != null) pmr += Math.max(-2, Math.min(2, (1.3 - whip) / 0.25));
    if (whiff != null) pmr += Math.max(-2, Math.min(2, (whiff - 24) / 6));
    if (hardHit != null) pmr += Math.max(-2, Math.min(2, (38 - hardHit) / 8));

    rec.pmrLite = Number(pmr.toFixed(3));

    if (rec.pmrLite >= 2) rec.contextFlags.push("PLUS_PMR_LITE");
    if (rec.pmrLite <= -2) rec.contextFlags.push("WEAK_PMR_LITE");
    if (rec.chaseRate != null && rec.chaseRate >= 30) rec.contextFlags.push("PLUS_CHASE_PROXY");
    if (rec.chaseRate != null && rec.chaseRate <= 20) rec.contextFlags.push("LOW_CHASE_PROXY");

    rows.push(rec);
    byId[String(rec.id)] = rec;
    byName[String(rec.name || "").toLowerCase()] = rec;
  }

  const teamBullpens = {};

  for (const [team, staff] of Object.entries(staffs.teams || {})) {
    const pen = (staff.bullpen || [])
      .map(p => byId[String(p.id)])
      .filter(Boolean);

    const avg = key => {
      const vals = pen.map(p => num(p[key])).filter(v => v != null);
      return vals.length ? Number((vals.reduce((a,b) => a + b, 0) / vals.length).toFixed(3)) : null;
    };

    teamBullpens[team] = {
      team,
      opponent: staff.opponent || null,
      relievers: pen.length,
      withArsenal: pen.filter(p => p.arsenal?.available).length,
      avgEra: avg("era"),
      avgWhip: avg("whip"),
      avgSwingMiss: avg("swingMissRate"),
      avgHardHit: avg("hardHitRate"),
      avgPmrLite: avg("pmrLite"),
      quality:
        avg("pmrLite") == null ? "unknown" :
        avg("pmrLite") >= 1 ? "strong" :
        avg("pmrLite") <= -1 ? "weak" :
        "neutral"
    };
  }

  const out = {
    recordType: "pitcher_context_advanced",
    date: DATE,
    generatedAt: new Date().toISOString(),
    sourceFiles: { stats: STATS, staffs: STAFFS, velo: VELO },
    status: {
      pitchers: rows.length,
      withHomeAway: rows.filter(r => r.homeAwaySplits?.home || r.homeAwaySplits?.away).length,
      withChaseProxy: rows.filter(r => r.chaseRate != null).length,
      withPmrLite: rows.filter(r => r.pmrLite != null).length,
      bullpens: Object.keys(teamBullpens).length
    },
    rows,
    byId,
    byName,
    teamBullpens
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("ADVANCED PITCHER CONTEXT");
  console.log("========================");
  console.log(out.status);
  console.table(Object.values(teamBullpens).map(t => ({
    team: t.team,
    pen: t.relievers,
    arsenal: t.withArsenal,
    era: t.avgEra,
    whip: t.avgWhip,
    swMiss: t.avgSwingMiss,
    hardHit: t.avgHardHit,
    pmr: t.avgPmrLite,
    quality: t.quality
  })));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
