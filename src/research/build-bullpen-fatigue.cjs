const fs = require("fs");

const DATE = process.argv[2] || process.env.npm_config_date || new Date().toISOString().slice(0, 10);

function normTeam(s) {
  return String(s || "").toUpperCase().trim();
}

async function fetchJson(url) {
  const variants = [
    url,
    url.includes("/api/v1/game/") ? url.replace("/api/v1/game/", "/api/v1.1/game/") : null,
    url.includes("/boxscore") && !url.includes("?") ? `${url}?language=en` : null,
    url.includes("/api/v1/game/") && url.includes("/boxscore") && !url.includes("?")
      ? `${url.replace("/api/v1/game/", "/api/v1.1/game/")}?language=en`
      : null
  ].filter(Boolean);

  let lastErr = null;

  for (const candidate of [...new Set(variants)]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(candidate, {
          headers: {
            Accept: "application/json,text/plain,*/*",
            "User-Agent": "Mozilla/5.0 mlb-prop-platform"
          }
        });

        if (res.ok) return res.json();

        const text = await res.text().catch(() => "");
        lastErr = new Error(`Fetch failed ${res.status}: ${candidate}${text ? ` | ${text.slice(0, 120)}` : ""}`);

        if (res.status === 406 || res.status === 404) break;
      } catch (err) {
        lastErr = err;
      }

      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    }
  }

  throw lastErr || new Error(`Fetch failed: ${url}`);
}

function dateAdd(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function inningsToOuts(ip) {
  if (ip == null) return 0;
  const [whole, frac = "0"] = String(ip).split(".");
  return (Number(whole) || 0) * 3 + (Number(frac) || 0);
}

function fatigueTier(score) {
  if (score >= 38) return "EXHAUSTED";
  if (score >= 28) return "TIRED";
  if (score >= 18) return "MODERATE";
  return "FRESH";
}

async function main() {
  const startDate = dateAdd(DATE, -3);
  const endDate = dateAdd(DATE, -1);

  let sched = null;
  try {
    sched = await fetchJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}`);
  } catch (err) {
    console.warn(`WARN: bullpen schedule fetch failed: ${err && err.message ? err.message : err}`);
    if (fs.existsSync("data/context/bullpen-fatigue.json")) {
      console.warn("WARN: keeping existing data/context/bullpen-fatigue.json");
      return;
    }
    throw err;
  }

  const games = [];
  for (const d of sched.dates || []) {
    for (const g of d.games || []) games.push({ gamePk: g.gamePk, date: d.date });
  }

  const teams = {};

  for (const g of games) {
    let box = null;
    try {
      box = await fetchJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
    } catch (err) {
      console.warn(`WARN: skipping bullpen boxscore gamePk ${g.gamePk}: ${err && err.message ? err.message : err}`);
      continue;
    }

    for (const side of ["home", "away"]) {
      const team = box.teams?.[side]?.team?.abbreviation;
      const players = Object.values(box.teams?.[side]?.players || {});

      if (!team) continue;
      const key = normTeam(team);
      teams[key] ||= {
        team: key,
        reliefOutsLast3: 0,
        reliefPitchCountLast3: 0,
        reliefAppearancesLast3: 0,
        gamesTracked: 0,
        dates: new Set()
      };

      teams[key].gamesTracked++;
      teams[key].dates.add(g.date);

      for (const p of players) {
        const pitching = p.stats?.pitching;
        if (!pitching?.inningsPitched) continue;

        const gamesStarted = Number(pitching.gamesStarted || 0);
        if (gamesStarted > 0) continue; // starter, not bullpen

        const outs = inningsToOuts(pitching.inningsPitched);
        const pitches = Number(pitching.pitchesThrown || 0);

        if (outs > 0 || pitches > 0) {
          teams[key].reliefOutsLast3 += outs;
          teams[key].reliefPitchCountLast3 += pitches;
          teams[key].reliefAppearancesLast3++;
        }
      }
    }
  }

  const out = Object.values(teams).map(t => {
    const fatigueScore =
      (t.reliefOutsLast3 * 0.55) +
      (t.reliefPitchCountLast3 * 0.04) +
      (t.reliefAppearancesLast3 * 0.75);

    return {
      team: t.team,
      asOfDate: DATE,
      windowStart: startDate,
      windowEnd: endDate,
      gamesTracked: t.gamesTracked,
      activeDates: Array.from(t.dates).sort(),
      reliefOutsLast3: t.reliefOutsLast3,
      reliefInningsLast3: Number((t.reliefOutsLast3 / 3).toFixed(2)),
      reliefPitchCountLast3: t.reliefPitchCountLast3,
      reliefAppearancesLast3: t.reliefAppearancesLast3,
      bullpenFatigueScore: Number(fatigueScore.toFixed(4)),
      bullpenFatigueTier: fatigueTier(fatigueScore)
    };
  }).sort((a, b) => b.bullpenFatigueScore - a.bullpenFatigueScore);

  fs.mkdirSync("data/context", { recursive: true });
  fs.writeFileSync("data/context/bullpen-fatigue.json", JSON.stringify(out, null, 2));

  console.log("BULLPEN FATIGUE REPORT");
  console.log("======================");
  console.log({ asOfDate: DATE, teams: out.length, games: games.length, window: `${startDate} to ${endDate}` });
  console.table(out.map(t => ({
    team: t.team,
    innings: t.reliefInningsLast3,
    pitches: t.reliefPitchCountLast3,
    apps: t.reliefAppearancesLast3,
    score: t.bullpenFatigueScore,
    tier: t.bullpenFatigueTier
  })));
  console.log("Wrote data/context/bullpen-fatigue.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
