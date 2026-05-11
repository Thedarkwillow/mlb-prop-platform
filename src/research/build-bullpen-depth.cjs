const fs = require("fs");

const OUT = "data/context/bullpen-depth.json";
const DATE = process.argv[2] || process.env.SLATE_DATE || new Date().toISOString().slice(0, 10);

const TEAM_ABBR = {
  "Arizona Diamondbacks": "AZ", "Atlanta Braves": "ATL", "Baltimore Orioles": "BAL",
  "Boston Red Sox": "BOS", "Chicago Cubs": "CHC", "Chicago White Sox": "CWS",
  "Cincinnati Reds": "CIN", "Cleveland Guardians": "CLE", "Colorado Rockies": "COL",
  "Detroit Tigers": "DET", "Houston Astros": "HOU", "Kansas City Royals": "KC",
  "Los Angeles Angels": "LAA", "Los Angeles Dodgers": "LAD", "Miami Marlins": "MIA",
  "Milwaukee Brewers": "MIL", "Minnesota Twins": "MIN", "New York Mets": "NYM",
  "New York Yankees": "NYY", "Athletics": "ATH", "Philadelphia Phillies": "PHI",
  "Pittsburgh Pirates": "PIT", "San Diego Padres": "SD", "San Francisco Giants": "SF",
  "Seattle Mariners": "SEA", "St. Louis Cardinals": "STL", "Tampa Bay Rays": "TB",
  "Texas Rangers": "TEX", "Toronto Blue Jays": "TOR", "Washington Nationals": "WSH"
};

function write(path, data) {
  fs.mkdirSync(require("path").dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function daysAgo(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function ipToOuts(ip) {
  const s = String(ip || "0");
  const [whole, frac] = s.split(".");
  return Number(whole || 0) * 3 + Number(frac || 0);
}

function era(er, outs) {
  return outs ? Number(((er * 27) / outs).toFixed(3)) : null;
}

function whip(bb, h, outs) {
  return outs ? Number(((bb + h) / (outs / 3)).toFixed(3)) : null;
}

function abbr(teamName) {
  return TEAM_ABBR[teamName] || teamName;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function init(team) {
  return {
    team,
    relievers: {},
    totals: {
      outs: 0,
      er: 0,
      h: 0,
      bb: 0,
      pitches: 0,
      appearances: 0
    }
  };
}

function addReliever(teamRec, player, stats, date) {
  const pitching = stats?.pitching || {};
  const outs = ipToOuts(pitching.inningsPitched);
  const pitches = n(pitching.numberOfPitches);
  const er = n(pitching.earnedRuns);
  const h = n(pitching.hits);
  const bb = n(pitching.baseOnBalls);
  const so = n(pitching.strikeOuts);

  teamRec.totals.outs += outs;
  teamRec.totals.er += er;
  teamRec.totals.h += h;
  teamRec.totals.bb += bb;
  teamRec.totals.pitches += pitches;
  teamRec.totals.appearances++;

  const id = player.person.id;
  teamRec.relievers[id] ||= {
    id,
    name: player.person.fullName,
    hand: player.person.pitchHand?.code || null,
    role: null,
    outs: 0,
    er: 0,
    h: 0,
    bb: 0,
    so: 0,
    pitches: 0,
    appearances: 0,
    recentPitchCounts: []
  };

  const r = teamRec.relievers[id];
  r.outs += outs;
  r.er += er;
  r.h += h;
  r.bb += bb;
  r.so += so;
  r.pitches += pitches;
  r.appearances++;
  r.recentPitchCounts.push({ date, pitches, outs });
}

async function main() {
  const startDate = daysAgo(DATE, 4);
  const endDate = daysAgo(DATE, 1);
  const schedule = await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}`);

  const teams = {};

  for (const day of schedule.dates || []) {
    for (const game of day.games || []) {
      if (game.status?.abstractGameState !== "Final") continue;

      const box = await getJson(`https://statsapi.mlb.com/api/v1/game/${game.gamePk}/boxscore`);

      for (const side of ["away", "home"]) {
        const team = abbr(game.teams[side].team.name);
        teams[team] ||= init(team);

        const pitchers = box.teams[side].pitchers || [];
        const players = box.teams[side].players || {};

        pitchers.forEach((pid, idx) => {
          if (idx === 0) return;
          const player = players[`ID${pid}`];
          if (!player?.stats?.pitching) return;
          addReliever(teams[team], player, player.stats, day.date);
        });
      }
    }
  }

  const finished = {};

  for (const [team, rec] of Object.entries(teams)) {
    const relievers = Object.values(rec.relievers).map(r => ({
      ...r,
      era: era(r.er, r.outs),
      whip: whip(r.bb, r.h, r.outs),
      role: r.appearances >= 3 ? "high_usage" : r.appearances >= 2 ? "used_recently" : "depth"
    }));

    finished[team] = {
      team,
      bullpenEra: era(rec.totals.er, rec.totals.outs),
      bullpenWhip: whip(rec.totals.bb, rec.totals.h, rec.totals.outs),
      relieverAppearances: rec.totals.appearances,
      recentPitches: rec.totals.pitches,
      relievers
    };
  }

  const eraSorted = Object.values(finished).filter(x => x.bullpenEra != null).sort((a,b) => a.bullpenEra - b.bullpenEra);
  const whipSorted = Object.values(finished).filter(x => x.bullpenWhip != null).sort((a,b) => a.bullpenWhip - b.bullpenWhip);

  eraSorted.forEach((x, i) => finished[x.team].bullpenEraRank = i + 1);
  whipSorted.forEach((x, i) => finished[x.team].bullpenWhipRank = i + 1);

  const out = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: "MLB Stats API boxscore last 4 days",
    teams: finished
  };

  write(OUT, out);
  console.log("BULLPEN DEPTH");
  console.log("=============");
  console.log("Teams:", Object.keys(out.teams).length);
  console.log("Wrote", OUT);
  console.table(Object.values(out.teams).slice(0, 12).map(x => ({
    team: x.team,
    era: x.bullpenEra,
    eraRank: x.bullpenEraRank,
    whip: x.bullpenWhip,
    whipRank: x.bullpenWhipRank,
    relievers: x.relievers.length,
    recentPitches: x.recentPitches
  })));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
