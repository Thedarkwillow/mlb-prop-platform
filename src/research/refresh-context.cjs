const fs = require("fs");
const path = require("path");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function read(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function prevDate(date, days) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return ymd(d);
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function teamAbbr(team) {
  return String(team?.abbreviation || team?.teamCode || team?.fileCode || team?.name || "").toUpperCase();
}

async function buildBullpenFatigue() {
  const teams = {};
  const start = prevDate(DATE, 3);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${DATE}&hydrate=probablePitcher,team`;
  const sched = await getJson(url);

  for (const day of sched.dates || []) {
    for (const game of day.games || []) {
      if (String(game.status?.abstractGameState || "").toLowerCase() !== "final") continue;

      const box = await getJson(`https://statsapi.mlb.com/api/v1/game/${game.gamePk}/boxscore`);
      for (const side of ["home", "away"]) {
        const team = teamAbbr(game.teams?.[side]?.team);
        if (!team) continue;
        teams[team] ||= {
          last3DaysReliefPitches: 0,
          backToBackRelievers: 0,
          relieverAppearances: 0,
          fatigue: "LOW",
          notes: []
        };

        const pitchers = box.teams?.[side]?.pitchers || [];
        pitchers.slice(1).forEach(pid => {
          const p = box.teams?.[side]?.players?.[`ID${pid}`];
          const stats = p?.stats?.pitching || {};
          const pitches = Number(stats.pitchesThrown || 0);
          if (pitches > 0) {
            teams[team].last3DaysReliefPitches += pitches;
            teams[team].relieverAppearances += 1;
            if (pitches >= 20) teams[team].backToBackRelievers += 1;
          }
        });
      }
    }
  }

  for (const [team, r] of Object.entries(teams)) {
    if (r.last3DaysReliefPitches >= 140 || r.backToBackRelievers >= 4) r.fatigue = "HIGH";
    else if (r.last3DaysReliefPitches >= 90 || r.backToBackRelievers >= 2) r.fatigue = "MEDIUM";
    else r.fatigue = "LOW";

    r.pitchCountLast2Days = r.last3DaysReliefPitches;
    r.notes.push(`relief pitches last 3 days=${r.last3DaysReliefPitches}`);
  }

  write("data/context/bullpen-fatigue.json", { date: DATE, teams });
}

async function buildTravelRest() {
  const teams = {};
  const start = prevDate(DATE, 5);
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${start}&endDate=${DATE}&hydrate=team`;
  const sched = await getJson(url);

  for (const day of sched.dates || []) {
    for (const game of day.games || []) {
      for (const side of ["home", "away"]) {
        const team = teamAbbr(game.teams?.[side]?.team);
        if (!team) continue;
        teams[team] ||= { games: [], restDisadvantage: false, travelSpot: "OK", notes: [] };
        teams[team].games.push({
          date: day.date,
          homeAway: side === "home" ? "HOME" : "AWAY",
          opponent: teamAbbr(game.teams?.[side === "home" ? "away" : "home"]?.team),
          venue: game.venue?.name || ""
        });
      }
    }
  }

  for (const [team, r] of Object.entries(teams)) {
    r.games.sort((a, b) => a.date.localeCompare(b.date));
    const today = r.games.find(g => g.date === DATE);
    const yesterday = r.games.find(g => g.date === prevDate(DATE, 1));
    const twoDaysAgo = r.games.find(g => g.date === prevDate(DATE, 2));

    if (today && yesterday) {
      if (today.homeAway !== yesterday.homeAway) {
        r.restDisadvantage = true;
        r.travelSpot = "BAD";
        r.notes.push("home/away change from previous day");
      }
      if (yesterday.homeAway === "AWAY" && today.homeAway === "AWAY" && yesterday.venue !== today.venue) {
        r.restDisadvantage = true;
        r.travelSpot = "BAD";
        r.notes.push("road city change from previous day");
      }
    }

    if (!yesterday && twoDaysAgo) {
      r.notes.push("one rest day before current game");
    }
  }

  write("data/context/travel-rest.json", { date: DATE, teams });
}

function buildCatcherFramingTemplate() {
  const existing = read("data/context/catcher-framing.json", { catchers: {}, teams: {} });
  write("data/context/catcher-framing.json", {
    date: DATE,
    source: "manual_or_savant_csv",
    note: "Fill catchers or teams with framing=PLUS/MINUS/OK and optional framingRuns.",
    catchers: existing.catchers || existing.players || {},
    teams: existing.teams || {}
  });
}

function buildUmpireTemplate() {
  const existing = read("data/context/umpires.json", { games: {} });
  write("data/context/umpires.json", {
    date: DATE,
    source: "manual_plate_umpire_or_umpire_scorecards",
    note: "Key by normalized game string. Add kFactor, kBoost/kDowngrade, umpire name.",
    games: existing.games || {}
  });
}

(async () => {
  console.log("REFRESH CONTEXT");
  console.log("===============");
  console.log(`Date: ${DATE}`);

  await buildBullpenFatigue();
  console.log("Wrote data/context/bullpen-fatigue.json");

  await buildTravelRest();
  console.log("Wrote data/context/travel-rest.json");

  buildCatcherFramingTemplate();
  console.log("Wrote data/context/catcher-framing.json");

  buildUmpireTemplate();
  console.log("Wrote data/context/umpires.json");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
