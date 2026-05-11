const fs = require("fs");

const OUT = "data/context/pitcher-fip-lite.json";
const STAT_OUT = "data/context/pitcher-stat-table.json";
const SEASON = Number(process.env.SEASON || new Date().getFullYear());

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function norm(v) {
  return String(v || "")
    .toLowerCase()
    .replace(/jr\.?|sr\.?|ii|iii|iv/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function n(v, fallback = 0) {
  const x = Number(String(v ?? "").replace("%", "").replace(",", ""));
  return Number.isFinite(x) ? x : fallback;
}

function ipToInnings(v) {
  const s = String(v ?? "0");
  const [whole, frac] = s.split(".");
  return n(whole) + (n(frac) / 3);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function fipConstant(leagueEra, leagueHr, leagueBb, leagueHbp, leagueK, leagueIp) {
  const base = ((13 * leagueHr + 3 * (leagueBb + leagueHbp) - 2 * leagueK) / leagueIp);
  return leagueEra - base;
}

function calcFip({ hr, bb, hbp, k, ip, constant }) {
  if (!ip) return null;
  return Number((((13 * hr + 3 * (bb + hbp) - 2 * k) / ip) + constant).toFixed(3));
}

function estimateXfip({ bb, hbp, k, ip, hr, constant, leagueHrPerIp }) {
  if (!ip) return null;

  // xFIP-lite approximation:
  // Replace pitcher HR with league-average HR/IP expectation.
  // This is not official xFIP because true xFIP uses fly balls * league HR/FB.
  const expectedHr = leagueHrPerIp * ip;

  return Number((((13 * expectedHr + 3 * (bb + hbp) - 2 * k) / ip) + constant).toFixed(3));
}

async function main() {
  const url =
    `https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&playerPool=ALL&season=${SEASON}&sportIds=1&limit=5000`;

  const data = await getJson(url);
  const splits = data.stats?.[0]?.splits || [];

  const raw = splits.map(s => {
    const st = s.stat || {};
    const ip = ipToInnings(st.inningsPitched);

    return {
      id: String(s.player?.id || ""),
      name: s.player?.fullName || "",
      team: s.team?.abbreviation || s.team?.name || null,
      ip,
      era: n(st.era, null),
      whip: n(st.whip, null),
      gamesPitched: n(st.gamesPitched),
      gamesStarted: n(st.gamesStarted),
      wins: n(st.wins),
      losses: n(st.losses),
      hits: n(st.hits),
      runs: n(st.runs),
      earnedRuns: n(st.earnedRuns),
      homeRuns: n(st.homeRuns),
      baseOnBalls: n(st.baseOnBalls),
      hitBatsmen: n(st.hitBatsmen),
      strikeOuts: n(st.strikeOuts),
      battersFaced: n(st.battersFaced),
      avgAgainst: n(st.avg, null)
    };
  }).filter(r => r.name && r.ip > 0);

  const league = raw.reduce((a, r) => {
    a.ip += r.ip;
    a.er += r.earnedRuns;
    a.hr += r.homeRuns;
    a.bb += r.baseOnBalls;
    a.hbp += r.hitBatsmen;
    a.k += r.strikeOuts;
    return a;
  }, { ip: 0, er: 0, hr: 0, bb: 0, hbp: 0, k: 0 });

  const leagueEra = league.ip ? (league.er * 9) / league.ip : 4.20;
  const constant = fipConstant(leagueEra, league.hr, league.bb, league.hbp, league.k, league.ip);
  const leagueHrPerIp = league.ip ? league.hr / league.ip : 0.14;

  const rows = raw.map(r => {
    const kRate = r.battersFaced ? Number(((r.strikeOuts / r.battersFaced) * 100).toFixed(3)) : null;
    const bbRate = r.battersFaced ? Number(((r.baseOnBalls / r.battersFaced) * 100).toFixed(3)) : null;

    return {
      ...r,
      kRate,
      bbRate,
      fip: calcFip({
        hr: r.homeRuns,
        bb: r.baseOnBalls,
        hbp: r.hitBatsmen,
        k: r.strikeOuts,
        ip: r.ip,
        constant
      }),
      xfip: estimateXfip({
        hr: r.homeRuns,
        bb: r.baseOnBalls,
        hbp: r.hitBatsmen,
        k: r.strikeOuts,
        ip: r.ip,
        constant,
        leagueHrPerIp
      }),
      fipSource: "mlb_stats_api_calculated",
      xfipSource: "estimated_xfip_lite_hr_per_ip_regression"
    };
  });

  const byName = {};
  const byId = {};

  for (const r of rows) {
    const rec = {
      name: r.name,
      id: r.id,
      team: r.team,
      era: r.era,
      whip: r.whip,
      fip: r.fip,
      xfip: r.xfip,
      fipSource: r.fipSource,
      xfipSource: r.xfipSource,
      kRate: r.kRate,
      bbRate: r.bbRate,
      avgAgainst: r.avgAgainst,
      ip: Number(r.ip.toFixed(3)),
      homeRuns: r.homeRuns,
      baseOnBalls: r.baseOnBalls,
      hitBatsmen: r.hitBatsmen,
      strikeOuts: r.strikeOuts,
      battersFaced: r.battersFaced,
      raw: r
    };

    byName[norm(r.name)] = rec;
    if (r.id) byId[r.id] = rec;
  }

  const out = {
    recordType: "pitcher_fip_lite",
    generatedAt: new Date().toISOString(),
    season: SEASON,
    source: "MLB Stats API season pitching",
    fipConstant: Number(constant.toFixed(4)),
    leagueEra: Number(leagueEra.toFixed(4)),
    leagueHrPerIp: Number(leagueHrPerIp.toFixed(5)),
    xfipCaveat: "Estimated xFIP-lite replaces pitcher HR with league-average HR/IP. It is not official FanGraphs xFIP.",
    rows: rows.length,
    byName,
    byId
  };

  write(OUT, out);

  // Also write into the existing pitcher-stat-table location so the current context pack consumes it.
  write(STAT_OUT, {
    recordType: "pitcher_stat_table",
    generatedAt: out.generatedAt,
    source: OUT,
    rows: rows.length,
    byName,
    byId
  });

  console.log("PITCHER FIP LITE");
  console.log("================");
  console.log("Season:", SEASON);
  console.log("Rows:", rows.length);
  console.log("FIP constant:", out.fipConstant);
  console.log("League ERA:", out.leagueEra);
  console.log("League HR/IP:", out.leagueHrPerIp);
  console.log("Wrote", OUT);
  console.log("Updated", STAT_OUT);
  console.table(rows.slice(0, 20).map(r => ({
    name: r.name,
    team: r.team,
    ip: Number(r.ip.toFixed(1)),
    era: r.era,
    whip: r.whip,
    fip: r.fip,
    xfipLite: r.xfip,
    kRate: r.kRate,
    bbRate: r.bbRate
  })));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
