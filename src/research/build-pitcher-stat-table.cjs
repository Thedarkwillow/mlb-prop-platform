const fs = require("fs");

const DATE =
  process.env.SLATE_DATE ||
  process.env.npm_config_date ||
  process.argv[2] ||
  new Date().toISOString().slice(0, 10);

const YEAR = Number(DATE.slice(0, 4));

const STAFFS = "data/context/pitching-staffs.json";
const VELO = "data/savant/pitcher-velocity-trends.json";
const HAND = "data/savant/handedness-splits.json";
const OUT = "data/context/pitcher-stat-table.json";

function read(path, fallback = {}) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
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

function collectStaffPitchers(staffs) {
  const out = new Map();

  for (const t of Object.values(staffs.teams || {})) {
    const all = [
      t.probableStarter,
      ...(Array.isArray(t.bullpen) ? t.bullpen : [])
    ].filter(Boolean);

    for (const p of all) {
      if (!p.name || !p.id) continue;
      out.set(String(p.id), {
        id: p.id,
        name: p.name,
        team: p.team || t.team,
        hand: p.hand || null,
        role: p.role || "staff"
      });
    }
  }

  return [...out.values()];
}

async function mlbSeasonStats(playerId) {
  const url =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching&season=${YEAR}`;

  try {
    const data = await fetchJson(url);
    const split = data.stats?.[0]?.splits?.[0]?.stat || {};
    return {
      era: num(split.era),
      whip: num(split.whip),
      inningsPitched: split.inningsPitched || null,
      games: num(split.gamesPlayed),
      gamesStarted: num(split.gamesStarted),
      wins: num(split.wins),
      losses: num(split.losses),
      saves: num(split.saves),
      holds: num(split.holds),
      strikeouts: num(split.strikeOuts),
      walks: num(split.baseOnBalls),
      hits: num(split.hits),
      runs: num(split.runs),
      earnedRuns: num(split.earnedRuns),
      homeRuns: num(split.homeRuns),
      avgAgainst: num(split.avg)
    };
  } catch {
    return {};
  }
}

function attachSavant(name, id, velocity, handedness) {
  const velo =
    velocity.pitchersById?.[String(id)] ||
    velocity.pitchers?.[norm(name)] ||
    null;

  const split =
    handedness.pitchers?.[norm(name)] ||
    null;

  const season = velo?.windows?.season || {};
  const pitchTypes = season.pitchTypes || {};

  let weightedWhiff = null;
  let weightedHardHit = null;
  let weightedK = null;
  let weightedBB = null;
  let totalWeight = 0;

  for (const p of Object.values(pitchTypes)) {
    const w = num(p.pitchPercent) ?? 0;
    if (!w) continue;

    if (p.whiffRate != null) weightedWhiff = (weightedWhiff || 0) + p.whiffRate * w;
    if (p.hardHitRate != null) weightedHardHit = (weightedHardHit || 0) + p.hardHitRate * w;
    if (p.kRate != null) weightedK = (weightedK || 0) + p.kRate * w;
    if (p.bbRate != null) weightedBB = (weightedBB || 0) + p.bbRate * w;

    totalWeight += w;
  }

  function finish(x) {
    return x != null && totalWeight ? Number((x / totalWeight).toFixed(3)) : null;
  }

  return {
    fip: null,
    xfip: null,
    homeAwaySplits: {
      home: null,
      away: null
    },
    vsLHH: split?.vsLHB || null,
    vsRHH: split?.vsRHB || null,
    kRate: finish(weightedK),
    bbRate: finish(weightedBB),
    chaseRate: null,
    swingMissRate: finish(weightedWhiff),
    hardHitRate: finish(weightedHardHit),
    gbFb: null,
    pmr: null,
    arsenal: {
      available: Boolean(velo),
      primaryFastball: velo?.primaryFastball || null,
      baselineFastballVelo: velo?.baselineFastballVelo ?? null,
      currentFastballVelo: velo?.currentFastballVelo ?? null,
      velocityDelta: velo?.velocityDelta ?? null,
      velocityTrend: velo?.trend || null,
      pitchMix: pitchTypes
    }
  };
}

async function main() {
  const staffs = read(STAFFS, {});
  const velocity = read(VELO, {});
  const handedness = read(HAND, {});

  const pitchers = collectStaffPitchers(staffs);
  const max = Number(process.env.PITCHER_STATS_MAX || 180);

  const byName = {};
  const byId = {};
  const rows = [];

  for (const p of pitchers.slice(0, max)) {
    const mlb = await mlbSeasonStats(p.id);
    const savant = attachSavant(p.name, p.id, velocity, handedness);

    const rec = {
      name: p.name,
      id: p.id,
      team: p.team,
      hand: p.hand,
      role: p.role,
      source: {
        mlbStatsApi: true,
        savantVelocityArsenal: savant.arsenal.available,
        handednessSplits: Boolean(savant.vsLHH || savant.vsRHH)
      },

      era: mlb.era ?? null,
      whip: mlb.whip ?? null,
      fip: savant.fip,
      xfip: savant.xfip,

      inningsPitched: mlb.inningsPitched ?? null,
      games: mlb.games ?? null,
      gamesStarted: mlb.gamesStarted ?? null,
      wins: mlb.wins ?? null,
      losses: mlb.losses ?? null,
      saves: mlb.saves ?? null,
      holds: mlb.holds ?? null,

      homeAwaySplits: savant.homeAwaySplits,
      vsLHH: savant.vsLHH,
      vsRHH: savant.vsRHH,

      kRate: savant.kRate,
      bbRate: savant.bbRate,
      avgAgainst: mlb.avgAgainst ?? null,
      chaseRate: savant.chaseRate,
      swingMissRate: savant.swingMissRate,
      hardHitRate: savant.hardHitRate,
      gbFb: savant.gbFb,
      pmr: savant.pmr,

      arsenal: savant.arsenal
    };

    rows.push(rec);
    byName[norm(rec.name)] = rec;
    byId[String(rec.id)] = rec;
  }

  const out = {
    recordType: "automated_pitcher_stat_table",
    date: DATE,
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      staffs: STAFFS,
      velocity: VELO,
      handedness: HAND
    },
    status: {
      requested: pitchers.length,
      processed: rows.length,
      withEra: rows.filter(r => r.era != null).length,
      withWhip: rows.filter(r => r.whip != null).length,
      withArsenal: rows.filter(r => r.arsenal?.available).length,
      withHandednessSplits: rows.filter(r => r.vsLHH || r.vsRHH).length,
      fipXfip: "not_available_from_current_automated_sources",
      homeAwaySplits: "not_available_from_current_automated_sources",
      pmr: "not_available_from_current_automated_sources"
    },
    rows,
    byName,
    byId
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

  console.log("AUTOMATED PITCHER STAT TABLE");
  console.log("============================");
  console.log(`Requested: ${out.status.requested}`);
  console.log(`Processed: ${out.status.processed}`);
  console.log(`With ERA: ${out.status.withEra}`);
  console.log(`With WHIP: ${out.status.withWhip}`);
  console.log(`With arsenal: ${out.status.withArsenal}`);
  console.log(`With handedness splits: ${out.status.withHandednessSplits}`);
  console.log(`Wrote ${OUT}`);

  console.table(rows.slice(0, 30).map(r => ({
    name: r.name,
    team: r.team,
    role: r.role,
    era: r.era,
    whip: r.whip,
    avg: r.avgAgainst,
    kRate: r.kRate,
    bbRate: r.bbRate,
    swMiss: r.swingMissRate,
    hardHit: r.hardHitRate,
    arsenal: r.arsenal.available
  })));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
