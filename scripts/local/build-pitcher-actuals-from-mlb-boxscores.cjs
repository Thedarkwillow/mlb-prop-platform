const fs = require("fs");
const https = require("https");

function getDate() {
  const arg = process.argv.find(x => /^--date=/.test(x));
  if (arg) return arg.replace(/^--date=/, "");
  const bare = process.argv.find(x => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (bare) return bare;
  if (process.env.npm_config_date) return process.env.npm_config_date;
  return new Date().toISOString().slice(0, 10);
}

const DATE = getDate();
const OUT = `outputs/history/${DATE}-pitcher-actuals.json`;
const TXT = `outputs/history/${DATE}-pitcher-actuals.txt`;

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "mlb-prop-platform/1.0" } }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse failed for ${url}: ${e.message}`));
        }
      });
    }).on("error", reject);
  });
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function norm(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function inningsToOuts(ip) {
  const raw = s(ip);
  if (!raw) return 0;
  const [wholeRaw, fracRaw = "0"] = raw.split(".");
  const whole = Number(wholeRaw);
  const frac = Number(fracRaw);
  if (!Number.isFinite(whole)) return 0;
  if (frac === 0) return whole * 3;
  if (frac === 1) return whole * 3 + 1;
  if (frac === 2) return whole * 3 + 2;
  return Math.round(Number(raw) * 3);
}

function pickPitchingStats(playerObj) {
  return playerObj?.stats?.pitching || null;
}

function playerName(playerObj) {
  return s(
    playerObj?.person?.fullName ||
    playerObj?.person?.boxscoreName ||
    playerObj?.fullName ||
    playerObj?.name
  );
}

async function main() {
  fs.mkdirSync("outputs/history", { recursive: true });

  const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}`;
  const schedule = await getJson(scheduleUrl);
  const games = [];

  for (const d of schedule.dates || []) {
    for (const g of d.games || []) {
      if (g.gamePk) games.push(g);
    }
  }

  const rows = [];
  const errors = [];

  for (const g of games) {
    const gamePk = g.gamePk;
    const awayTeam = s(g.teams?.away?.team?.abbreviation || g.teams?.away?.team?.name);
    const homeTeam = s(g.teams?.home?.team?.abbreviation || g.teams?.home?.team?.name);
    const awayName = s(g.teams?.away?.team?.name);
    const homeName = s(g.teams?.home?.team?.name);
    const gameLabel = `${awayTeam || awayName} @ ${homeTeam || homeName}`;

    try {
      const box = await getJson(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);

      for (const side of ["away", "home"]) {
        const teamObj = box.teams?.[side];
        const team = s(teamObj?.team?.abbreviation || teamObj?.team?.teamCode || teamObj?.team?.name);
        const opponent = side === "away" ? homeTeam : awayTeam;
        const players = teamObj?.players || {};

        for (const p of Object.values(players)) {
          const st = pickPitchingStats(p);
          if (!st) continue;

          const name = playerName(p);
          if (!name) continue;

          const inningsPitched = s(st.inningsPitched);
          const outs = n(st.outs) ?? inningsToOuts(inningsPitched);

          // Some boxscore player objects can include empty pitching blocks. Keep only real appearances.
          const battersFaced = n(st.battersFaced);
          const pitchesThrown = n(st.pitchesThrown || st.numberOfPitches);
          const hasAppearance =
            outs > 0 ||
            battersFaced > 0 ||
            pitchesThrown > 0 ||
            n(st.hits) > 0 ||
            n(st.runs) > 0 ||
            n(st.earnedRuns) > 0 ||
            n(st.baseOnBalls) > 0 ||
            n(st.strikeOuts) > 0;

          if (!hasAppearance) continue;

          rows.push({
            date: DATE,
            gamePk,
            game: gameLabel,
            team,
            opponent,
            player: name,
            playerKey: norm(name),
            mlbId: p?.person?.id || null,
            inningsPitched,
            pitching_outs: outs,
            hits_allowed: n(st.hits) ?? 0,
            runs_allowed: n(st.runs) ?? 0,
            earned_runs_allowed: n(st.earnedRuns) ?? 0,
            walks_allowed: n(st.baseOnBalls) ?? 0,
            strikeouts: n(st.strikeOuts) ?? 0,
            battersFaced,
            pitchesThrown
          });
        }
      }
    } catch (e) {
      errors.push({ gamePk, game: gameLabel, error: e.message });
    }
  }

  const byPlayer = {};
  for (const r of rows) {
    byPlayer[r.playerKey] ||= [];
    byPlayer[r.playerKey].push(r);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    date: DATE,
    source: "MLB Stats API schedule + boxscore",
    scheduleUrl,
    games: games.length,
    pitchers: rows.length,
    errors,
    rows,
    byPlayer
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

  const lines = [];
  lines.push("PITCHER ACTUALS FROM MLB BOXSCORES");
  lines.push("===================================");
  lines.push(JSON.stringify({
    generatedAt: payload.generatedAt,
    date: DATE,
    games: games.length,
    pitchers: rows.length,
    errors: errors.length,
    output: OUT
  }, null, 2));
  lines.push("");
  lines.push("PITCHERS");
  lines.push("--------");
  rows
    .sort((a, b) => a.game.localeCompare(b.game) || a.team.localeCompare(b.team) || a.player.localeCompare(b.player))
    .forEach((r, i) => {
      lines.push(`${i + 1}. ${r.player} | ${r.team} | ${r.game} | IP=${r.inningsPitched} | outs=${r.pitching_outs} | H=${r.hits_allowed} | ER=${r.earned_runs_allowed} | BB=${r.walks_allowed} | K=${r.strikeouts}`);
    });

  if (errors.length) {
    lines.push("");
    lines.push("ERRORS");
    lines.push("------");
    for (const e of errors) lines.push(`${e.gamePk} ${e.game}: ${e.error}`);
  }

  fs.writeFileSync(TXT, lines.join("\n") + "\n");

  console.log({
    generatedAt: payload.generatedAt,
    date: DATE,
    games: games.length,
    pitchers: rows.length,
    errors: errors.length,
    out: OUT,
    txt: TXT
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
